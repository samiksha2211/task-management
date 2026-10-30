// Monday meeting scheduling: a fixed review calendar.
//
// Pure functions over plain data. The website, the agenda, and every PDF use
// these same functions, so they always agree.
//
// Review frequencies (shown as W / FT / M):
//   W  (WEEKLY)      every Monday.
//   FT (FORTNIGHTLY) every other Monday, counted from the task's start Monday
//                    (fortnightAnchor). The cycle runs straight across months.
//   M  (MONTHLY)     the allocated Monday of every month (1st-5th). In a month
//                    with no 5th Monday, a 5th-Monday task is on the last one.
//
// A task is on a Monday's agenda when that Monday is one of its review dates.
// Nothing carries over and nothing has to be allocated by hand. One date can
// be moved with Reschedule: the task is then on the new Monday instead of the
// original one, and its regular calendar is unchanged.
//
// Each task appears at most once per Monday (and the database allows one
// agenda row per task per meeting). Tasks that are completed, deleted, or have
// no review frequency are never on an agenda.

import { CYCLE_LABEL, type Cycle } from "./config";
import {
  addDays,
  diffDays,
  fromISODate,
  isMonday,
  mondayOnOrAfter,
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

export const REVIEW_CODE: Record<Cycle, "W" | "FT" | "M"> = {
  WEEKLY: "W",
  FORTNIGHTLY: "FT",
  MONTHLY: "M",
};

export interface SchedulableTask {
  id: string;
  title: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
  deleted: boolean;
  frequency: Cycle | null;
  /** MONTHLY: allocated Monday of the month, 1-5 (null = 1st). */
  monthlyMondayOrdinal: number | null;
  /** FORTNIGHTLY: a Monday the alternate-week cycle runs from. */
  fortnightAnchor: ISODate | null;
  lastDiscussedAt: ISODate | null;
  /** With a reschedule: the Monday the task was moved to. */
  nextDiscussionDate: ISODate | null;
  /** With a reschedule: the regular Monday it was moved from. */
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
  fortnightAnchor?: ISODate | null;
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

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

export function ordinalLabel(n: number): string {
  return `${ORDINAL[Math.min(Math.max(n, 1), 5) - 1]} Monday`;
}

/** Which Monday of its month a date is (1 = first). */
export function mondayPosition(date: ISODate): number {
  return Math.ceil(fromISODate(date).getUTCDate() / 7);
}

function clampOrdinal(n: number | null | undefined): number {
  if (n === -1) return 5; // legacy "last Monday"
  return Math.min(Math.max(Math.trunc(n ?? 1), 1), 5);
}

// ---------------------------------------------------------------------------
// The calendar

/** The regular review rule, ignoring any reschedule. */
export function occursOn(task: Pick<SchedulableTask, "frequency" | "monthlyMondayOrdinal" | "fortnightAnchor">, date: ISODate): boolean {
  if (!task.frequency || !isMonday(date)) return false;
  switch (task.frequency) {
    case "WEEKLY":
      return true;
    case "FORTNIGHTLY": {
      if (!task.fortnightAnchor) return false;
      const days = diffDays(date, mondayOnOrAfter(task.fortnightAnchor));
      return ((days % 14) + 14) % 14 === 0;
    }
    case "MONTHLY": {
      const d = fromISODate(date);
      return nthMondayOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1, clampOrdinal(task.monthlyMondayOrdinal)) === date;
    }
  }
}

export function hasReschedule(task: Pick<SchedulableTask, "scheduleState" | "nextDiscussionDate">): boolean {
  return task.scheduleState !== "SCHEDULED" && task.scheduleState !== "CANCELLED" && !!task.nextDiscussionDate;
}

/** Is the task to be discussed at the meeting on this Monday? */
export function isDueOn(task: SchedulableTask, date: ISODate): boolean {
  if (isTaskClosed(task) || !isMonday(date)) return false;
  if (hasReschedule(task)) {
    if (date === task.nextDiscussionDate) return true;
    if (date === task.originalDiscussionDate) return false;
  }
  return occursOn(task, date);
}

/** First Monday on or after `from` when the task is due (or null). */
export function nextDueDate(task: SchedulableTask, from: ISODate): ISODate | null {
  if (isTaskClosed(task)) return null;
  let date = mondayOnOrAfter(from);
  for (let i = 0; i < 60; i++, date = addDays(date, 7)) {
    if (isDueOn(task, date)) return date;
  }
  return null;
}

/** First regular review Monday on or after `from`, ignoring reschedules. */
export function nextRegularDate(task: SchedulableTask, from: ISODate): ISODate | null {
  let date = mondayOnOrAfter(from);
  for (let i = 0; i < 60; i++, date = addDays(date, 7)) {
    if (occursOn(task, date)) return date;
  }
  return null;
}

/**
 * "Allocated Monday" shown next to each task.
 *   W  -> "Every Monday"
 *   FT -> where its next review date falls, e.g. "2nd Monday · alternate weeks"
 *   M  -> its fixed Monday, e.g. "3rd Monday"
 */
export function allocatedMonday(task: SchedulableTask, from: ISODate): string {
  switch (task.frequency) {
    case "WEEKLY":
      return "Every Monday";
    case "MONTHLY":
      return ordinalLabel(clampOrdinal(task.monthlyMondayOrdinal));
    case "FORTNIGHTLY": {
      const next = nextRegularDate(task, from);
      return next ? `${ordinalLabel(mondayPosition(next))} · alternate weeks` : "Alternate weeks";
    }
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Changes

export interface CycleOptions {
  monthlyMondayOrdinal?: number | null;
  fortnightAnchor?: ISODate | null;
}

/**
 * Set, change or clear a task's review frequency. The future calendar follows
 * the new settings at once; any reschedule is cleared. Past meetings are kept.
 */
export function planCycleChange(
  task: SchedulableTask,
  cycle: Cycle | null,
  options: CycleOptions,
  today: ISODate
): SchedulePatch {
  const base = {
    nextDiscussionDate: null,
    scheduleState: "SCHEDULED" as const,
    originalDiscussionDate: null,
  };
  if (!cycle) {
    return {
      ...base,
      discussionFrequency: null,
      monthlyMondayOrdinal: null,
      fortnightAnchor: null,
      scheduleReason: "No review frequency",
    };
  }
  if (cycle === "WEEKLY") {
    return { ...base, discussionFrequency: cycle, monthlyMondayOrdinal: null, fortnightAnchor: null, scheduleReason: "W: every Monday" };
  }
  if (cycle === "MONTHLY") {
    const ordinal = clampOrdinal(options.monthlyMondayOrdinal ?? task.monthlyMondayOrdinal);
    return {
      ...base,
      discussionFrequency: cycle,
      monthlyMondayOrdinal: ordinal,
      fortnightAnchor: null,
      scheduleReason: `M: ${ordinalLabel(ordinal)} of every month`,
    };
  }
  const anchor = options.fortnightAnchor ?? (task.frequency === "FORTNIGHTLY" ? task.fortnightAnchor : null) ?? mondayOnOrAfter(today);
  if (!isMonday(anchor)) throw new SchedulingError("The fortnightly start date must be a Monday.");
  return {
    ...base,
    discussionFrequency: cycle,
    monthlyMondayOrdinal: null,
    fortnightAnchor: anchor,
    scheduleReason: `FT: alternate Mondays from ${fmt(anchor)}`,
  };
}

/**
 * Move one review date to another Monday (earlier or later). The task is on
 * `toDate` instead of its regular Monday `fromDate`; its frequency and the
 * rest of its calendar are unchanged.
 */
export function planReschedule(
  task: SchedulableTask,
  toDate: ISODate,
  reason: string,
  today: ISODate,
  fromDate?: ISODate | null
): SchedulePatch {
  if (isTaskClosed(task)) throw new SchedulingError("A completed task cannot be rescheduled.");
  if (!isMonday(toDate)) throw new SchedulingError("Meetings are on Mondays; please pick a Monday.");
  if (toDate < mondayOnOrAfter(today)) throw new SchedulingError("Please pick the coming Monday or a later one.");

  // The regular date being replaced: the one already replaced, or the next one.
  const original = hasReschedule(task)
    ? task.originalDiscussionDate
    : fromDate && occursOn(task, fromDate)
      ? fromDate
      : nextRegularDate(task, today);

  if (toDate === original) {
    return { nextDiscussionDate: null, scheduleState: "SCHEDULED", originalDiscussionDate: null, scheduleReason: "Back on its regular Monday" };
  }
  if (isDueOn(task, toDate)) {
    throw new SchedulingError(`This task is already scheduled for ${fmt(toDate)}.`, "UNCHANGED", 409);
  }
  const earlier = !original || toDate < original;
  const note = reason.trim();
  return {
    nextDiscussionDate: toDate,
    scheduleState: earlier ? "BROUGHT_FORWARD" : "DEFERRED",
    originalDiscussionDate: original,
    scheduleReason: `${earlier ? "Brought forward" : "Moved"} to ${fmt(toDate)}${original ? ` (from ${fmt(original)})` : ""}${note ? `: ${note}` : ""}`,
  };
}

/** Record a discussion. The calendar does not change; a reschedule to this date is used up. */
export function planDiscussed(task: SchedulableTask, meetingDate: ISODate): SchedulePatch {
  const usedUp = hasReschedule(task) && task.nextDiscussionDate === meetingDate;
  return {
    lastDiscussedAt: meetingDate,
    nextDiscussionDate: usedUp ? null : task.nextDiscussionDate,
    scheduleState: usedUp ? "SCHEDULED" : task.scheduleState,
    originalDiscussionDate: usedUp ? null : task.originalDiscussionDate,
    scheduleReason: usedUp ? `Discussed on ${fmt(meetingDate)}` : task.scheduleReason,
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
  if (hasReschedule(task) && task.nextDiscussionDate === meetingDate && task.scheduleReason) return task.scheduleReason;
  if (!task.frequency) return "Scheduled";
  return `${REVIEW_CODE[task.frequency]}: ${allocatedMonday(task, meetingDate)}`;
}

const SECTION_ORDER: AgendaSectionValue[] = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "NEW", "URGENT", "BLOCKED_OVERDUE"];

/**
 * The agenda for one Monday: every task due that day, once. Outcomes already
 * recorded for that meeting are kept as history. Same inputs, same result.
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

  for (const item of existingItems) {
    if (entries.has(item.taskId)) continue;
    if (item.outcome !== "PENDING") entries.set(item.taskId, { ...item, locked: true });
  }

  for (const task of tasks) {
    if (entries.has(task.id) || !isDueOn(task, meetingDate)) continue;
    entries.set(task.id, {
      taskId: task.id,
      section: cycleSection(task.frequency),
      inclusion: hasReschedule(task) && task.nextDiscussionDate === meetingDate ? "BROUGHT_FORWARD" : "DUE",
      reason: inclusionReason(task, meetingDate),
      outcome: "PENDING",
      locked: false,
    });
  }

  for (const item of existingItems) {
    if (item.outcome === "PENDING" && !entries.has(item.taskId) && !dropped.some((d) => d.taskId === item.taskId)) {
      dropped.push({ taskId: item.taskId, reason: "Not due at this meeting" });
    }
  }

  const sorted = [...entries.values()].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      (byId.get(a.taskId)?.title ?? "").localeCompare(byId.get(b.taskId)?.title ?? "") ||
      a.taskId.localeCompare(b.taskId)
  );
  return { entries: sorted, dropped };
}

export { CYCLE_LABEL };
