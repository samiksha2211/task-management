import type { Meeting, MeetingAgendaItem, Task, User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { param, queryString } from "../lib/http";
import {
  exportAgendaToCsv,
  exportAgendaToXlsx,
  type AgendaExportRow,
} from "../lib/meetingExport";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";
import { bringForward, ensureOpen, updateTaskSchedule } from "../services/scheduling/actions";
import { FREQUENCY_LABEL, normalizePriority } from "../services/scheduling/config";
import {
  fromISODate,
  isISODate,
  isMonday,
  mondayOnOrAfter,
  toISODate,
  toISODateOrNull,
  type ISODate,
} from "../services/scheduling/dates";
import {
  isTaskClosed,
  planDefer,
  planDiscussed,
  planInitialization,
  proposeReview,
  recommendDeferrals,
  SchedulingError,
  SECTION_LABEL,
  SECTION_ORDER,
  summarizeLoad,
  type AgendaEntry,
  type AgendaSectionValue,
} from "../services/scheduling/rules";
import {
  applyPatch,
  computeAgenda,
  itemToExisting,
  logEvent,
  patchToData,
  schedulingConfig,
  syncMeetingAgenda,
  syncOpenMeetings,
  today,
  toSchedulable,
  TX_OPTIONS,
  type Tx,
} from "../services/scheduling/repository";

// ---------------------------------------------------------------------------
// Validation

const isoDate = z.string().refine(isISODate, "must be a date (YYYY-MM-DD)");
const mondayDate = isoDate.refine(isMonday, "must be a Monday");
const frequency = z.enum(["M", "F", "NM"]);
const ordinal = z.union([z.literal(-1), z.number().int().min(1).max(4)]).nullable();
const priority = z.string().trim().max(30).nullable();

const settingsSchema = z.object({
  discussionFrequency: frequency.nullable().optional(),
  monthlyMondayOrdinal: ordinal.optional(),
  recalculate: z.boolean().optional(),
  priority: priority.optional(),
  estimatedDiscussionMinutes: z.number().int().min(1).max(240).nullable().optional(),
  isBlocked: z.boolean().optional(),
  flaggedForReview: z.boolean().optional(),
  latestReviewNote: z.string().max(5000).nullable().optional(),
  pinnedDate: mondayDate.nullable().optional(),
  cancelled: z.boolean().optional(),
  reason: z.string().max(1000).nullable().optional(),
});

const reviewUpdate = z.object({
  taskId: z.string().min(1),
  priority: priority.optional(),
  isBlocked: z.boolean().optional(),
  flaggedForReview: z.boolean().optional(),
  latestReviewNote: z.string().max(5000).nullable().optional(),
  needsDiscussion: z.boolean().optional(),
  bringForward: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});

function meetingDateParam(req: AuthRequest): ISODate {
  return validate(mondayDate, param(req, "date"));
}

function notFound(message: string): SchedulingError {
  return new SchedulingError(message, "NOT_FOUND", 404);
}

// ---------------------------------------------------------------------------
// Agenda view

type TaskWithOfficer = Task & { officer: User };

export interface AgendaItemView {
  taskId: string;
  title: string;
  officer: string;
  status: "Pending" | "Completed" | "Overdue";
  dueDate: string;
  frequency: Task["discussionFrequency"];
  monthlyMondayOrdinal: number | null;
  priority: string;
  lastDiscussedAt: string | null;
  nextDiscussionDate: string | null;
  originalDiscussionDate: string | null;
  scheduleState: Task["scheduleState"];
  scheduleReason: string | null;
  isBlocked: boolean;
  flaggedForReview: boolean;
  latestReviewNote: string | null;
  estimatedMinutes: number;
  section: AgendaSectionValue;
  inclusion: AgendaEntry["inclusion"];
  reason: string;
  outcome: AgendaEntry["outcome"];
  discussionNotes: string | null;
  decisions: string | null;
  deferredTo: string | null;
  deferReason: string | null;
  stored: boolean;
}

function taskStatusLabel(task: Task, onDate: ISODate): AgendaItemView["status"] {
  if (task.status === "COMPLETED") return "Completed";
  return toISODate(task.dueDate) < onDate ? "Overdue" : "Pending";
}

function itemView(
  entry: AgendaEntry,
  task: TaskWithOfficer,
  stored: MeetingAgendaItem | undefined,
  meetingDate: ISODate
): AgendaItemView {
  return {
    taskId: task.id,
    title: task.title,
    officer: task.officer.designation,
    status: taskStatusLabel(task, meetingDate),
    dueDate: toISODate(task.dueDate),
    frequency: task.discussionFrequency,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    priority: normalizePriority(task.priority),
    lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
    nextDiscussionDate: toISODateOrNull(task.nextDiscussionDate),
    originalDiscussionDate: toISODateOrNull(task.originalDiscussionDate),
    scheduleState: task.scheduleState,
    scheduleReason: task.scheduleReason,
    isBlocked: task.isBlocked,
    flaggedForReview: task.flaggedForReview,
    latestReviewNote: task.latestReviewNote,
    estimatedMinutes: entry.estimatedMinutes,
    section: entry.section,
    inclusion: entry.inclusion,
    reason: entry.reason,
    outcome: entry.outcome,
    discussionNotes: stored?.discussionNotes ?? null,
    decisions: stored?.decisions ?? null,
    deferredTo: toISODateOrNull(stored?.deferredTo),
    deferReason: stored?.deferReason ?? null,
    stored: Boolean(stored),
  };
}

function meetingView(meeting: Meeting | null) {
  if (!meeting) return null;
  return {
    id: meeting.id,
    meetingDate: toISODate(meeting.meetingDate),
    status: meeting.status,
    durationLimitMinutes: meeting.durationLimitMinutes,
    notes: meeting.notes,
    reportUrl: meeting.reportUrl,
    reportName: meeting.reportName,
    finalizedAt: meeting.finalizedAt?.toISOString() ?? null,
    closedAt: meeting.closedAt?.toISOString() ?? null,
  };
}

/**
 * The agenda for a meeting date. A draft (or not yet saved) agenda is always
 * computed fresh from the rules; a finalized or closed one shows what was
 * stored, minus pending items whose task has since been completed.
 */
async function buildAgendaView(meetingDate: ISODate) {
  const config = schedulingConfig();
  const meeting = await prisma.meeting.findUnique({
    where: { meetingDate: fromISODate(meetingDate) },
    include: { items: true },
  });
  const stored = meeting?.items ?? [];
  const storedByTask = new Map(stored.map((i) => [i.taskId, i]));
  const { tasks, result } = await computeAgenda(prisma, meetingDate, stored);
  const closedIds = new Set(tasks.filter((t) => isTaskClosed(toSchedulable(t))).map((t) => t.id));

  let entries: AgendaEntry[];
  let unsavedChanges = 0;
  if (!meeting || meeting.status === "DRAFT") {
    entries = result.entries;
    if (meeting) {
      unsavedChanges =
        result.dropped.length +
        result.entries.filter((e) => {
          const s = storedByTask.get(e.taskId);
          return !s || s.section !== e.section || s.reason !== e.reason || s.estimatedMinutes !== e.estimatedMinutes;
        }).length;
    } else {
      unsavedChanges = result.entries.length;
    }
  } else {
    entries = stored
      .filter((i) => i.outcome !== "PENDING" || !closedIds.has(i.taskId))
      .map((i) => ({ ...itemToExisting(i), locked: i.outcome !== "PENDING" }))
      .sort(
        (a, b) =>
          SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
          a.taskId.localeCompare(b.taskId)
      );
  }

  const ids = entries.map((e) => e.taskId);
  const [details, unscheduled, flagged] = await Promise.all([
    prisma.task.findMany({ where: { id: { in: ids } }, include: { officer: true } }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { not: "COMPLETED" }, discussionFrequency: null, scheduleState: { not: "CANCELLED" } },
      include: { officer: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { not: "COMPLETED" },
        flaggedForReview: true,
        id: { notIn: ids },
      },
      include: { officer: true },
      orderBy: { nextDiscussionDate: "asc" },
    }),
  ]);
  const detailById = new Map(details.map((t) => [t.id, t]));
  const items = entries
    .filter((e) => detailById.has(e.taskId))
    .map((e) => itemView(e, detailById.get(e.taskId)!, storedByTask.get(e.taskId), meetingDate));

  // Titles sort within a section once the full task details are known.
  items.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      ["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(a.priority) -
        ["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(b.priority) ||
      a.title.localeCompare(b.title)
  );

  const limitMinutes = meeting?.durationLimitMinutes ?? config.defaultMeetingMinutes;
  const load = summarizeLoad(entries, limitMinutes);
  const recommendations =
    !meeting || meeting.status === "DRAFT"
      ? recommendDeferrals({
          entries,
          tasks: tasks.map(toSchedulable),
          meetingDate,
          limitMinutes,
          config,
        })
      : [];

  const brief = (t: TaskWithOfficer) => ({
    taskId: t.id,
    title: t.title,
    officer: t.officer.designation,
    status: taskStatusLabel(t, meetingDate),
    dueDate: toISODate(t.dueDate),
    priority: normalizePriority(t.priority),
    frequency: t.discussionFrequency,
    nextDiscussionDate: toISODateOrNull(t.nextDiscussionDate),
    latestReviewNote: t.latestReviewNote,
    createdAt: t.createdAt.toISOString(),
  });

  return {
    meetingDate,
    today: today(),
    upcomingMonday: mondayOnOrAfter(today()),
    defaults: {
      meetingMinutes: config.defaultMeetingMinutes,
      discussionMinutes: config.defaultDiscussionMinutes,
    },
    meeting: meetingView(meeting),
    unsavedChanges,
    sections: SECTION_ORDER.map((key) => ({
      key,
      label: SECTION_LABEL[key],
      items: items.filter((i) => i.section === key),
    })),
    load,
    recommendations,
    unscheduled: unscheduled.map(brief),
    flagged: flagged.map(brief),
  };
}

/** Create the meeting for a date if needed; a new or draft meeting is synced. */
async function ensureMeeting(tx: Tx, meetingDate: ISODate, userId: string | null): Promise<Meeting> {
  const meeting = await tx.meeting.upsert({
    where: { meetingDate: fromISODate(meetingDate) },
    create: {
      meetingDate: fromISODate(meetingDate),
      durationLimitMinutes: schedulingConfig().defaultMeetingMinutes,
    },
    update: {},
  });
  if (meeting.status === "DRAFT") await syncMeetingAgenda(tx, meeting, userId ?? undefined);
  return meeting;
}

function changed(meetingDate?: ISODate) {
  broadcast("meeting:updated", { meetingDate: meetingDate ?? null });
  broadcast("task:updated", {});
}

// ---------------------------------------------------------------------------
// Meeting endpoints

export async function getAgenda(req: AuthRequest, res: Response): Promise<void> {
  const raw = queryString(req.query.date);
  const meetingDate = raw ? validate(mondayDate, raw) : mondayOnOrAfter(today());
  res.json(await buildAgendaView(meetingDate));
}

export async function listMeetings(_req: AuthRequest, res: Response): Promise<void> {
  const meetings = await prisma.meeting.findMany({
    orderBy: { meetingDate: "desc" },
    take: 30,
    include: { _count: { select: { items: true } } },
  });
  res.json({
    meetings: meetings.map((m) => ({ ...meetingView(m), itemCount: m._count.items })),
  });
}

/** Save (or refresh) the agenda of a draft meeting. Idempotent. */
export async function saveAgenda(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  await prisma.$transaction(async (tx) => {
    const meeting = await ensureMeeting(tx, meetingDate, req.user!.id);
    if (meeting.status !== "DRAFT") {
      throw new SchedulingError("This agenda is finalized. Reopen it to make changes.", "FINALIZED", 409);
    }
  }, TX_OPTIONS);
  changed(meetingDate);
  res.json(await buildAgendaView(meetingDate));
}

const meetingUpdateSchema = z.object({
  durationLimitMinutes: z.number().int().min(10).max(600).optional(),
  notes: z.string().max(10000).nullable().optional(),
  reportUrl: z.string().max(2000).nullable().optional(),
  reportName: z.string().max(500).nullable().optional(),
});

export async function updateMeeting(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const body = validate(meetingUpdateSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const meeting = await ensureMeeting(tx, meetingDate, req.user!.id);
    await tx.meeting.update({ where: { id: meeting.id }, data: body });
  }, TX_OPTIONS);
  changed(meetingDate);
  res.json(await buildAgendaView(meetingDate));
}

const statusSchema = z.object({ status: z.enum(["DRAFT", "FINALIZED", "CLOSED"]) });

/**
 * DRAFT -> FINALIZED: freeze the agenda after final review.
 * -> CLOSED: the meeting is over; items with no outcome become "not discussed"
 *    and so carry over to the next meeting automatically.
 * -> DRAFT: reopen for editing (the agenda is re-synced).
 */
export async function setMeetingStatus(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const { status } = validate(statusSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const meeting = await ensureMeeting(tx, meetingDate, req.user!.id);
    if (status === "FINALIZED") {
      await tx.meeting.update({ where: { id: meeting.id }, data: { status, finalizedAt: new Date() } });
    } else if (status === "CLOSED") {
      await tx.meetingAgendaItem.updateMany({
        where: { meetingId: meeting.id, outcome: "PENDING" },
        data: { outcome: "NOT_DISCUSSED", outcomeAt: new Date() },
      });
      await tx.meeting.update({ where: { id: meeting.id }, data: { status, closedAt: new Date() } });
    } else {
      const reopened = await tx.meeting.update({
        where: { id: meeting.id },
        data: { status, finalizedAt: null, closedAt: null },
      });
      await syncMeetingAgenda(tx, reopened, req.user!.id);
    }
  }, TX_OPTIONS);
  changed(meetingDate);
  res.json(await buildAgendaView(meetingDate));
}

const addItemSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

/** Explicitly add a task to a meeting without changing its regular schedule. */
export async function addAgendaItem(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const body = validate(addItemSchema, req.body);
  try {
    await prisma.$transaction(async (tx) => {
      const task = ensureOpen(await tx.task.findUnique({ where: { id: body.taskId } }));
      const meeting = await ensureMeeting(tx, meetingDate, req.user!.id);
      if (meeting.status === "CLOSED") throw new SchedulingError("This meeting is closed.", "CLOSED", 409);
      const schedulable = toSchedulable(task);
      await tx.meetingAgendaItem.create({
        data: {
          meetingId: meeting.id,
          taskId: task.id,
          section: normalizePriority(task.priority) === "URGENT" ? "URGENT" : task.isBlocked ? "BLOCKED_OVERDUE" : "NEW",
          inclusion: "MANUAL",
          reason: `Added to this meeting: ${body.reason}`,
          estimatedMinutes: schedulable.estimatedMinutes ?? schedulingConfig().defaultDiscussionMinutes,
        },
      });
      await logEvent(tx, {
        taskId: task.id,
        type: "ADDED_TO_AGENDA",
        meetingId: meeting.id,
        userId: req.user!.id,
        toDate: meetingDate,
        reason: body.reason,
      });
      // Put the item in the right section.
      if (meeting.status === "DRAFT") await syncMeetingAgenda(tx, meeting, req.user!.id);
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SchedulingError("This task is already on the agenda for this meeting.", "DUPLICATE", 409);
    }
    throw error;
  }
  changed(meetingDate);
  res.status(201).json(await buildAgendaView(meetingDate));
}

/** Remove a manually added item. Due items are deferred instead, so they are not lost. */
export async function removeAgendaItem(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const taskId = param(req, "taskId");
  await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findUnique({ where: { meetingDate: fromISODate(meetingDate) } });
    const item = meeting
      ? await tx.meetingAgendaItem.findUnique({ where: { meetingId_taskId: { meetingId: meeting.id, taskId } } })
      : null;
    if (!meeting || !item) throw notFound("This task is not on the saved agenda.");
    if (item.inclusion !== "MANUAL" || item.outcome !== "PENDING") {
      throw new SchedulingError(
        "Only manually added items with no outcome can be removed. Defer the task instead.",
        "NOT_REMOVABLE",
        409
      );
    }
    await tx.meetingAgendaItem.delete({ where: { id: item.id } });
    await logEvent(tx, {
      taskId,
      type: "REMOVED_FROM_AGENDA",
      meetingId: meeting.id,
      userId: req.user!.id,
      fromDate: meetingDate,
      reason: "Removed by user",
    });
  }, TX_OPTIONS);
  changed(meetingDate);
  res.json(await buildAgendaView(meetingDate));
}

const outcomeSchema = z.object({
  outcome: z.enum(["PENDING", "DISCUSSED", "NOT_DISCUSSED"]),
  discussionNotes: z.string().max(10000).nullable().optional(),
  decisions: z.string().max(10000).nullable().optional(),
});

/**
 * Record whether a task was actually discussed. Only DISCUSSED moves the
 * task's schedule; it can be undone, which restores the previous schedule.
 */
export async function recordOutcome(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const taskId = param(req, "taskId");
  const body = validate(outcomeSchema, req.body);
  const userId = req.user!.id;

  await prisma.$transaction(async (tx) => {
    const meeting = await ensureMeeting(tx, meetingDate, userId);
    const item = await tx.meetingAgendaItem.findUnique({
      where: { meetingId_taskId: { meetingId: meeting.id, taskId } },
    });
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!item || !task) throw notFound("This task is not on the agenda for this meeting.");
    if (item.outcome === "DEFERRED") {
      throw new SchedulingError(
        "This task was deferred from this meeting. Bring it forward to discuss it here.",
        "DEFERRED",
        409
      );
    }

    const notes: Prisma.MeetingAgendaItemUpdateInput = {};
    if (body.discussionNotes !== undefined) notes.discussionNotes = body.discussionNotes?.trim() || null;
    if (body.decisions !== undefined) notes.decisions = body.decisions?.trim() || null;

    if (body.outcome === item.outcome) {
      if (Object.keys(notes).length) await tx.meetingAgendaItem.update({ where: { id: item.id }, data: notes });
      return;
    }

    if (body.outcome === "DISCUSSED") {
      const patch = planDiscussed(toSchedulable(task), meetingDate);
      await tx.meetingAgendaItem.update({
        where: { id: item.id },
        data: {
          ...notes,
          outcome: "DISCUSSED",
          outcomeAt: new Date(),
          prevLastDiscussedAt: task.lastDiscussedAt,
          prevNextDiscussionDate: task.nextDiscussionDate,
          prevScheduleState: task.scheduleState,
          prevOriginalDate: task.originalDiscussionDate,
          prevScheduleReason: task.scheduleReason,
        },
      });
      const decided = body.decisions?.trim() || body.discussionNotes?.trim();
      await applyPatch(tx, task, patch, {
        type: "DISCUSSED",
        meetingId: meeting.id,
        userId,
        reason: decided ? `${patch.scheduleReason}. ${decided}` : patch.scheduleReason,
      });
      return;
    }

    if (item.outcome === "DISCUSSED") {
      // Undo: only safe while this meeting is still the task's latest discussion.
      if (toISODateOrNull(task.lastDiscussedAt) !== meetingDate) {
        throw new SchedulingError(
          "The task has been discussed again since, so this outcome can no longer be undone.",
          "STALE",
          409
        );
      }
      await tx.task.update({
        where: { id: task.id },
        data: {
          lastDiscussedAt: item.prevLastDiscussedAt,
          nextDiscussionDate: item.prevNextDiscussionDate,
          scheduleState: item.prevScheduleState ?? "SCHEDULED",
          originalDiscussionDate: item.prevOriginalDate,
          scheduleReason: item.prevScheduleReason,
        },
      });
      await logEvent(tx, {
        taskId,
        type: "DISCUSSION_UNDONE",
        meetingId: meeting.id,
        userId,
        fromDate: toISODateOrNull(task.nextDiscussionDate),
        toDate: toISODateOrNull(item.prevNextDiscussionDate),
        reason: `Outcome changed to ${body.outcome === "PENDING" ? "pending" : "not discussed"}`,
      });
    }

    await tx.meetingAgendaItem.update({
      where: { id: item.id },
      data: {
        ...notes,
        outcome: body.outcome,
        outcomeAt: body.outcome === "PENDING" ? null : new Date(),
        prevLastDiscussedAt: null,
        prevNextDiscussionDate: null,
        prevScheduleState: null,
        prevOriginalDate: null,
        prevScheduleReason: null,
      },
    });
  }, TX_OPTIONS);

  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed(meetingDate);
  res.json(await buildAgendaView(meetingDate));
}

const SECTION_EXPORT_LABEL = SECTION_LABEL;
const OUTCOME_LABEL: Record<string, string> = {
  PENDING: "Pending",
  DISCUSSED: "Discussed",
  NOT_DISCUSSED: "Not discussed",
  DEFERRED: "Deferred",
};

export async function exportAgenda(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = meetingDateParam(req);
  const format = (queryString(req.query.format) ?? "xlsx").toLowerCase() === "csv" ? "csv" : "xlsx";
  const view = await buildAgendaView(meetingDate);
  const items = view.sections.flatMap((s) => s.items);

  const rows: AgendaExportRow[] = items.map((item, index) => ({
    serial: index + 1,
    taskId: item.taskId,
    title: item.title,
    coordinator: item.officer,
    section: SECTION_EXPORT_LABEL[item.section],
    status: item.status,
    frequency: item.frequency ? `${item.frequency} (${FREQUENCY_LABEL[item.frequency]})` : "",
    priority: item.priority.charAt(0) + item.priority.slice(1).toLowerCase(),
    lastDiscussed: item.lastDiscussedAt,
    nextDiscussion: item.nextDiscussionDate,
    estimatedMinutes: item.estimatedMinutes,
    latestReviewNote: item.latestReviewNote ?? "",
    schedulingReason: item.outcome === "DEFERRED" && item.deferReason
      ? `${item.reason}. Deferred to ${item.deferredTo}: ${item.deferReason}`
      : item.reason,
    outcome: OUTCOME_LABEL[item.outcome],
    notes: [item.discussionNotes, item.decisions ? `Decision: ${item.decisions}` : null].filter(Boolean).join("\n"),
    meetingDate,
  }));

  const status = view.meeting?.status ?? "PREVIEW";
  const suffix = status === "FINALIZED" || status === "CLOSED" ? "" : `_${status.toLowerCase()}`;
  const filename = `monday_agenda_${meetingDate}${suffix}.${format}`;

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(exportAgendaToCsv(rows)));
    return;
  }

  const buffer = await exportAgendaToXlsx(rows, {
    meetingDate,
    status,
    taskCount: view.load.taskCount,
    totalMinutes: view.load.totalMinutes,
    limitMinutes: view.load.limitMinutes,
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

// ---------------------------------------------------------------------------
// Task schedule endpoints

export async function updateSchedule(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(settingsSchema, req.body);
  const userId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    await updateTaskSchedule(tx, task, body, userId);
  }, TX_OPTIONS);
  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed();
  res.json({ success: true });
}

const deferSchema = z.object({
  toDate: mondayDate,
  reason: z.string().trim().min(1, "A reason is required").max(1000),
  meetingDate: mondayDate.optional(),
  confirmed: z.boolean().optional(),
});

export async function deferTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(deferSchema, req.body);
  const userId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    const fromDate = body.meetingDate ?? today();
    const patch = planDefer(toSchedulable(task), {
      toDate: body.toDate,
      reason: body.reason,
      fromDate,
      confirmed: body.confirmed,
    });

    const meeting = body.meetingDate
      ? await tx.meeting.findUnique({ where: { meetingDate: fromISODate(body.meetingDate) } })
      : null;
    const item = meeting
      ? await tx.meetingAgendaItem.findUnique({ where: { meetingId_taskId: { meetingId: meeting.id, taskId: task.id } } })
      : null;
    if (item?.outcome === "DISCUSSED") {
      throw new SchedulingError("This task was already discussed at this meeting.", "DISCUSSED", 409);
    }
    if (item) {
      await tx.meetingAgendaItem.update({
        where: { id: item.id },
        data: {
          outcome: "DEFERRED",
          outcomeAt: new Date(),
          deferredTo: fromISODate(body.toDate),
          deferReason: body.reason,
        },
      });
    }
    await applyPatch(tx, task, patch, { type: "DEFERRED", userId, meetingId: meeting?.id ?? null });
  }, TX_OPTIONS);
  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed(body.meetingDate);
  res.json({ success: true });
}

const bringForwardSchema = z.object({
  toDate: mondayDate.optional(),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

export async function bringTaskForward(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(bringForwardSchema, req.body);
  const userId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    const task = ensureOpen(await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } }));
    await bringForward(tx, task, body.toDate ?? null, body.reason, userId);
  }, TX_OPTIONS);
  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed(body.toDate);
  res.json({ success: true });
}

export async function completeTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(z.object({ reason: z.string().max(1000).optional() }), req.body ?? {});
  const userId = req.user!.id;
  const taskId = param(req, "id");
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, deletedAt: null } });
    if (!task) throw notFound("Task not found");
    if (task.status === "COMPLETED") return;
    await tx.task.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
    await logEvent(tx, {
      taskId: task.id,
      type: "COMPLETED",
      userId,
      fromDate: toISODateOrNull(task.nextDiscussionDate),
      reason: body.reason?.trim() || "Marked completed from the meeting agenda",
    });
  }, TX_OPTIONS);
  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed();
  broadcast("task:updated", { id: taskId });
  res.json({ success: true });
}

const initializeSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(1000),
  discussionFrequency: frequency,
  monthlyMondayOrdinal: ordinal.optional(),
});

/**
 * Give existing (unscheduled) tasks a frequency in bulk. Only tasks that have
 * no frequency yet are touched; tasks with the same resulting schedule are
 * written together.
 */
export async function initializeSchedules(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(initializeSchema, req.body);
  const userId = req.user!.id;
  let count = 0;
  await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: { id: { in: body.taskIds }, deletedAt: null, discussionFrequency: null },
    });
    const plans = planInitialization(
      tasks.map(toSchedulable),
      body.discussionFrequency,
      today(),
      body.monthlyMondayOrdinal ?? null
    );
    const groups = new Map<string, string[]>();
    for (const [taskId, patch] of plans) {
      const key = JSON.stringify(patch);
      groups.set(key, [...(groups.get(key) ?? []), taskId]);
    }
    for (const [key, ids] of groups) {
      await tx.task.updateMany({
        where: { id: { in: ids }, discussionFrequency: null },
        data: patchToData(JSON.parse(key)) as Prisma.TaskUncheckedUpdateManyInput,
      });
    }
    await tx.taskScheduleEvent.createMany({
      data: [...plans].map(([taskId, patch]) => ({
        taskId,
        type: "INITIALIZED" as const,
        userId,
        toDate: patch.nextDiscussionDate ? fromISODate(patch.nextDiscussionDate) : null,
        toFrequency: body.discussionFrequency,
        reason: patch.scheduleReason,
      })),
    });
    count = plans.size;
  }, TX_OPTIONS);
  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed();
  res.json({ initialized: count });
}

export async function taskHistory(req: AuthRequest, res: Response): Promise<void> {
  const taskId = param(req, "id");
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task not found");
  const [events, items] = await Promise.all([
    prisma.taskScheduleEvent.findMany({
      where: { taskId },
      include: { user: true, meeting: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.meetingAgendaItem.findMany({
      where: { taskId },
      include: { meeting: true },
      orderBy: { meeting: { meetingDate: "desc" } },
    }),
  ]);
  res.json({
    task: {
      id: task.id,
      title: task.title,
      frequency: task.discussionFrequency,
      lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
      nextDiscussionDate: toISODateOrNull(task.nextDiscussionDate),
      scheduleState: task.scheduleState,
      scheduleReason: task.scheduleReason,
    },
    meetings: items.map((i) => ({
      meetingDate: toISODate(i.meeting.meetingDate),
      section: i.section,
      outcome: i.outcome,
      reason: i.reason,
      discussionNotes: i.discussionNotes,
      decisions: i.decisions,
      deferredTo: toISODateOrNull(i.deferredTo),
      deferReason: i.deferReason,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt.toISOString(),
      by: e.user?.designation ?? e.user?.name ?? null,
      meetingDate: e.meeting ? toISODate(e.meeting.meetingDate) : null,
      fromDate: toISODateOrNull(e.fromDate),
      toDate: toISODateOrNull(e.toDate),
      fromFrequency: e.fromFrequency,
      toFrequency: e.toFrequency,
      reason: e.reason,
    })),
  });
}

// ---------------------------------------------------------------------------
// Monday PDF review

const reviewSchema = z.object({
  meetingDate: mondayDate,
  updates: z.array(reviewUpdate).min(1).max(500),
});

/** Suggestions only; nothing is written. */
export async function proposeReviewChanges(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(reviewSchema, req.body);
  const tasks = await prisma.task.findMany({ where: { id: { in: body.updates.map((u) => u.taskId) } } });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  res.json({
    proposals: body.updates
      .filter((u) => byId.has(u.taskId))
      .map((u) => ({ taskId: u.taskId, ...proposeReview(toSchedulable(byId.get(u.taskId)!), u, body.meetingDate) })),
  });
}

/**
 * Apply confirmed review changes. Each task is updated in its own transaction,
 * so one invalid row does not undo the others; failures are reported back.
 */
export async function applyReviewChanges(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(reviewSchema, req.body);
  const userId = req.user!.id;
  const results: { taskId: string; ok: boolean; error?: string; broughtForward?: boolean }[] = [];

  for (const update of body.updates) {
    try {
      let broughtForward = false;
      await prisma.$transaction(async (tx) => {
        const task = await tx.task.findFirst({ where: { id: update.taskId, deletedAt: null } });
        if (!task) throw notFound("Task not found");
        const updated = await updateTaskSchedule(
          tx,
          task,
          {
            priority: update.priority,
            isBlocked: update.isBlocked,
            flaggedForReview: update.flaggedForReview,
            latestReviewNote: update.latestReviewNote,
            reason: "Monday PDF review",
          },
          userId
        );
        const nextDate = toISODateOrNull(updated.nextDiscussionDate);
        if (update.bringForward && (!nextDate || nextDate > body.meetingDate)) {
          await bringForward(
            tx,
            ensureOpen(updated),
            body.meetingDate,
            update.reason?.trim() || "Raised in Monday PDF review",
            userId
          );
          broughtForward = true;
        }
      }, TX_OPTIONS);
      results.push({ taskId: update.taskId, ok: true, broughtForward });
    } catch (error) {
      results.push({ taskId: update.taskId, ok: false, error: (error as Error).message });
    }
  }

  await prisma.$transaction((tx) => syncOpenMeetings(tx, userId), TX_OPTIONS);
  changed(body.meetingDate);
  res.json({ results });
}
