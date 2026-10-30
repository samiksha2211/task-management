import type { Prisma, Task, TaskOfficerUpdate, User } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { param, queryString } from "../lib/http";
import { exportAgendaToCsv, exportAgendaToXlsx, type AgendaExportRow } from "../lib/meetingExport";
import { exportToPdf, rowsFromTasks, type ExportTask, type PdfColumnKey, type TaskExportRow } from "../lib/export";
import { isOverdue } from "../lib/serialize";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";
import { setTaskCycle } from "../services/scheduling/actions";
import { CYCLE_LABEL, CYCLES, type Cycle } from "../services/scheduling/config";
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
  allocatedMonday,
  fmt,
  hasReschedule,
  isTaskClosed,
  nextDueDate,
  planCycleChange,
  planDiscussed,
  planReschedule,
  REVIEW_CODE,
  SchedulingError,
} from "../services/scheduling/rules";
import {
  applyPatch,
  computeAgenda,
  logEvent,
  patchToData,
  syncMeetingAgenda,
  syncUpcomingMeetings,
  today,
  toSchedulable,
  TX_OPTIONS,
} from "../services/scheduling/repository";

const isoDate = z.string().refine(isISODate, "must be a date (YYYY-MM-DD)");
const mondayDate = isoDate.refine(isMonday, "must be a Monday");
const cycleInput = z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]);
const ordinalInput = z.number().int().min(1).max(5).nullable().optional();
const anchorInput = mondayDate.nullable().optional();

function notFound(message: string): SchedulingError {
  return new SchedulingError(message, "NOT_FOUND", 404);
}

function changed(): void {
  broadcast("task:updated", {});
}

type RegisterTask = Task & {
  officer: User;
  officerUpdates: (TaskOfficerUpdate & { officer: User })[];
};

const registerInclude = {
  officer: true,
  officerUpdates: { include: { officer: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
};

type StatusLabel = "Pending" | "Overdue" | "Completed";

// Same rule as the task list: "Overdue" is a pending task past its due date.
function statusLabel(task: Task): StatusLabel {
  if (task.status === "COMPLETED") return "Completed";
  return isOverdue(task.dueDate) ? "Overdue" : "Pending";
}

/** DRM remark and the latest BO update, as one readable text. */
function latestRemarks(task: RegisterTask): string {
  const parts: string[] = [];
  if (task.remarks?.trim()) parts.push(`DRM: ${task.remarks.trim()}`);
  const bo = task.officerUpdates[0];
  const boText = bo?.remark?.trim() || bo?.actionPlan?.trim();
  if (bo && boText) parts.push(`BO (${bo.officer.designation}, ${fmt(toISODate(bo.createdAt))}): ${boText}`);
  return parts.join("\n");
}

/**
 * Review frequency, allocated Monday and scheduled date of a task, from the
 * calendar rules. The website table, the register PDFs and the agenda PDF all
 * use this, so they always show the same thing.
 */
function scheduleView(task: Task, from: ISODate) {
  const s = toSchedulable(task);
  const closed = isTaskClosed(s);
  return {
    cycle: task.discussionFrequency,
    reviewCode: task.discussionFrequency ? REVIEW_CODE[task.discussionFrequency] : null,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    fortnightAnchor: toISODateOrNull(task.fortnightAnchor),
    allocatedMonday: task.discussionFrequency ? allocatedMonday(s, from) : null,
    // A completed task has no upcoming discussion.
    nextDiscussionDate: closed ? null : nextDueDate(s, from),
    rescheduled: !closed && hasReschedule(s) && (task.nextDiscussionDate ? toISODate(task.nextDiscussionDate) >= from : false),
    scheduleReason: task.scheduleReason,
  };
}

function registerView(task: RegisterTask, from: ISODate = today()) {
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    title: task.title,
    officer: task.officer.designation,
    status: statusLabel(task),
    dueDate: toISODate(task.dueDate),
    lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
    remarks: latestRemarks(task),
    ...scheduleView(task, from),
  };
}

// ---------------------------------------------------------------------------
// Review registers

/** Every task (any status) with its review frequency, for the three views. */
export async function getRegister(_req: AuthRequest, res: Response): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null },
    include: registerInclude,
    orderBy: { taskNumber: "asc" },
  });
  const views = tasks.map((t) => registerView(t));
  res.json({
    today: today(),
    upcomingMonday: mondayOnOrAfter(today()),
    counts: {
      WEEKLY: views.filter((t) => t.cycle === "WEEKLY").length,
      FORTNIGHTLY: views.filter((t) => t.cycle === "FORTNIGHTLY").length,
      MONTHLY: views.filter((t) => t.cycle === "MONTHLY").length,
      UNASSIGNED: views.filter((t) => !t.cycle).length,
    },
    tasks: views,
  });
}

const pdfInclude = {
  officer: true,
  additionalAssignees: { include: { officer: true } },
  officerUpdates: { include: { officer: true }, orderBy: { createdAt: "asc" as const } },
  attachments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.TaskInclude;

// Register PDFs: the Task Report layout (without Action Plan TDC) with the
// review frequency next to the task.
const REGISTER_COLUMNS: PdfColumnKey[] = [
  "serial", "date", "task", "review", "coordinatorOfficer", "otherOfficers",
  "actionPlan", "executionTdc", "status", "drmRemark", "boRemark",
];

// Monday agenda PDF: the compact meeting table.
const AGENDA_COLUMNS: PdfColumnKey[] = [
  "serial", "task", "review", "allocatedMonday", "scheduledDate", "status", "latestRemark",
];

type StatusChoice = "all" | "pending" | "overdue" | "completed" | "pending_overdue";

const STATUS_CHOICE_LABEL: Record<StatusChoice, string> = {
  all: "All statuses",
  pending: "Pending",
  overdue: "Overdue",
  completed: "Completed",
  pending_overdue: "Pending / Overdue",
};

function matchesStatus(task: Task, choice: StatusChoice): boolean {
  const status = statusLabel(task);
  if (choice === "all") return true;
  if (choice === "pending_overdue") return status !== "Completed";
  return status.toLowerCase() === choice;
}

function generatedAt(): string {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

/**
 * PDF rows with the review columns filled from the calendar. With
 * `withAllocation`, the review cell also shows the allocated Monday (for PDFs
 * without a separate Allocated Monday column).
 */
function pdfRows(tasks: ExportTask[], from: ISODate, scheduledOn?: ISODate, withAllocation = false): TaskExportRow[] {
  return rowsFromTasks(tasks).map((row, i) => {
    const task = tasks[i];
    const view = scheduleView(task, from);
    const latest = latestRemarks({
      ...task,
      officerUpdates: [...task.officerUpdates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    });
    const date = scheduledOn ?? view.nextDiscussionDate;
    return {
      ...row,
      review: view.reviewCode
        ? withAllocation && view.allocatedMonday
          ? `${view.reviewCode}\n${view.allocatedMonday.replace(" · alternate weeks", ", alt. weeks")}`
          : view.reviewCode
        : "—",
      allocatedMonday: view.allocatedMonday ?? "—",
      scheduledDate: date ? fmt(date) : "—",
      latestRemark: latest || "-",
    };
  });
}

/** Rows in W, FT, M sections, numbered from 1 in each section. */
function groupedRows(rows: TaskExportRow[], tasks: ExportTask[]): TaskExportRow[] {
  const out: TaskExportRow[] = [];
  for (const cycle of [...CYCLES, null]) {
    const inCycle = rows.filter((_, i) => tasks[i].discussionFrequency === cycle);
    if (inCycle.length === 0) continue;
    const label = cycle ? `${REVIEW_CODE[cycle]} — ${CYCLE_LABEL[cycle]}` : "No review frequency";
    out.push(...inCycle.map((r, i) => ({ ...r, serial: i + 1, group: `${label} (${inCycle.length})` })));
  }
  return out;
}

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
}

const registerPdfQuery = z.object({
  cycle: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ALL"]),
  status: z.enum(["all", "pending", "overdue", "completed", "pending_overdue"]).default("all"),
});

/**
 * PDF of every task with one review frequency, or all three (one section
 * each). All statuses unless a status is chosen; "pending_overdue" = not completed.
 * Read-only: nothing is stored when it is generated.
 */
export async function downloadRegisterPdf(req: AuthRequest, res: Response): Promise<void> {
  const q = validate(registerPdfQuery, {
    cycle: (queryString(req.query.cycle) ?? "").toUpperCase(),
    status: (queryString(req.query.status) ?? "all").toLowerCase(),
  });
  const all = q.cycle === "ALL";
  const tasks = (
    await prisma.task.findMany({
      where: { deletedAt: null, discussionFrequency: all ? { not: null } : (q.cycle as Cycle) },
      include: pdfInclude,
      orderBy: [{ date: "desc" }, { taskNumber: "desc" }],
    })
  ).filter((t) => matchesStatus(t, q.status));

  const rows = pdfRows(tasks, today(), undefined, true);
  const title = all
    ? "Monday Meeting — All Review Frequencies"
    : `Monday Meeting — ${REVIEW_CODE[q.cycle as Cycle]} (${CYCLE_LABEL[q.cycle as Cycle]}) Tasks`;
  const pdf = await exportToPdf(all ? groupedRows(rows, tasks) : rows, {
    title,
    subtitle: `Status: ${STATUS_CHOICE_LABEL[q.status]}  •  W = Weekly, FT = Fortnightly, M = Monthly  •  Generated ${generatedAt()}  •  ${tasks.length} task(s)`,
    columns: REGISTER_COLUMNS,
  });
  const statusPart = q.status === "all" ? "" : `_${q.status}`;
  sendPdf(res, pdf, `monday_meeting_${q.cycle.toLowerCase()}${statusPart}_${today()}.pdf`);
}

// ---------------------------------------------------------------------------
// Review frequency and schedule

const cycleSchema = z.object({
  cycle: cycleInput.nullable(),
  monthlyMondayOrdinal: ordinalInput,
  fortnightAnchor: anchorInput,
});

export async function setCycle(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(cycleSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    await setTaskCycle(
      tx,
      task,
      body.cycle,
      { monthlyMondayOrdinal: body.monthlyMondayOrdinal, fortnightAnchor: body.fortnightAnchor },
      req.user!.id
    );
    await syncUpcomingMeetings(tx);
  }, TX_OPTIONS);
  changed();
  res.json({ success: true });
}

const bulkCycleSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(1000),
  cycle: cycleInput.nullable(),
  monthlyMondayOrdinal: ordinalInput,
  fortnightAnchor: anchorInput,
});

export async function setCycleBulk(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(bulkCycleSchema, req.body);
  let count = 0;
  await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { id: { in: body.taskIds }, deletedAt: null } });
    const options = { monthlyMondayOrdinal: body.monthlyMondayOrdinal, fortnightAnchor: body.fortnightAnchor };
    const plans = tasks
      .map((task) => ({ task, patch: planCycleChange(toSchedulable(task), body.cycle, options, today()) }))
      .filter(
        ({ task, patch }) =>
          patch.discussionFrequency !== task.discussionFrequency ||
          (patch.monthlyMondayOrdinal ?? null) !== (task.monthlyMondayOrdinal ?? null) ||
          (patch.fortnightAnchor ?? null) !== toISODateOrNull(task.fortnightAnchor) ||
          task.scheduleState !== "SCHEDULED"
      );

    // Tasks with the same resulting schedule are written together.
    const groups = new Map<string, string[]>();
    for (const { task, patch } of plans) {
      const key = JSON.stringify(patch);
      groups.set(key, [...(groups.get(key) ?? []), task.id]);
    }
    for (const [key, ids] of groups) {
      await tx.task.updateMany({
        where: { id: { in: ids } },
        data: patchToData(JSON.parse(key)) as Prisma.TaskUncheckedUpdateManyInput,
      });
    }
    await tx.taskScheduleEvent.createMany({
      data: plans.map(({ task, patch }) => ({
        taskId: task.id,
        type: task.discussionFrequency ? ("FREQUENCY_CHANGED" as const) : ("INITIALIZED" as const),
        userId: req.user!.id,
        fromFrequency: task.discussionFrequency,
        toFrequency: body.cycle,
        reason: patch.scheduleReason,
      })),
    });
    count = plans.length;
    await syncUpcomingMeetings(tx);
  }, TX_OPTIONS);
  changed();
  res.json({ updated: count });
}

const rescheduleSchema = z.object({
  toDate: mondayDate,
  /** The regular Monday being moved (default: the task's next one). */
  fromDate: mondayDate.optional(),
  reason: z.string().max(1000).optional(),
});

/** Move one review date to another Monday. The frequency and calendar are unchanged. */
export async function rescheduleTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(rescheduleSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    const patch = planReschedule(toSchedulable(task), body.toDate, body.reason ?? "", today(), body.fromDate);
    await applyPatch(tx, task, patch, {
      type: patch.scheduleState === "DEFERRED" ? "DEFERRED" : patch.scheduleState === "SCHEDULED" ? "RESCHEDULED" : "BROUGHT_FORWARD",
      userId: req.user!.id,
    });
    await syncUpcomingMeetings(tx);
  }, TX_OPTIONS);
  changed();
  res.json({ success: true });
}

export async function taskHistory(req: AuthRequest, res: Response): Promise<void> {
  const taskId = param(req, "id");
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task not found");
  const [events, items] = await Promise.all([
    prisma.taskScheduleEvent.findMany({
      where: { taskId },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.meetingAgendaItem.findMany({
      where: { taskId, outcome: { not: "PENDING" } },
      include: { meeting: true },
      orderBy: { meeting: { meetingDate: "desc" } },
    }),
  ]);
  res.json({
    meetings: items.map((i) => ({
      meetingDate: toISODate(i.meeting.meetingDate),
      outcome: i.outcome,
      notes: i.discussionNotes,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt.toISOString(),
      by: e.user?.designation ?? null,
      fromDate: toISODateOrNull(e.fromDate),
      toDate: toISODateOrNull(e.toDate),
      fromCycle: e.fromFrequency,
      toCycle: e.toFrequency,
      reason: e.reason,
    })),
  });
}

// ---------------------------------------------------------------------------
// Monday agenda

/** Tasks due on one Monday (read-only: viewing or exporting stores nothing). */
async function agendaView(meetingDate: ISODate) {
  const meeting = await prisma.meeting.findUnique({
    where: { meetingDate: fromISODate(meetingDate) },
    include: { items: true },
  });
  const stored = meeting?.items ?? [];
  const storedByTask = new Map(stored.map((i) => [i.taskId, i]));
  const { result } = await computeAgenda(prisma, meetingDate, stored);

  const details = await prisma.task.findMany({
    where: { id: { in: result.entries.map((e) => e.taskId) } },
    include: registerInclude,
  });
  const byId = new Map(details.map((t) => [t.id, t]));

  const items = result.entries
    .filter((e) => byId.has(e.taskId))
    .map((e) => {
      const task = byId.get(e.taskId)!;
      return {
        // Allocated Monday and next date as seen from this meeting.
        ...registerView(task, meetingDate),
        scheduledDate: meetingDate,
        reason: e.reason,
        inclusion: e.inclusion,
        outcome: e.outcome,
        notes: storedByTask.get(e.taskId)?.discussionNotes ?? null,
      };
    })
    .sort(
      (a, b) =>
        CYCLES.indexOf(a.cycle as Cycle) - CYCLES.indexOf(b.cycle as Cycle) || a.taskNumber - b.taskNumber
    );

  return { meetingDate, today: today(), upcomingMonday: mondayOnOrAfter(today()), items };
}

export async function getAgenda(req: AuthRequest, res: Response): Promise<void> {
  const raw = queryString(req.query.date);
  const meetingDate = raw ? validate(mondayDate, raw) : mondayOnOrAfter(today());
  res.json(await agendaView(meetingDate));
}

const outcomeSchema = z.object({
  outcome: z.enum(["DISCUSSED", "PENDING"]),
  notes: z.string().max(5000).nullable().optional(),
});

/**
 * Record that a task was discussed at this meeting, or undo that. The review
 * calendar itself does not change.
 */
export async function recordOutcome(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = validate(mondayDate, param(req, "date"));
  const taskId = param(req, "taskId");
  const body = validate(outcomeSchema, req.body);
  const userId = req.user!.id;

  await prisma.$transaction(async (tx) => {
    // One meeting per Monday and one item per task per meeting (unique keys),
    // so repeated clicks never create duplicates.
    const meeting = await tx.meeting.upsert({
      where: { meetingDate: fromISODate(meetingDate) },
      create: { meetingDate: fromISODate(meetingDate) },
      update: {},
    });
    let item = await tx.meetingAgendaItem.findUnique({ where: { meetingId_taskId: { meetingId: meeting.id, taskId } } });
    if (!item) {
      await syncMeetingAgenda(tx, meeting);
      item = await tx.meetingAgendaItem.findUnique({ where: { meetingId_taskId: { meetingId: meeting.id, taskId } } });
    }
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!item || !task) throw notFound("This task is not on the agenda for this Monday.");

    const notes = body.notes !== undefined ? { discussionNotes: body.notes?.trim() || null } : {};

    if (body.outcome === "DISCUSSED" && item.outcome !== "DISCUSSED") {
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
      await applyPatch(tx, task, patch, { type: "DISCUSSED", meetingId: meeting.id, userId });
    } else if (body.outcome === "PENDING" && item.outcome === "DISCUSSED") {
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
      await tx.meetingAgendaItem.update({
        where: { id: item.id },
        data: { ...notes, outcome: "PENDING", outcomeAt: null },
      });
      await logEvent(tx, { taskId, type: "DISCUSSION_UNDONE", meetingId: meeting.id, userId });
    } else if (body.notes !== undefined) {
      await tx.meetingAgendaItem.update({ where: { id: item.id }, data: notes });
    }
  }, TX_OPTIONS);

  changed();
  res.json(await agendaView(meetingDate));
}

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: "Not yet discussed",
  DISCUSSED: "Discussed",
  NOT_DISCUSSED: "Not discussed",
  DEFERRED: "Moved",
};

/** The agenda for one Monday as PDF, Excel or CSV. Read-only. */
export async function exportAgenda(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = validate(mondayDate, param(req, "date"));
  const format = (queryString(req.query.format) ?? "pdf").toLowerCase();
  const view = await agendaView(meetingDate);

  if (format === "pdf") {
    const unsorted = await prisma.task.findMany({
      where: { id: { in: view.items.map((i) => i.id) } },
      include: pdfInclude,
    });
    // Same order as the website agenda.
    const order = new Map(view.items.map((item, i) => [item.id, i]));
    const tasks = unsorted.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const rows = pdfRows(tasks, meetingDate, meetingDate).map((r) => ({ ...r, description: "" }));
    const pdf = await exportToPdf(groupedRows(rows, tasks), {
      title: `Monday Meeting — ${fmt(meetingDate)}`,
      subtitle: `${tasks.length} task(s) scheduled for discussion  •  W = Weekly, FT = Fortnightly, M = Monthly  •  Generated ${generatedAt()}`,
      columns: AGENDA_COLUMNS,
      labels: { task: "Task Name" },
    });
    sendPdf(res, pdf, `monday_agenda_${meetingDate}.pdf`);
    return;
  }

  const rows: AgendaExportRow[] = view.items.map((t, i) => ({
    serial: i + 1,
    taskId: t.taskNumber,
    title: t.title,
    coordinator: t.officer,
    cycle: t.reviewCode ?? "",
    allocatedMonday: t.allocatedMonday ?? "",
    status: t.status,
    lastDiscussed: t.lastDiscussedAt,
    nextDiscussion: meetingDate,
    remarks: t.remarks,
    reason: t.reason,
    outcome: OUTCOME_LABEL[t.outcome],
    notes: t.notes ?? "",
    meetingDate,
  }));
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="monday_agenda_${meetingDate}.csv"`);
    res.send(Buffer.from(exportAgendaToCsv(rows)));
    return;
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="monday_agenda_${meetingDate}.xlsx"`);
  res.send(await exportAgendaToXlsx(rows, { meetingDate, taskCount: rows.length }));
}

