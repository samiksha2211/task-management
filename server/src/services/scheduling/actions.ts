// Schedule-changing operations shared by the task and meeting controllers.
// Each takes a transaction client so callers decide the transaction boundary.

import type { Prisma, Task } from "@prisma/client";
import type { Frequency } from "./config";
import { fromISODate, mondayOnOrAfter, toISODateOrNull, type ISODate } from "./dates";
import {
  discussionMinutes,
  isTaskClosed,
  planBringForward,
  planFrequencyChange,
  planPinnedDate,
  SchedulingError,
} from "./rules";
import { applyPatch, logEvent, schedulingConfig, toSchedulable, today, type Tx } from "./repository";

export interface ScheduleSettingsInput {
  discussionFrequency?: Frequency | null;
  monthlyMondayOrdinal?: number | null;
  /** Recalculate the date even if it was deferred, brought forward or pinned. */
  recalculate?: boolean;
  priority?: string | null;
  estimatedDiscussionMinutes?: number | null;
  isBlocked?: boolean;
  flaggedForReview?: boolean;
  latestReviewNote?: string | null;
  /** Pin the next discussion to an agreed Monday. */
  pinnedDate?: ISODate | null;
  /** Take the task off the meeting schedule (true) or put it back (false). */
  cancelled?: boolean;
  reason?: string | null;
}

/**
 * Apply scheduling settings to one task: plain fields first, then a frequency
 * change, a pinned date or a cancellation, each recorded in the audit trail.
 */
export async function updateTaskSchedule(
  tx: Tx,
  task: Task,
  input: ScheduleSettingsInput,
  userId: string | null,
  eventType: "INITIALIZED" | "FREQUENCY_CHANGED" = "FREQUENCY_CHANGED"
): Promise<Task> {
  const data: Prisma.TaskUncheckedUpdateInput = {};
  const reviewChanges: string[] = [];

  if (input.priority !== undefined && (input.priority || null) !== task.priority) {
    data.priority = input.priority || null;
    reviewChanges.push(`priority ${input.priority || "cleared"}`);
  }
  if (input.isBlocked !== undefined && input.isBlocked !== task.isBlocked) {
    data.isBlocked = input.isBlocked;
    reviewChanges.push(input.isBlocked ? "marked blocked" : "unblocked");
  }
  if (input.flaggedForReview !== undefined && input.flaggedForReview !== task.flaggedForReview) {
    data.flaggedForReview = input.flaggedForReview;
    reviewChanges.push(input.flaggedForReview ? "flagged for review" : "review flag cleared");
  }
  if (input.latestReviewNote !== undefined) {
    const note = input.latestReviewNote?.trim() || null;
    if (note !== task.latestReviewNote) {
      data.latestReviewNote = note;
      data.latestReviewAt = new Date();
      reviewChanges.push("review note updated");
    }
  }
  if (input.estimatedDiscussionMinutes !== undefined) {
    data.estimatedDiscussionMinutes = input.estimatedDiscussionMinutes || null;
  }

  let current = task;
  if (Object.keys(data).length > 0) {
    current = await tx.task.update({ where: { id: task.id }, data });
    if (reviewChanges.length > 0) {
      await logEvent(tx, {
        taskId: task.id,
        type: "REVIEW_UPDATED",
        userId,
        reason: [reviewChanges.join(", "), input.reason?.trim()].filter(Boolean).join(": "),
      });
    }
  }

  if (input.cancelled === true && current.scheduleState !== "CANCELLED") {
    current = await tx.task.update({
      where: { id: task.id },
      data: { scheduleState: "CANCELLED", scheduleReason: input.reason?.trim() || "Removed from meeting schedule" },
    });
    await logEvent(tx, {
      taskId: task.id,
      type: "CANCELLED",
      userId,
      fromDate: toISODateOrNull(current.nextDiscussionDate),
      reason: input.reason?.trim() || "Removed from meeting schedule",
    });
    return current;
  }

  const restoring = input.cancelled === false && current.scheduleState === "CANCELLED";
  if (restoring) {
    current = await tx.task.update({ where: { id: task.id }, data: { scheduleState: "SCHEDULED" } });
  }

  const frequencyChanged =
    input.discussionFrequency !== undefined && input.discussionFrequency !== current.discussionFrequency;
  const ordinalChanged =
    input.monthlyMondayOrdinal !== undefined &&
    (input.monthlyMondayOrdinal ?? null) !== current.monthlyMondayOrdinal &&
    (input.discussionFrequency ?? current.discussionFrequency) === "NM";

  if (frequencyChanged || ordinalChanged || restoring || input.recalculate) {
    const frequency =
      input.discussionFrequency !== undefined ? input.discussionFrequency : current.discussionFrequency;
    const ordinal =
      input.monthlyMondayOrdinal !== undefined ? input.monthlyMondayOrdinal : current.monthlyMondayOrdinal;
    const patch = planFrequencyChange(
      toSchedulable(current),
      frequency,
      ordinal ?? null,
      today(),
      Boolean(input.recalculate || restoring)
    );
    current = await applyPatch(tx, current, patch, {
      type: current.discussionFrequency ? eventType : "INITIALIZED",
      userId,
      reason: input.reason?.trim() ? `${patch.scheduleReason} (${input.reason.trim()})` : patch.scheduleReason,
    });
  }

  if (input.pinnedDate) {
    const patch = planPinnedDate(toSchedulable(current), input.pinnedDate, input.reason ?? "");
    current = await applyPatch(tx, current, patch, { type: "RESCHEDULED", userId });
  }

  return current;
}

/**
 * Bring a task forward to a meeting and, if that meeting already has a stored
 * agenda that is not closed, put it on that agenda straight away.
 */
export async function bringForward(
  tx: Tx,
  task: Task,
  toDate: ISODate | null,
  reason: string,
  userId: string | null
): Promise<Task> {
  const target = toDate ?? mondayOnOrAfter(today());
  const patch = planBringForward(toSchedulable(task), { toDate: target, reason, today: today() });
  const meeting = await tx.meeting.findUnique({ where: { meetingDate: fromISODate(target) } });
  const updated = await applyPatch(tx, task, patch, {
    type: "BROUGHT_FORWARD",
    userId,
    meetingId: meeting?.id ?? null,
  });

  if (meeting && meeting.status !== "CLOSED") {
    const existing = await tx.meetingAgendaItem.findUnique({
      where: { meetingId_taskId: { meetingId: meeting.id, taskId: task.id } },
    });
    if (!existing) {
      await tx.meetingAgendaItem.create({
        data: {
          meetingId: meeting.id,
          taskId: task.id,
          section: "URGENT",
          inclusion: "BROUGHT_FORWARD",
          reason: patch.scheduleReason ?? "Brought forward",
          estimatedMinutes: discussionMinutes(toSchedulable(task), schedulingConfig()),
        },
      });
    } else if (existing.outcome === "PENDING") {
      await tx.meetingAgendaItem.update({
        where: { id: existing.id },
        data: { section: "URGENT", inclusion: "BROUGHT_FORWARD", reason: patch.scheduleReason ?? existing.reason },
      });
    }
  }
  return updated;
}

export function ensureOpen(task: Task | null): Task {
  if (!task || task.deletedAt) throw new SchedulingError("Task not found", "NOT_FOUND", 404);
  if (isTaskClosed(toSchedulable(task))) {
    throw new SchedulingError("This task is completed or cancelled.", "CLOSED", 409);
  }
  return task;
}
