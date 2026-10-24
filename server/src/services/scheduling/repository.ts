// Glue between the Prisma models and the pure scheduling rules: converting
// rows to rule inputs, writing schedule patches with an audit event, and
// keeping a stored meeting agenda in step with the rules.

import type {
  Meeting,
  MeetingAgendaItem,
  Prisma,
  ScheduleEventType,
  Task,
} from "@prisma/client";
import { defaultSchedulingConfig, type SchedulingConfig } from "./config";
import {
  fromISODate,
  fromISODateOrNull,
  todayISO,
  toISODate,
  toISODateOrNull,
  type ISODate,
} from "./dates";
import {
  buildAgenda,
  type AgendaResult,
  type ExistingAgendaItem,
  type SchedulableTask,
  type SchedulePatch,
} from "./rules";

export type Tx = Prisma.TransactionClient;

export function schedulingConfig(): SchedulingConfig {
  return defaultSchedulingConfig;
}

export function today(): ISODate {
  return todayISO(schedulingConfig().timeZone);
}

export function toSchedulable(task: Task): SchedulableTask {
  const config = schedulingConfig();
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    deleted: task.deletedAt !== null,
    createdOn: todayISO(config.timeZone, task.createdAt),
    dueDate: toISODate(task.dueDate),
    frequency: task.discussionFrequency,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
    nextDiscussionDate: toISODateOrNull(task.nextDiscussionDate),
    originalDiscussionDate: toISODateOrNull(task.originalDiscussionDate),
    scheduleState: task.scheduleState,
    scheduleReason: task.scheduleReason,
    priority: task.priority,
    isBlocked: task.isBlocked,
    flaggedForReview: task.flaggedForReview,
    estimatedMinutes: task.estimatedDiscussionMinutes,
  };
}

export function patchToData(patch: SchedulePatch): Prisma.TaskUncheckedUpdateInput {
  const data: Prisma.TaskUncheckedUpdateInput = {
    nextDiscussionDate: fromISODateOrNull(patch.nextDiscussionDate),
    scheduleState: patch.scheduleState,
    originalDiscussionDate: fromISODateOrNull(patch.originalDiscussionDate),
    scheduleReason: patch.scheduleReason,
  };
  if (patch.lastDiscussedAt !== undefined) data.lastDiscussedAt = fromISODateOrNull(patch.lastDiscussedAt);
  if (patch.discussionFrequency !== undefined) data.discussionFrequency = patch.discussionFrequency;
  if (patch.monthlyMondayOrdinal !== undefined) data.monthlyMondayOrdinal = patch.monthlyMondayOrdinal;
  return data;
}

export interface EventInput {
  taskId: string;
  type: ScheduleEventType;
  userId?: string | null;
  meetingId?: string | null;
  fromDate?: ISODate | null;
  toDate?: ISODate | null;
  fromFrequency?: Task["discussionFrequency"];
  toFrequency?: Task["discussionFrequency"];
  reason?: string | null;
}

export async function logEvent(tx: Tx, event: EventInput): Promise<void> {
  await tx.taskScheduleEvent.create({
    data: {
      taskId: event.taskId,
      type: event.type,
      userId: event.userId ?? null,
      meetingId: event.meetingId ?? null,
      fromDate: fromISODateOrNull(event.fromDate),
      toDate: fromISODateOrNull(event.toDate),
      fromFrequency: event.fromFrequency ?? null,
      toFrequency: event.toFrequency ?? null,
      reason: event.reason ?? null,
    },
  });
}

/** Write a schedule patch to a task and record it in the audit trail. */
export async function applyPatch(
  tx: Tx,
  task: Task,
  patch: SchedulePatch,
  event: Omit<EventInput, "taskId" | "fromDate" | "toDate" | "fromFrequency" | "toFrequency">,
  extra: Prisma.TaskUncheckedUpdateInput = {}
): Promise<Task> {
  const updated = await tx.task.update({
    where: { id: task.id },
    data: { ...patchToData(patch), ...extra },
  });
  await logEvent(tx, {
    ...event,
    taskId: task.id,
    fromDate: toISODateOrNull(task.nextDiscussionDate),
    toDate: patch.nextDiscussionDate,
    fromFrequency: task.discussionFrequency,
    toFrequency: updated.discussionFrequency,
    reason: event.reason ?? patch.scheduleReason,
  });
  return updated;
}

export function itemToExisting(item: MeetingAgendaItem): ExistingAgendaItem {
  return {
    taskId: item.taskId,
    section: item.section,
    inclusion: item.inclusion,
    reason: item.reason,
    estimatedMinutes: item.estimatedMinutes,
    outcome: item.outcome,
  };
}

/** Tasks that can be on the agenda for this date, plus any already stored on it. */
export async function loadAgendaTasks(
  tx: Tx,
  meetingDate: ISODate,
  storedTaskIds: string[] = []
): Promise<Task[]> {
  return tx.task.findMany({
    where: {
      OR: [
        {
          deletedAt: null,
          status: { not: "COMPLETED" },
          scheduleState: { not: "CANCELLED" },
          nextDiscussionDate: { lte: fromISODate(meetingDate) },
        },
        ...(storedTaskIds.length ? [{ id: { in: storedTaskIds } }] : []),
      ],
    },
  });
}

export async function computeAgenda(
  tx: Tx,
  meetingDate: ISODate,
  storedItems: MeetingAgendaItem[]
): Promise<{ tasks: Task[]; result: AgendaResult }> {
  const tasks = await loadAgendaTasks(
    tx,
    meetingDate,
    storedItems.map((i) => i.taskId)
  );
  const result = buildAgenda({
    meetingDate,
    tasks: tasks.map(toSchedulable),
    existingItems: storedItems.map(itemToExisting),
    config: schedulingConfig(),
  });
  return { tasks, result };
}

/**
 * Bring the stored agenda of a meeting in line with the rules: add newly due
 * tasks, refresh pending ones, remove pending ones that are no longer due.
 * Items with a recorded outcome are never touched. Safe to call repeatedly.
 */
export async function syncMeetingAgenda(tx: Tx, meeting: Meeting, userId?: string): Promise<void> {
  const meetingDate = toISODate(meeting.meetingDate);
  const stored = await tx.meetingAgendaItem.findMany({ where: { meetingId: meeting.id } });
  const { result } = await computeAgenda(tx, meetingDate, stored);
  const storedByTask = new Map(stored.map((i) => [i.taskId, i]));
  const date = fromISODate(meetingDate);

  const toCreate = result.entries.filter((e) => !e.locked && !storedByTask.has(e.taskId));
  const toUpdate = result.entries.filter((e) => {
    const existing = storedByTask.get(e.taskId);
    return (
      !e.locked &&
      !!existing &&
      (existing.section !== e.section ||
        existing.reason !== e.reason ||
        existing.estimatedMinutes !== e.estimatedMinutes ||
        existing.inclusion !== e.inclusion)
    );
  });

  if (toCreate.length) {
    // skipDuplicates + the (meetingId, taskId) unique key make a concurrent
    // regeneration harmless.
    await tx.meetingAgendaItem.createMany({
      data: toCreate.map((e) => ({
        meetingId: meeting.id,
        taskId: e.taskId,
        section: e.section,
        inclusion: e.inclusion,
        reason: e.reason,
        estimatedMinutes: e.estimatedMinutes,
      })),
      skipDuplicates: true,
    });
    await tx.taskScheduleEvent.createMany({
      data: toCreate.map((e) => ({
        taskId: e.taskId,
        type: "ADDED_TO_AGENDA" as const,
        meetingId: meeting.id,
        userId: userId ?? null,
        toDate: date,
        reason: e.reason,
      })),
    });
  }

  for (const e of toUpdate) {
    await tx.meetingAgendaItem.update({
      where: { id: storedByTask.get(e.taskId)!.id },
      data: {
        section: e.section,
        reason: e.reason,
        estimatedMinutes: e.estimatedMinutes,
        inclusion: e.inclusion,
      },
    });
  }

  if (result.dropped.length) {
    await tx.meetingAgendaItem.deleteMany({
      where: {
        meetingId: meeting.id,
        taskId: { in: result.dropped.map((d) => d.taskId) },
        outcome: "PENDING",
      },
    });
    await tx.taskScheduleEvent.createMany({
      data: result.dropped.map((d) => ({
        taskId: d.taskId,
        type: "REMOVED_FROM_AGENDA" as const,
        meetingId: meeting.id,
        userId: userId ?? null,
        fromDate: date,
        reason: d.reason,
      })),
    });
  }
}

/** Options for interactive transactions that touch a whole agenda over a remote database. */
export const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** Re-sync every open (draft) meeting from today on, after a schedule change. */
export async function syncOpenMeetings(tx: Tx, userId?: string): Promise<void> {
  const meetings = await tx.meeting.findMany({
    where: { status: "DRAFT", meetingDate: { gte: fromISODate(today()) } },
  });
  for (const meeting of meetings) await syncMeetingAgenda(tx, meeting, userId);
}
