// Monday meeting scheduling rules.
//
// Pure functions over plain data; the controllers load tasks, call these and
// save the result, so all scheduling logic lives (and is tested) here.
//
// Cycles:
//   WEEKLY      -> every Monday.
//   FORTNIGHTLY -> 14 days after the last actual discussion.
//   MONTHLY     -> the designated Monday (first by default) of the next month.
//
// Agenda for a Monday (see buildAgenda):
//   1. Completed, deleted or cancelled tasks are left out.
//   2. A task is included when its next discussion date is on or before that
//      Monday (a missed date carries over). Rescheduled tasks are included on
//      their new date only.
//   3. The cycle alone never puts a task on an agenda.
//   4. Each task appears at most once per meeting.

import { CYCLE_LABEL, type Cycle } from "./config";
import {
  addDays,
  isMonday,
  mondayAfter,
  mondayOnOrAfter,
  nextMonthOf,
  nthMondayOfMonth,
  type ISODate,
} from "./dates";

export type ScheduleStateValue = "SCHEDULED" | "DEFERRED" | "BROUGHT_FORWARD" | "PINNED" | "CANCELLED";
export type AgendaSectionValue =
  | "URGENT"
  | "BLOCKED_OVERDUE"
  | "WEEKLY"
  | "FORTNIGHTLY"
  | "MONTHLY"
  | "NEW";
export type AgendaInclusionValue = "DUE" | "BROUGHT_FORWARD" | "MANUAL";
export type AgendaOutcomeValue = "PENDING" | "DISCUSSED" | "NOT_DISCUSSED" | "DEFERRED";

export interface SchedulableTask {
  id: string;
  title: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
  deleted: boolean;
  frequency: Cycle | null;
  monthlyMondayOrdinal: number | null;
  lastDiscussedAt: ISODate | null;
  nextDiscussionDate: ISODate | null;
  originalDiscussionDate: ISODate | null;
  scheduleState: ScheduleStateValue;
  scheduleReason: string | null;
}

export interface SchedulePatch {
  nextDiscussionDate: ISODate | null;
  scheduleState: ScheduleStateValue;
  originalDiscussionDate: ISODate | null;
  scheduleReason: string | null;
  lastDiscussedAt?: ISODate | null;
  discussionFrequency?: Cycle | null;
  monthlyMondayOrdinal?: number | null;
}

export class SchedulingError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = "INVALID", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isTaskClosed(task: Pick<SchedulableTask, "status" | "deleted" | "scheduleState">): boolean {
  return task.status === "COMPLETED" || task.deleted || task.scheduleState === "CANCELLED";
}

export function fmt(date: ISODate): string {
  const [y, m, d] = date.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1];
  return `${+d} ${month} ${y}`;
}

// ---------------------------------------------------------------------------
// Cycle rules

/** The designated Monday of the month after `fromDate` for a MONTHLY task. */
export function monthlySlot(fromDate: ISODate, ordinal: number | null | undefined): ISODate {
  const { year, month } = nextMonthOf(fromDate);
  return nthMondayOfMonth(year, month, ordinal ?? 1);
}

/** Next discussion date after a task was actually discussed on `discussedOn`. */
export function nextDateAfterDiscussion(cycle: Cycle, discussedOn: ISODate, monthlyOrdinal?: number | null): ISODate {
  switch (cycle) {
    case "WEEKLY":
      return mondayAfter(discussedOn);
    case "FORTNIGHTLY":
      return mondayOnOrAfter(addDays(discussedOn, 14));
    case "MONTHLY":
      return monthlySlot(discussedOn, monthlyOrdinal);
  }
}

/**
 * First discussion date when a task gets a cycle (new task, first assignment
 * or a cycle change). Always a Monday, never in the past.
 *   - Discussed before: the cycle is counted from the last discussion; if that
 *     date has already passed, the upcoming Monday.
 *   - Never discussed: WEEKLY and FORTNIGHTLY start on the upcoming Monday
 *     (fortnightly then repeats every 14 days); MONTHLY starts on the
 *     designated Monday of next month.
 */
export function initialDiscussionDate(input: {
  cycle: Cycle;
  today: ISODate;
  lastDiscussedAt?: ISODate | null;
  monthlyMondayOrdinal?: number | null;
}): { date: ISODate; reason: string } {
  const upcoming = mondayOnOrAfter(input.today);
  const label = CYCLE_LABEL[input.cycle];

  if (input.lastDiscussedAt) {
    const due = nextDateAfterDiscussion(input.cycle, input.lastDiscussedAt, input.monthlyMondayOrdinal);
    return due < upcoming
      ? { date: upcoming, reason: `${label}: due since ${fmt(due)}` }
      : { date: due, reason: `${label}: counted from last discussion on ${fmt(input.lastDiscussedAt)}` };
  }
  if (input.cycle === "MONTHLY") {
    return { date: monthlySlot(input.today, input.monthlyMondayOrdinal), reason: "Monthly: designated Monday of next month" };
  }
  return { date: upcoming, reason: `${label}: starts on the upcoming Monday` };
}

// ---------------------------------------------------------------------------
// Schedule changes

/**
 * Set, change or clear a task's cycle. Only the future schedule changes; past
 * discussions are untouched. A date set by Reschedule is replaced, because
 * the user has chosen a new cycle.
 */
export function planCycleChange(
  task: SchedulableTask,
  cycle: Cycle | null,
  monthlyMondayOrdinal: number | null,
  today: ISODate
): SchedulePatch {
  if (!cycle) {
    return {
      discussionFrequency: null,
      monthlyMondayOrdinal: null,
      nextDiscussionDate: null,
      scheduleState: "SCHEDULED",
      originalDiscussionDate: null,
      scheduleReason: "No discussion cycle",
    };
  }
  const { date, reason } = initialDiscussionDate({
    cycle,
    today,
    lastDiscussedAt: task.lastDiscussedAt,
    monthlyMondayOrdinal,
  });
  return {
    discussionFrequency: cycle,
    monthlyMondayOrdinal: cycle === "MONTHLY" ? monthlyMondayOrdinal : null,
    nextDiscussionDate: date,
    scheduleState: "SCHEDULED",
    originalDiscussionDate: null,
    scheduleReason: reason,
  };
}

/** Schedule after the task was actually discussed at the meeting on `meetingDate`. */
export function planDiscussed(task: SchedulableTask, meetingDate: ISODate): SchedulePatch {
  // A date the user explicitly set for later than this meeting is kept.
  if (task.scheduleState === "PINNED" && task.nextDiscussionDate && task.nextDiscussionDate > meetingDate) {
    return {
      lastDiscussedAt: meetingDate,
      nextDiscussionDate: task.nextDiscussionDate,
      scheduleState: "PINNED",
      originalDiscussionDate: task.originalDiscussionDate,
      scheduleReason: task.scheduleReason,
    };
  }
  if (!task.frequency) {
    return {
      lastDiscussedAt: meetingDate,
      nextDiscussionDate: null,
      scheduleState: "SCHEDULED",
      originalDiscussionDate: null,
      scheduleReason: "Discussed; no cycle, so not scheduled again",
    };
  }
  return {
    lastDiscussedAt: meetingDate,
    nextDiscussionDate: nextDateAfterDiscussion(task.frequency, meetingDate, task.monthlyMondayOrdinal),
    scheduleState: "SCHEDULED",
    originalDiscussionDate: null,
    scheduleReason: `${CYCLE_LABEL[task.frequency]}: discussed on ${fmt(meetingDate)}`,
  };
}

/**
 * Move a task's next discussion to another Monday (earlier or later). The
 * cycle is not changed; once the task is discussed, the normal cycle resumes.
 */
export function planReschedule(
  task: SchedulableTask,
  toDate: ISODate,
  reason: string,
  today: ISODate
): SchedulePatch {
  if (isTaskClosed(task)) throw new SchedulingError("A completed task cannot be rescheduled.");
  if (!isMonday(toDate)) throw new SchedulingError("Meetings are on Mondays; please pick a Monday.");
  if (toDate < mondayOnOrAfter(today)) throw new SchedulingError("Please pick today or a later Monday.");
  if (toDate === task.nextDiscussionDate) {
    throw new SchedulingError(`This task is already scheduled for ${fmt(toDate)}.`, "UNCHANGED", 409);
  }
  const earlier = !task.nextDiscussionDate || toDate < task.nextDiscussionDate;
  const note = reason.trim();
  return {
    nextDiscussionDate: toDate,
    scheduleState: earlier ? "BROUGHT_FORWARD" : "DEFERRED",
    // Keep the date the cycle had produced, across repeated reschedules.
    originalDiscussionDate: task.originalDiscussionDate ?? task.nextDiscussionDate,
    scheduleReason: `${earlier ? "Brought forward" : "Moved"} to ${fmt(toDate)}${note ? `: ${note}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Agenda

export interface ExistingAgendaItem {
  taskId: string;
  section: AgendaSectionValue;
  inclusion: AgendaInclusionValue;
  reason: string;
  outcome: AgendaOutcomeValue;
}

export interface AgendaEntry extends ExistingAgendaItem {
  /** An outcome has been recorded, so the entry is kept as history. */
  locked: boolean;
}

export interface AgendaResult {
  entries: AgendaEntry[];
  /** Pending stored items that are no longer due at this meeting. */
  dropped: { taskId: string; reason: string }[];
}

export function cycleSection(cycle: Cycle | null): AgendaSectionValue {
  return cycle ?? "NEW";
}

function inclusionReason(task: SchedulableTask, meetingDate: ISODate): string {
  if (task.nextDiscussionDate && task.nextDiscussionDate < meetingDate) {
    return `Carried over: was due ${fmt(task.nextDiscussionDate)}`;
  }
  if (task.scheduleState !== "SCHEDULED" && task.scheduleReason) return task.scheduleReason;
  return task.frequency ? `${CYCLE_LABEL[task.frequency]} discussion due` : "Scheduled";
}

/**
 * Build the agenda for one Monday from the tasks and whatever is already
 * stored for that meeting. The same inputs always give the same entries, and
 * each task appears at most once.
 */
export function buildAgenda(params: {
  meetingDate: ISODate;
  tasks: SchedulableTask[];
  existingItems: ExistingAgendaItem[];
}): AgendaResult {
  const { meetingDate, tasks, existingItems } = params;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const entries = new Map<string, AgendaEntry>();
  const dropped: AgendaResult["dropped"] = [];

  // Recorded outcomes are history and always kept; manual additions stay
  // unless the task has been closed since.
  for (const item of existingItems) {
    if (entries.has(item.taskId)) continue;
    const task = byId.get(item.taskId);
    if (item.outcome !== "PENDING") {
      entries.set(item.taskId, { ...item, locked: true });
    } else if (!task || isTaskClosed(task)) {
      dropped.push({ taskId: item.taskId, reason: "Task is completed or deleted" });
    } else if (item.inclusion === "MANUAL") {
      entries.set(item.taskId, { ...item, section: cycleSection(task.frequency), locked: false });
    }
  }

  for (const task of tasks) {
    if (entries.has(task.id) || isTaskClosed(task)) continue;
    if (!task.nextDiscussionDate || task.nextDiscussionDate > meetingDate) continue;
    entries.set(task.id, {
      taskId: task.id,
      section: cycleSection(task.frequency),
      inclusion: task.scheduleState === "BROUGHT_FORWARD" ? "BROUGHT_FORWARD" : "DUE",
      reason: inclusionReason(task, meetingDate),
      outcome: "PENDING",
      locked: false,
    });
  }

  for (const item of existingItems) {
    if (
      item.outcome === "PENDING" &&
      item.inclusion !== "MANUAL" &&
      !entries.has(item.taskId) &&
      !dropped.some((d) => d.taskId === item.taskId)
    ) {
      dropped.push({ taskId: item.taskId, reason: "No longer due at this meeting" });
    }
  }

  const order: AgendaSectionValue[] = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "NEW", "URGENT", "BLOCKED_OVERDUE"];
  const sorted = [...entries.values()].sort(
    (a, b) =>
      order.indexOf(a.section) - order.indexOf(b.section) ||
      (byId.get(a.taskId)?.title ?? "").localeCompare(byId.get(b.taskId)?.title ?? "") ||
      a.taskId.localeCompare(b.taskId)
  );
  return { entries: sorted, dropped };
}
