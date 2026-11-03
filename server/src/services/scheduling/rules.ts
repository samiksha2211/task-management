// Monday meeting scheduling: a fixed review calendar.
//
// Pure functions over plain data. The website, the agenda, and every PDF use
// these same functions, so they always agree.
//
// Review frequencies (shown as W / F1 / F2 / M):
//   W  (WEEKLY)      every Monday.
//   F1 (FORTNIGHTLY, group 1) the 1st and 3rd Monday of every month.
//   F2 (FORTNIGHTLY, group 2) the 2nd and 4th Monday of every month.
//                    A 5th Monday has no F1 / F2 tasks. The group is stored in
//                    monthlyMondayOrdinal (1 or 2); older FT tasks without one
//                    take it from their start Monday (fortnightAnchor).
//   M  (MONTHLY)     the allocated Monday of every month (1st-5th). In a month
//                    with no 5th Monday, a 5th-Monday task is on the last one.
//
// One-time frequencies: the task is discussed once, on its allocated Monday
// (Task.allocatedMonday), which the DRM can move.
//   Next Monday    the coming Monday.
//   Next Month     a Monday of next month, picked by the DRM.
//   Flexible Date  any Monday from the coming one on.
//
// A task is on a Monday's agenda when that Monday is one of its review dates.
// Nothing carries over and nothing has to be allocated by hand. One date can
// be moved with Reschedule: the task is then on the new Monday instead of the
// original one, and its regular calendar is unchanged.
//
// A task is never on a Monday before it was created. A finalized meeting's
// agenda is frozen (see the meetings controller), so tasks created afterwards
// start at the following Monday.
//
// Each task appears at most once per Monday (and the database allows one
// agenda row per task per meeting). Tasks that are completed, deleted, or have
// no review frequency are never on an agenda.

import { CYCLE_LABEL, isOneTime, type Cycle } from "./config";
import {
  addDays,
  diffDays,
  fromISODate,
  isMonday,
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

export const REVIEW_CODE: Record<Cycle, string> = {
  WEEKLY: "W",
  FORTNIGHTLY: "F1 / F2",
  MONTHLY: "M",
  NEXT_MONDAY: "Next Monday",
  NEXT_MONTH: "Next Month",
  FLEXIBLE: "Flexible",
};

export interface SchedulableTask {
  id: string;
  title: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "OVERDUE";
  deleted: boolean;
  /** Day the task was created (meeting time zone). It is not on agendas before then. */
  createdOn?: ISODate | null;
  frequency: Cycle | null;
  /** MONTHLY: allocated Monday of the month, 1-5 (null = 1st). FORTNIGHTLY: 1 = F1, 2 = F2. */
  monthlyMondayOrdinal: number | null;
  /** FORTNIGHTLY (older tasks only): start Monday, used when no F1 / F2 group is stored. */
  fortnightAnchor: ISODate | null;
  /** One-time frequencies: the Monday the task is allocated to. */
  allocatedDate: ISODate | null;
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
  allocatedMonday?: ISODate | null;
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

export type FortnightGroup = 1 | 2;

/** F1 (1st and 3rd Mondays) or F2 (2nd and 4th Mondays) of a fortnightly task. */
export function fortnightGroup(task: Pick<SchedulableTask, "monthlyMondayOrdinal" | "fortnightAnchor">): FortnightGroup {
  if (task.monthlyMondayOrdinal === 1 || task.monthlyMondayOrdinal === 2) return task.monthlyMondayOrdinal;
  // Older tasks: the group whose Mondays include their start Monday.
  if (task.fortnightAnchor) return mondayPosition(mondayOnOrAfter(task.fortnightAnchor)) % 2 === 1 ? 1 : 2;
  return 1;
}

export const FORTNIGHT_MONDAYS: Record<FortnightGroup, [number, number]> = { 1: [1, 3], 2: [2, 4] };

/** Short code shown everywhere: W, F1, F2, M, or the one-time frequency's name. */
export function reviewCode(
  task: Pick<SchedulableTask, "frequency" | "monthlyMondayOrdinal" | "fortnightAnchor">
): string | null {
  if (!task.frequency) return null;
  if (task.frequency === "FORTNIGHTLY") return `F${fortnightGroup(task)}`;
  return REVIEW_CODE[task.frequency];
}

// ---------------------------------------------------------------------------
// The calendar

/** The regular review rule, ignoring any reschedule. */
export function occursOn(
  task: Pick<SchedulableTask, "frequency" | "monthlyMondayOrdinal" | "fortnightAnchor" | "allocatedDate">,
  date: ISODate
): boolean {
  if (!task.frequency || !isMonday(date)) return false;
  if (isOneTime(task.frequency)) return task.allocatedDate === date;
  switch (task.frequency) {
    case "WEEKLY":
      return true;
    case "FORTNIGHTLY":
      return FORTNIGHT_MONDAYS[fortnightGroup(task)].includes(mondayPosition(date));
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
  // A new task's first meeting is the Monday it was created on, or the next one.
  if (task.createdOn && date < mondayOnOrAfter(task.createdOn)) return false;
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
 *   F1 -> "1st & 3rd Monday", F2 -> "2nd & 4th Monday"
 *   M  -> its fixed Monday, e.g. "3rd Monday"
 *   one-time -> its date, e.g. "9 Nov 2026"
 */
export function allocatedMonday(task: SchedulableTask, from: ISODate): string {
  if (isOneTime(task.frequency)) return task.allocatedDate ? fmt(task.allocatedDate) : "";
  switch (task.frequency) {
    case "WEEKLY":
      return "Every Monday";
    case "MONTHLY":
      return ordinalLabel(clampOrdinal(task.monthlyMondayOrdinal));
    case "FORTNIGHTLY": {
      const [a, b] = FORTNIGHT_MONDAYS[fortnightGroup(task)];
      return `${ORDINAL[a - 1]} & ${ORDINAL[b - 1]} Monday`;
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
  /** FORTNIGHTLY: 1 = F1 (1st & 3rd Mondays), 2 = F2 (2nd & 4th Mondays). */
  fortnightGroup?: FortnightGroup | null;
  /** NEXT_MONTH / FLEXIBLE: the Monday chosen by the DRM. */
  allocatedMonday?: ISODate | null;
}

/** The Mondays of the month after `today` (choices for "Next Month"). */
export function nextMonthMondays(today: ISODate): ISODate[] {
  const { year, month } = nextMonthOf(today);
  const out: ISODate[] = [];
  for (let d = nthMondayOfMonth(year, month, 1); fromISODate(d).getUTCMonth() + 1 === month; d = addDays(d, 7)) out.push(d);
  return out;
}

/** The Monday a one-time frequency allocates the task to. */
function oneTimeDate(task: SchedulableTask, cycle: Cycle, options: CycleOptions, today: ISODate): ISODate {
  const upcoming = mondayOnOrAfter(today);
  const current = isOneTime(task.frequency) && task.allocatedDate && task.allocatedDate >= upcoming ? task.allocatedDate : null;
  if (cycle === "NEXT_MONDAY") return upcoming;
  if (cycle === "NEXT_MONTH") {
    const choices = nextMonthMondays(today);
    const picked = options.allocatedMonday ?? (current && choices.includes(current) ? current : choices[0]);
    if (!choices.includes(picked)) throw new SchedulingError("For Next Month, please pick one of next month's Mondays.");
    return picked;
  }
  const picked = options.allocatedMonday ?? current ?? upcoming;
  if (!isMonday(picked)) throw new SchedulingError("Meetings are on Mondays; please pick a Monday.");
  if (picked < upcoming) throw new SchedulingError("Please pick the coming Monday or a later one.");
  return picked;
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
      allocatedMonday: null,
      scheduleReason: "No review frequency",
    };
  }
  if (isOneTime(cycle)) {
    const date = oneTimeDate(task, cycle, options, today);
    return {
      ...base,
      discussionFrequency: cycle,
      monthlyMondayOrdinal: null,
      fortnightAnchor: null,
      allocatedMonday: date,
      scheduleReason: `${CYCLE_LABEL[cycle]}: ${fmt(date)}`,
    };
  }
  if (cycle === "WEEKLY") {
    return {
      ...base,
      discussionFrequency: cycle,
      monthlyMondayOrdinal: null,
      fortnightAnchor: null,
      allocatedMonday: null,
      scheduleReason: "W: every Monday",
    };
  }
  if (cycle === "MONTHLY") {
    const ordinal = clampOrdinal(options.monthlyMondayOrdinal ?? task.monthlyMondayOrdinal);
    return {
      ...base,
      discussionFrequency: cycle,
      monthlyMondayOrdinal: ordinal,
      fortnightAnchor: null,
      allocatedMonday: null,
      scheduleReason: `M: ${ordinalLabel(ordinal)} of every month`,
    };
  }
  // FORTNIGHTLY: F1 or F2. The Mondays follow automatically.
  if (options.fortnightGroup != null && options.fortnightGroup !== 1 && options.fortnightGroup !== 2) {
    throw new SchedulingError("Fortnightly tasks are F1 or F2.");
  }
  const group: FortnightGroup = options.fortnightGroup ?? (task.frequency === "FORTNIGHTLY" ? fortnightGroup(task) : 1);
  const [a, b] = FORTNIGHT_MONDAYS[group];
  return {
    ...base,
    discussionFrequency: cycle,
    monthlyMondayOrdinal: group,
    fortnightAnchor: null,
    allocatedMonday: null,
    scheduleReason: `F${group}: ${ORDINAL[a - 1]} and ${ORDINAL[b - 1]} Monday of every month`,
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

  // A one-time task simply gets a new allocated Monday.
  if (isOneTime(task.frequency)) {
    if (toDate === task.allocatedDate) {
      throw new SchedulingError(`This task is already allocated to ${fmt(toDate)}.`, "UNCHANGED", 409);
    }
    const note = reason.trim();
    return {
      nextDiscussionDate: null,
      scheduleState: "SCHEDULED",
      originalDiscussionDate: null,
      allocatedMonday: toDate,
      scheduleReason: `Allocated to ${fmt(toDate)}${task.allocatedDate ? ` (was ${fmt(task.allocatedDate)})` : ""}${note ? `: ${note}` : ""}`,
    };
  }

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
  return !cycle || isOneTime(cycle) ? "NEW" : cycle;
}

function inclusionReason(task: SchedulableTask, meetingDate: ISODate): string {
  if (hasReschedule(task) && task.nextDiscussionDate === meetingDate && task.scheduleReason) return task.scheduleReason;
  if (!task.frequency) return "Scheduled";
  if (isOneTime(task.frequency)) return `${CYCLE_LABEL[task.frequency]}: ${allocatedMonday(task, meetingDate)}`;
  return `${reviewCode(task)}: ${allocatedMonday(task, meetingDate)}`;
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
