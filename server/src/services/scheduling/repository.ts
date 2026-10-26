// Glue between the Prisma models and the pure scheduling rules: converting
// rows to rule inputs, writing schedule changes with an audit event, and
// keeping a stored meeting agenda in step with the rules.

import type { Meeting, MeetingAgendaItem, Prisma, ScheduleEventType, Task } from "@prisma/client";
import { defaultSchedulingConfig } from "./config";
import { fromISODate, fromISODateOrNull, todayISO, toISODate, toISODateOrNull, type ISODate } from "./dates";
import { buildAgenda, type AgendaResult, type ExistingAgendaItem, type SchedulableTask, type SchedulePatch } from "./rules";

export type Tx = Prisma.TransactionClient;

/** Options for interactive transactions over a remote database. */
export const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export function today(): ISODate {
  return todayISO(defaultSchedulingConfig.timeZone);
}

export function toSchedulable(task: Task): SchedulableTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    deleted: task.deletedAt !== null,
    frequency: task.discussionFrequency,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
    nextDiscussionDate: toISODateOrNull(task.nextDiscussionDate),
    originalDiscussionDate: toISODateOrNull(task.originalDiscussionDate),
    scheduleState: task.scheduleState,
    scheduleReason: task.scheduleReason,
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

/** Write a schedule change to a task and record it in the history. */
export async function applyPatch(
  tx: Tx,
  task: Task,
  patch: SchedulePatch,
  event: Pick<EventInput, "type" | "userId" | "meetingId" | "reason">
): Promise<Task> {
  const updated = await tx.task.update({ where: { id: task.id }, data: patchToData(patch) });
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
    outcome: item.outcome,
  };
}

/** Agenda for a date: tasks that can be due then, plus any already stored on it. */
export async function computeAgenda(
  tx: Tx,
  meetingDate: ISODate,
  storedItems: MeetingAgendaItem[]
): Promise<{ tasks: Task[]; result: AgendaResult }> {
  const storedIds = storedItems.map((i) => i.taskId);
  const tasks = await tx.task.findMany({
    where: {
      OR: [
        {
          deletedAt: null,
          status: { not: "COMPLETED" },
          scheduleState: { not: "CANCELLED" },
          nextDiscussionDate: { lte: fromISODate(meetingDate) },
        },
        ...(storedIds.length ? [{ id: { in: storedIds } }] : []),
      ],
    },
  });
  const result = buildAgenda({
    meetingDate,
    tasks: tasks.map(toSchedulable),
    existingItems: storedItems.map(itemToExisting),
  });
  return { tasks, result };
}

/**
 * Bring the stored agenda of a meeting in line with the rules: add newly due
 * tasks, refresh pending ones, remove pending ones that are no longer due.
 * Items with a recorded outcome are never touched. Safe to call repeatedly;
 * the (meetingId, taskId) unique key prevents duplicates.
 */
export async function syncMeetingAgenda(tx: Tx, meeting: Meeting): Promise<void> {
  const meetingDate = toISODate(meeting.meetingDate);
  const stored = await tx.meetingAgendaItem.findMany({ where: { meetingId: meeting.id } });
  const { result } = await computeAgenda(tx, meetingDate, stored);
  const storedByTask = new Map(stored.map((i) => [i.taskId, i]));

  const toCreate = result.entries.filter((e) => !e.locked && !storedByTask.has(e.taskId));
  if (toCreate.length) {
    await tx.meetingAgendaItem.createMany({
      data: toCreate.map((e) => ({
        meetingId: meeting.id,
        taskId: e.taskId,
        section: e.section,
        inclusion: e.inclusion,
        reason: e.reason,
      })),
      skipDuplicates: true,
    });
  }

  for (const e of result.entries) {
    const existing = storedByTask.get(e.taskId);
    if (
      !e.locked &&
      existing &&
      (existing.section !== e.section || existing.reason !== e.reason || existing.inclusion !== e.inclusion)
    ) {
      await tx.meetingAgendaItem.update({
        where: { id: existing.id },
        data: { section: e.section, reason: e.reason, inclusion: e.inclusion },
      });
    }
  }

  if (result.dropped.length) {
    await tx.meetingAgendaItem.deleteMany({
      where: { meetingId: meeting.id, taskId: { in: result.dropped.map((d) => d.taskId) }, outcome: "PENDING" },
    });
  }
}

/** Re-sync stored agendas of meetings from today on, after a schedule change. */
export async function syncUpcomingMeetings(tx: Tx): Promise<void> {
  const meetings = await tx.meeting.findMany({
    where: { meetingDate: { gte: fromISODate(today()) } },
  });
  for (const meeting of meetings) await syncMeetingAgenda(tx, meeting);
}
