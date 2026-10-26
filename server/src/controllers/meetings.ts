import type { Prisma, Task, TaskOfficerUpdate, User } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { param, queryString } from "../lib/http";
import { exportAgendaToCsv, exportAgendaToXlsx, type AgendaExportRow } from "../lib/meetingExport";
import { registerToPdf, type RegisterRow } from "../lib/registerPdf";
import { isOverdue } from "../lib/serialize";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";
import { setTaskCycle } from "../services/scheduling/actions";
import { CYCLE_LABEL, CYCLES, type Cycle } from "../services/scheduling/config";
import {
  fromISODate,
  fromISODateOrNull,
  isISODate,
  isMonday,
  mondayOnOrAfter,
  toISODate,
  toISODateOrNull,
  type ISODate,
} from "../services/scheduling/dates";
import { fmt, isTaskClosed, planCycleChange, planDiscussed, planReschedule, SchedulingError } from "../services/scheduling/rules";
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
const ordinalInput = z.union([z.literal(-1), z.number().int().min(1).max(4)]).nullable().optional();

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

function registerView(task: RegisterTask) {
  const closed = isTaskClosed(toSchedulable(task));
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    title: task.title,
    officer: task.officer.designation,
    status: statusLabel(task),
    dueDate: toISODate(task.dueDate),
    cycle: task.discussionFrequency,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    // A completed task has no upcoming discussion.
    nextDiscussionDate: closed ? null : toISODateOrNull(task.nextDiscussionDate),
    lastDiscussedAt: toISODateOrNull(task.lastDiscussedAt),
    rescheduled: !closed && (task.scheduleState === "DEFERRED" || task.scheduleState === "BROUGHT_FORWARD" || task.scheduleState === "PINNED"),
    scheduleReason: task.scheduleReason,
    remarks: latestRemarks(task),
  };
}

// ---------------------------------------------------------------------------
// Cycle registers

/** Every task (any status) with its cycle, for the three cycle views. */
export async function getRegister(_req: AuthRequest, res: Response): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null },
    include: registerInclude,
    orderBy: { taskNumber: "asc" },
  });
  const views = tasks.map(registerView);
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

const registerPdfQuery = z.object({
  cycle: cycleInput,
  status: z.enum(["all", "pending", "overdue", "completed"]).default("all"),
});

/** PDF of every task in one cycle. All statuses unless a status is chosen. */
export async function downloadRegisterPdf(req: AuthRequest, res: Response): Promise<void> {
  const q = validate(registerPdfQuery, {
    cycle: (queryString(req.query.cycle) ?? "").toUpperCase(),
    status: (queryString(req.query.status) ?? "all").toLowerCase(),
  });
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, discussionFrequency: q.cycle },
    include: registerInclude,
    orderBy: { taskNumber: "asc" },
  });
  const views = tasks
    .map(registerView)
    .filter((t) => q.status === "all" || t.status.toLowerCase() === q.status);

  const rows: RegisterRow[] = views.map((t) => ({
    taskNumber: t.taskNumber,
    title: t.title,
    officer: t.officer,
    status: t.status,
    nextDiscussion: t.nextDiscussionDate ? fmt(t.nextDiscussionDate) : "",
    lastDiscussed: t.lastDiscussedAt ? fmt(t.lastDiscussedAt) : "",
    remarks: t.remarks,
  }));
  const counts = (["Pending", "Overdue", "Completed"] as const)
    .map((s) => `${s}: ${views.filter((t) => t.status === s).length}`)
    .join("  ·  ");
  const label = CYCLE_LABEL[q.cycle];
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const pdf = await registerToPdf(rows, {
    title: `${label} Task Register`,
    subtitle:
      `Discussion cycle: ${label}  ·  Status: ${q.status === "all" ? "All statuses" : q.status}  ·  ` +
      `${views.length} task(s) (${counts})  ·  Generated ${generated}`,
  });
  const suffix = q.status === "all" ? "" : `_${q.status}`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${q.cycle.toLowerCase()}_task_register${suffix}_${today()}.pdf"`
  );
  res.send(pdf);
}

// ---------------------------------------------------------------------------
// Task cycle and schedule

const cycleSchema = z.object({ cycle: cycleInput.nullable(), monthlyMondayOrdinal: ordinalInput });

export async function setCycle(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(cycleSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    await setTaskCycle(tx, task, body.cycle, body.monthlyMondayOrdinal, req.user!.id);
    await syncUpcomingMeetings(tx);
  }, TX_OPTIONS);
  changed();
  res.json({ success: true });
}

const bulkCycleSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(1000),
  cycle: cycleInput.nullable(),
  monthlyMondayOrdinal: ordinalInput,
});

export async function setCycleBulk(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(bulkCycleSchema, req.body);
  let count = 0;
  await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { id: { in: body.taskIds }, deletedAt: null } });
    const ordinal = body.cycle === "MONTHLY" ? (body.monthlyMondayOrdinal ?? 1) : null;
    const plans = tasks
      .filter(
        (t) =>
          t.discussionFrequency !== body.cycle ||
          (body.cycle === "MONTHLY" && (t.monthlyMondayOrdinal ?? 1) !== ordinal) ||
          (body.cycle !== null && !t.nextDiscussionDate)
      )
      .map((task) => ({ task, patch: planCycleChange(toSchedulable(task), body.cycle, ordinal, today()) }));

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
        fromDate: task.nextDiscussionDate,
        toDate: fromISODateOrNull(patch.nextDiscussionDate),
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
  reason: z.string().max(1000).optional(),
});

/** Move a task's next discussion to another Monday. Its cycle is unchanged. */
export async function rescheduleTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(rescheduleSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: param(req, "id"), deletedAt: null } });
    if (!task) throw notFound("Task not found");
    const patch = planReschedule(toSchedulable(task), body.toDate, body.reason ?? "", today());
    await applyPatch(tx, task, patch, {
      type: patch.scheduleState === "BROUGHT_FORWARD" ? "BROUGHT_FORWARD" : "DEFERRED",
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
        ...registerView(task),
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
 * Mark a task as discussed at this meeting (its next date follows its cycle),
 * or undo that, which restores the previous schedule.
 */
export async function recordOutcome(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = validate(mondayDate, param(req, "date"));
  const taskId = param(req, "taskId");
  const body = validate(outcomeSchema, req.body);
  const userId = req.user!.id;

  await prisma.$transaction(async (tx) => {
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
      if (toISODateOrNull(task.lastDiscussedAt) !== meetingDate) {
        throw new SchedulingError("The task has been discussed again since, so this can no longer be undone.", "STALE", 409);
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
      await tx.meetingAgendaItem.update({
        where: { id: item.id },
        data: { ...notes, outcome: "PENDING", outcomeAt: null },
      });
      await logEvent(tx, {
        taskId,
        type: "DISCUSSION_UNDONE",
        meetingId: meeting.id,
        userId,
        fromDate: toISODateOrNull(task.nextDiscussionDate),
        toDate: toISODateOrNull(item.prevNextDiscussionDate),
      });
    } else if (body.notes !== undefined) {
      await tx.meetingAgendaItem.update({ where: { id: item.id }, data: notes });
    }
  }, TX_OPTIONS);

  await prisma.$transaction((tx) => syncUpcomingMeetings(tx), TX_OPTIONS);
  changed();
  res.json(await agendaView(meetingDate));
}

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: "Not yet discussed",
  DISCUSSED: "Discussed",
  NOT_DISCUSSED: "Not discussed",
  DEFERRED: "Moved",
};

/** The agenda for one Monday as PDF (same layout as the registers), Excel or CSV. */
export async function exportAgenda(req: AuthRequest, res: Response): Promise<void> {
  const meetingDate = validate(mondayDate, param(req, "date"));
  const format = (queryString(req.query.format) ?? "pdf").toLowerCase();
  const view = await agendaView(meetingDate);

  if (format === "pdf") {
    const pdf = await registerToPdf(
      view.items.map((t) => ({
        taskNumber: t.taskNumber,
        title: `${t.title}${t.cycle ? `  [${CYCLE_LABEL[t.cycle]}]` : ""}`,
        officer: t.officer,
        status: t.status,
        nextDiscussion: t.nextDiscussionDate ? fmt(t.nextDiscussionDate) : "",
        lastDiscussed: t.lastDiscussedAt ? fmt(t.lastDiscussedAt) : "",
        remarks: t.remarks,
      })),
      { title: `Monday Meeting Agenda — ${fmt(meetingDate)}`, subtitle: `${view.items.length} task(s) due for discussion` }
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="monday_agenda_${meetingDate}.pdf"`);
    res.send(pdf);
    return;
  }

  const rows: AgendaExportRow[] = view.items.map((t, i) => ({
    serial: i + 1,
    taskId: t.taskNumber,
    title: t.title,
    coordinator: t.officer,
    cycle: t.cycle ? CYCLE_LABEL[t.cycle] : "",
    status: t.status,
    lastDiscussed: t.lastDiscussedAt,
    nextDiscussion: t.nextDiscussionDate,
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
