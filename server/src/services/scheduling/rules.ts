// Monday meeting scheduling rules.
//
// Everything here is a pure function over plain data. The controllers load
// tasks from the database, call these functions, and persist the result, so
// all of the rules live in one place and are unit-tested.
//
// Agenda inclusion precedence (applied in this order, see buildAgenda):
//   1. Completed, deleted or cancelled tasks are excluded.
//   2. Tasks brought forward to (or before) the meeting date are included as urgent.
//   3. Tasks explicitly added to the meeting are included.
//   4. Otherwise a task is included only when its nextDiscussionDate is on or
//      before the meeting date (a missed date carries over to the next meeting).
//   5. Frequency alone never puts a task on an agenda.
//   6. Each task appears at most once per meeting.

import {
  FREQUENCY_LABEL,
  normalizePriority,
  type Frequency,
  type PriorityLevel,
  type SchedulingConfig,
} from "./config";
import {
  addDays,
  isMonday,
  maxDate,
  mondayAfter,
  mondayOnOrAfter,
  mondayOnOrBefore,
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

export const SECTION_ORDER: AgendaSectionValue[] = [
  "URGENT",
  "BLOCKED_OVERDUE",
  "WEEKLY",
  "FORTNIGHTLY",
  "MONTHLY",
  "NEW",
];

export const SECTION_LABEL: Record<AgendaSectionValue, string> = {
  URGENT: "Urgent / decision required",
  BLOCKED_OVERDUE: "Blocked or overdue",
  WEEKLY: "Regular weekly",
  FORTNIGHTLY: "Fortnightly due",
  MONTHLY: "Monthly due",
  NEW: "Newly added",
};

const PRIORITY_RANK: Record<PriorityLevel, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export interface SchedulableTask {
  id: string;
  title: string;
  status: "PENDING" | "COMPLETED" | "OVERDUE";
  deleted: boolean;
  /** Calendar day the task was created, in the meeting time zone. */
  createdOn: ISODate;
  dueDate: ISODate | null;
  frequency: Frequency | null;
  monthlyMondayOrdinal: number | null;
  lastDiscussedAt: ISODate | null;
  nextDiscussionDate: ISODate | null;
  originalDiscussionDate: ISODate | null;
  scheduleState: ScheduleStateValue;
  scheduleReason: string | null;
  priority: string | null;
  isBlocked: boolean;
  flaggedForReview: boolean;
  estimatedMinutes: number | null;
}

export interface SchedulePatch {
  nextDiscussionDate: ISODate | null;
  scheduleState: ScheduleStateValue;
  originalDiscussionDate: ISODate | null;
  scheduleReason: string | null;
  lastDiscussedAt?: ISODate | null;
  discussionFrequency?: Frequency | null;
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

// ---------------------------------------------------------------------------
// Basic predicates

export function isTaskClosed(task: Pick<SchedulableTask, "status" | "deleted" | "scheduleState">): boolean {
  return task.status === "COMPLETED" || task.deleted || task.scheduleState === "CANCELLED";
}

/** The task's deadline is before the given day and it is not completed. */
export function isTaskOverdue(task: Pick<SchedulableTask, "status" | "dueDate">, onDate: ISODate): boolean {
  return task.status !== "COMPLETED" && !!task.dueDate && task.dueDate < onDate;
}

export function discussionMinutes(task: Pick<SchedulableTask, "estimatedMinutes">, config: SchedulingConfig): number {
  return task.estimatedMinutes && task.estimatedMinutes > 0
    ? task.estimatedMinutes
    : config.defaultDiscussionMinutes;
}

/** True when a defer needs an explicit confirmation from the user. */
export function isProtectedFromDeferral(task: SchedulableTask, onDate: ISODate): boolean {
  return (
    normalizePriority(task.priority) === "URGENT" ||
    task.isBlocked ||
    isTaskOverdue(task, onDate) ||
    task.scheduleState === "BROUGHT_FORWARD"
  );
}

function fmt(date: ISODate): string {
  const [y, m, d] = date.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1];
  return `${+d} ${month} ${y}`;
}

// ---------------------------------------------------------------------------
// Frequency rules

/** The designated Monday of the month after `fromDate` for an NM task. */
export function monthlySlot(fromDate: ISODate, ordinal: number | null | undefined): ISODate {
  const { year, month } = nextMonthOf(fromDate);
  return nthMondayOfMonth(year, month, ordinal ?? 1);
}

/**
 * Next discussion date after a task was actually discussed on `discussedOn`.
 *   M  -> the following Monday.
 *   F  -> 14 days later (the Monday on or after, if the meeting was not a Monday).
 *   NM -> the designated Monday (first by default) of the next calendar month.
 */
export function nextDateAfterDiscussion(
  frequency: Frequency,
  discussedOn: ISODate,
  monthlyOrdinal?: number | null
): ISODate {
  switch (frequency) {
    case "M":
      return mondayAfter(discussedOn);
    case "F":
      return mondayOnOrAfter(addDays(discussedOn, 14));
    case "NM":
      return monthlySlot(discussedOn, monthlyOrdinal);
  }
}

export interface InitialScheduleInput {
  frequency: Frequency;
  today: ISODate;
  priority?: string | null;
  dueDate?: ISODate | null;
  isBlocked?: boolean;
  flaggedForReview?: boolean;
  lastDiscussedAt?: ISODate | null;
  monthlyMondayOrdinal?: number | null;
  /** For spreading a batch of never-discussed fortnightly tasks over two Mondays. */
  fortnightlySlot?: 0 | 1;
}

/**
 * First discussion date for a task that is being (re)scheduled: a new task, a
 * legacy task getting a frequency for the first time, or a frequency change.
 * The result is always a Monday on or after the upcoming Monday.
 */
export function initialDiscussionDate(input: InitialScheduleInput): { date: ISODate; reason: string } {
  const upcoming = mondayOnOrAfter(input.today);
  const label = FREQUENCY_LABEL[input.frequency];
  let date: ISODate;
  let reason: string;

  if (input.lastDiscussedAt) {
    const due = nextDateAfterDiscussion(input.frequency, input.lastDiscussedAt, input.monthlyMondayOrdinal);
    if (due < upcoming) {
      date = upcoming;
      reason = `${label} cycle fell due on ${fmt(due)} (last discussed ${fmt(input.lastDiscussedAt)}); next meeting`;
    } else {
      date = due;
      reason = `${label} cycle from last discussion on ${fmt(input.lastDiscussedAt)}`;
    }
  } else {
    const priority = normalizePriority(input.priority);
    const triggers: string[] = [];
    if (priority === "URGENT" || priority === "HIGH") triggers.push(`${priority.toLowerCase()} priority`);
    if (input.isBlocked) triggers.push("blocked");
    if (input.flaggedForReview) triggers.push("flagged in latest review");
    if (input.dueDate && input.dueDate < addDays(upcoming, 7)) triggers.push(`deadline ${fmt(input.dueDate)}`);

    if (triggers.length > 0) {
      date = upcoming;
      reason = `Needs early discussion (${triggers.join(", ")}); next meeting`;
    } else if (input.frequency === "M") {
      date = upcoming;
      reason = "Weekly: next Monday";
    } else if (input.frequency === "F") {
      date = input.fortnightlySlot === 0 ? upcoming : addDays(upcoming, 7);
      reason = "Fortnightly: first discussion within two weeks (no previous discussion recorded)";
    } else {
      date = monthlySlot(input.today, input.monthlyMondayOrdinal);
      reason = "Next Month: designated Monday of next month";
    }
  }

  // A deadline before the regular slot pulls the discussion earlier.
  if (input.dueDate && input.dueDate >= upcoming && input.dueDate < date) {
    date = maxDate(upcoming, mondayOnOrBefore(input.dueDate));
    reason += `; moved earlier because the deadline is ${fmt(input.dueDate)}`;
  }

  return { date, reason };
}

/**
 * Plan for giving many unscheduled tasks a frequency at once. Never-discussed
 * fortnightly tasks are spread over the next two Mondays (earliest deadlines
 * first) so they do not all land on the same meeting.
 */
export function planInitialization(
  tasks: SchedulableTask[],
  frequency: Frequency,
  today: ISODate,
  monthlyMondayOrdinal: number | null = null
): Map<string, SchedulePatch> {
  const plans = new Map<string, SchedulePatch>();
  const ordered = [...tasks].sort(
    (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title)
  );
  let fortnightlyIndex = 0;
  for (const task of ordered) {
    if (isTaskClosed(task) || task.frequency) continue;
    const { date, reason } = initialDiscussionDate({
      frequency,
      today,
      priority: task.priority,
      dueDate: task.dueDate,
      isBlocked: task.isBlocked,
      flaggedForReview: task.flaggedForReview,
      lastDiscussedAt: task.lastDiscussedAt,
      monthlyMondayOrdinal,
      fortnightlySlot: frequency === "F" ? ((fortnightlyIndex++ % 2) as 0 | 1) : undefined,
    });
    plans.set(task.id, {
      discussionFrequency: frequency,
      monthlyMondayOrdinal: frequency === "NM" ? monthlyMondayOrdinal : null,
      nextDiscussionDate: date,
      scheduleState: "SCHEDULED",
      originalDiscussionDate: null,
      scheduleReason: reason,
    });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Schedule changes

/** Schedule after the task was actually discussed at the meeting on `meetingDate`. */
export function planDiscussed(task: SchedulableTask, meetingDate: ISODate): SchedulePatch {
  // An agreed (pinned) date that is still ahead is preserved.
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
      scheduleReason: "Discussed; no frequency set, so not scheduled again",
    };
  }
  const next = nextDateAfterDiscussion(task.frequency, meetingDate, task.monthlyMondayOrdinal);
  return {
    lastDiscussedAt: meetingDate,
    nextDiscussionDate: next,
    scheduleState: "SCHEDULED",
    originalDiscussionDate: null,
    scheduleReason: `${FREQUENCY_LABEL[task.frequency]} cycle after discussion on ${fmt(meetingDate)}`,
  };
}

export interface DeferInput {
  toDate: ISODate;
  reason: string;
  /** The meeting the task is being moved out of, or today's date. */
  fromDate: ISODate;
  confirmed?: boolean;
}

export function planDefer(task: SchedulableTask, input: DeferInput): SchedulePatch {
  if (isTaskClosed(task)) throw new SchedulingError("A completed or cancelled task cannot be deferred.");
  if (!isMonday(input.toDate)) throw new SchedulingError("A task can only be deferred to a Monday.");
  if (input.toDate <= input.fromDate) {
    throw new SchedulingError("The revised date must be after the meeting it is deferred from.");
  }
  if (!input.reason.trim()) throw new SchedulingError("A reason is required to defer a task.");
  if (isProtectedFromDeferral(task, input.fromDate) && !input.confirmed) {
    throw new SchedulingError(
      "This task is urgent, blocked, overdue or was brought forward. Confirm to defer it anyway.",
      "CONFIRMATION_REQUIRED",
      409
    );
  }
  return {
    nextDiscussionDate: input.toDate,
    scheduleState: "DEFERRED",
    // Keep the first date the regular rule produced, across repeated deferrals.
    originalDiscussionDate: task.originalDiscussionDate ?? task.nextDiscussionDate ?? input.fromDate,
    scheduleReason: `Deferred to ${fmt(input.toDate)}: ${input.reason.trim()}`,
  };
}

export interface BringForwardInput {
  toDate: ISODate;
  reason: string;
  today: ISODate;
}

/** Bring a task forward to an earlier meeting. Its frequency is not changed. */
export function planBringForward(task: SchedulableTask, input: BringForwardInput): SchedulePatch {
  if (isTaskClosed(task)) throw new SchedulingError("A completed or cancelled task cannot be brought forward.");
  if (!isMonday(input.toDate)) throw new SchedulingError("A task can only be brought forward to a Monday.");
  if (input.toDate < mondayOnOrAfter(input.today)) {
    throw new SchedulingError("A task cannot be brought forward to a past meeting.");
  }
  if (task.nextDiscussionDate && task.nextDiscussionDate <= input.toDate) {
    throw new SchedulingError(
      `This task is already due on ${fmt(task.nextDiscussionDate)}, which is not later than ${fmt(input.toDate)}.`,
      "ALREADY_DUE",
      409
    );
  }
  if (!input.reason.trim()) throw new SchedulingError("A reason is required to bring a task forward.");
  return {
    nextDiscussionDate: input.toDate,
    scheduleState: "BROUGHT_FORWARD",
    originalDiscussionDate: task.originalDiscussionDate ?? task.nextDiscussionDate,
    scheduleReason: `Brought forward to ${fmt(input.toDate)}: ${input.reason.trim()}`,
  };
}

/** Pin the next discussion to an agreed date. It survives frequency recalculation. */
export function planPinnedDate(task: SchedulableTask, date: ISODate, reason: string): SchedulePatch {
  if (isTaskClosed(task)) throw new SchedulingError("A completed or cancelled task cannot be rescheduled.");
  if (!isMonday(date)) throw new SchedulingError("Discussion dates must be Mondays.");
  return {
    nextDiscussionDate: date,
    scheduleState: "PINNED",
    originalDiscussionDate: task.originalDiscussionDate ?? task.nextDiscussionDate,
    scheduleReason: `Agreed date ${fmt(date)}${reason.trim() ? `: ${reason.trim()}` : ""}`,
  };
}

/**
 * Change (or set, or clear) a task's frequency. Past meeting history is never
 * touched; only the future schedule is recalculated. A deferred, brought
 * forward or pinned date is kept unless `recalculate` is set.
 */
export function planFrequencyChange(
  task: SchedulableTask,
  frequency: Frequency | null,
  monthlyMondayOrdinal: number | null,
  today: ISODate,
  recalculate = false
): SchedulePatch {
  if (!frequency) {
    return {
      discussionFrequency: null,
      monthlyMondayOrdinal: null,
      nextDiscussionDate: null,
      scheduleState: "SCHEDULED",
      originalDiscussionDate: null,
      scheduleReason: "No discussion frequency; not on the meeting schedule",
    };
  }
  const keepsManualDate =
    !recalculate &&
    !!task.nextDiscussionDate &&
    (task.scheduleState === "DEFERRED" ||
      task.scheduleState === "BROUGHT_FORWARD" ||
      task.scheduleState === "PINNED");
  if (keepsManualDate) {
    return {
      discussionFrequency: frequency,
      monthlyMondayOrdinal: frequency === "NM" ? monthlyMondayOrdinal : null,
      nextDiscussionDate: task.nextDiscussionDate,
      scheduleState: task.scheduleState,
      originalDiscussionDate: task.originalDiscussionDate,
      scheduleReason: task.scheduleReason,
    };
  }
  const { date, reason } = initialDiscussionDate({
    frequency,
    today,
    priority: task.priority,
    dueDate: task.status === "COMPLETED" ? null : task.dueDate,
    isBlocked: task.isBlocked,
    flaggedForReview: task.flaggedForReview,
    lastDiscussedAt: task.lastDiscussedAt,
    monthlyMondayOrdinal,
  });
  return {
    discussionFrequency: frequency,
    monthlyMondayOrdinal: frequency === "NM" ? monthlyMondayOrdinal : null,
    nextDiscussionDate: date,
    scheduleState: task.scheduleState === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
    originalDiscussionDate: null,
    scheduleReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Monday PDF review

export interface ReviewEdits {
  priority?: string | null;
  isBlocked?: boolean;
  flaggedForReview?: boolean;
  /** The reviewer marked this change as needing discussion at the meeting. */
  needsDiscussion?: boolean;
}

export interface ReviewProposal {
  action: "BRING_FORWARD" | "KEEP" | "NONE";
  toDate: ISODate | null;
  reason: string;
}

/** What the system suggests after a PDF review edit. Nothing is applied until confirmed. */
export function proposeReview(task: SchedulableTask, edits: ReviewEdits, meetingDate: ISODate): ReviewProposal {
  if (isTaskClosed(task)) return { action: "NONE", toDate: null, reason: "Task is completed or cancelled" };
  if (task.nextDiscussionDate && task.nextDiscussionDate <= meetingDate) {
    return { action: "KEEP", toDate: task.nextDiscussionDate, reason: "Already due at this meeting" };
  }
  const priority = normalizePriority(edits.priority !== undefined ? edits.priority : task.priority);
  const triggers: string[] = [];
  if (priority === "URGENT") triggers.push("priority is urgent");
  if (edits.isBlocked && !task.isBlocked) triggers.push("newly blocked");
  if (edits.needsDiscussion) triggers.push("reviewer marked it for discussion");
  if (task.dueDate && task.status !== "COMPLETED" && task.dueDate < addDays(meetingDate, 7)) {
    triggers.push(`deadline ${fmt(task.dueDate)} is before the following meeting`);
  }
  if (triggers.length > 0) {
    return { action: "BRING_FORWARD", toDate: meetingDate, reason: `Bring forward: ${triggers.join("; ")}` };
  }
  const flagged = edits.flaggedForReview ?? task.flaggedForReview;
  return {
    action: "KEEP",
    toDate: task.nextDiscussionDate,
    reason: task.nextDiscussionDate
      ? `${flagged ? "Flagged, but can wait" : "No change"}: stays on ${fmt(task.nextDiscussionDate)}`
      : "Not on the meeting schedule",
  };
}

// ---------------------------------------------------------------------------
// Agenda

export interface ExistingAgendaItem {
  taskId: string;
  section: AgendaSectionValue;
  inclusion: AgendaInclusionValue;
  reason: string;
  estimatedMinutes: number;
  outcome: AgendaOutcomeValue;
}

export interface AgendaEntry {
  taskId: string;
  section: AgendaSectionValue;
  inclusion: AgendaInclusionValue;
  reason: string;
  estimatedMinutes: number;
  outcome: AgendaOutcomeValue;
  /** An outcome has been recorded, so the entry is kept as history. */
  locked: boolean;
}

export interface AgendaResult {
  entries: AgendaEntry[];
  /** Pending items stored for this meeting that are no longer eligible. */
  dropped: { taskId: string; reason: string }[];
}

export function classifySection(
  task: SchedulableTask,
  inclusion: AgendaInclusionValue,
  meetingDate: ISODate,
  config: SchedulingConfig
): AgendaSectionValue {
  if (normalizePriority(task.priority) === "URGENT" || inclusion === "BROUGHT_FORWARD") return "URGENT";
  if (task.isBlocked || isTaskOverdue(task, meetingDate)) return "BLOCKED_OVERDUE";
  const isNew =
    !task.lastDiscussedAt &&
    task.createdOn <= meetingDate &&
    task.createdOn > addDays(meetingDate, -config.newTaskWindowDays);
  if (isNew || !task.frequency) return "NEW";
  return task.frequency === "M" ? "WEEKLY" : task.frequency === "F" ? "FORTNIGHTLY" : "MONTHLY";
}

/** Why the task is on the agenda, in plain words. */
function inclusionReason(task: SchedulableTask, inclusion: AgendaInclusionValue, meetingDate: ISODate): string {
  const parts: string[] = [];
  if (inclusion === "BROUGHT_FORWARD") {
    parts.push(task.scheduleReason ?? "Brought forward");
  } else if (task.nextDiscussionDate && task.nextDiscussionDate < meetingDate) {
    parts.push(`Carried over: discussion was due ${fmt(task.nextDiscussionDate)}`);
  } else if (task.scheduleState === "DEFERRED") {
    parts.push(
      task.originalDiscussionDate
        ? `Deferred from ${fmt(task.originalDiscussionDate)}${task.scheduleReason ? ` (${task.scheduleReason})` : ""}`
        : task.scheduleReason ?? "Deferred to this meeting"
    );
  } else if (task.scheduleState === "PINNED") {
    parts.push(task.scheduleReason ?? "Agreed discussion date");
  } else {
    parts.push(task.frequency ? `${FREQUENCY_LABEL[task.frequency]} discussion due` : "Scheduled");
  }
  if (task.isBlocked) parts.push("blocked");
  if (isTaskOverdue(task, meetingDate) && task.dueDate) parts.push(`deadline ${fmt(task.dueDate)} passed`);
  if (task.flaggedForReview) parts.push("flagged in latest review");
  return parts.join("; ");
}

function eligibility(task: SchedulableTask, meetingDate: ISODate): AgendaInclusionValue | null {
  if (isTaskClosed(task)) return null;
  if (!task.nextDiscussionDate || task.nextDiscussionDate > meetingDate) return null;
  return task.scheduleState === "BROUGHT_FORWARD" ? "BROUGHT_FORWARD" : "DUE";
}

/**
 * Build the agenda for one meeting from the tasks and whatever is already
 * stored for that meeting. Regenerating is idempotent: the same inputs always
 * give the same entries, each task at most once.
 */
export function buildAgenda(params: {
  meetingDate: ISODate;
  tasks: SchedulableTask[];
  existingItems: ExistingAgendaItem[];
  config: SchedulingConfig;
}): AgendaResult {
  const { meetingDate, tasks, existingItems, config } = params;
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
      continue;
    }
    if (!task || isTaskClosed(task)) {
      dropped.push({ taskId: item.taskId, reason: "Task is completed, deleted or cancelled" });
      continue;
    }
    if (item.inclusion === "MANUAL") {
      entries.set(item.taskId, {
        taskId: item.taskId,
        section: classifySection(task, "MANUAL", meetingDate, config),
        inclusion: "MANUAL",
        reason: item.reason,
        estimatedMinutes: discussionMinutes(task, config),
        outcome: "PENDING",
        locked: false,
      });
    }
  }

  for (const task of tasks) {
    if (entries.has(task.id)) continue;
    const inclusion = eligibility(task, meetingDate);
    if (!inclusion) continue;
    entries.set(task.id, {
      taskId: task.id,
      section: classifySection(task, inclusion, meetingDate, config),
      inclusion,
      reason: inclusionReason(task, inclusion, meetingDate),
      estimatedMinutes: discussionMinutes(task, config),
      outcome: "PENDING",
      locked: false,
    });
  }

  for (const item of existingItems) {
    if (item.outcome === "PENDING" && item.inclusion !== "MANUAL" && !entries.has(item.taskId)) {
      if (!dropped.some((d) => d.taskId === item.taskId)) {
        dropped.push({ taskId: item.taskId, reason: "No longer due at this meeting" });
      }
    }
  }

  const sorted = [...entries.values()].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    if (s !== 0) return s;
    const ta = byId.get(a.taskId);
    const tb = byId.get(b.taskId);
    const p = PRIORITY_RANK[normalizePriority(ta?.priority)] - PRIORITY_RANK[normalizePriority(tb?.priority)];
    if (p !== 0) return p;
    return (ta?.title ?? "").localeCompare(tb?.title ?? "") || a.taskId.localeCompare(b.taskId);
  });

  return { entries: sorted, dropped };
}

export interface AgendaLoad {
  taskCount: number;
  totalMinutes: number;
  limitMinutes: number;
  overBy: number;
  overloaded: boolean;
}

/** Load of the entries that will still be discussed (deferred ones are excluded). */
export function summarizeLoad(entries: AgendaEntry[], limitMinutes: number): AgendaLoad {
  const active = entries.filter((e) => e.outcome !== "DEFERRED");
  const totalMinutes = active.reduce((sum, e) => sum + e.estimatedMinutes, 0);
  return {
    taskCount: active.length,
    totalMinutes,
    limitMinutes,
    overBy: Math.max(0, totalMinutes - limitMinutes),
    overloaded: totalMinutes > limitMinutes,
  };
}

export interface DeferralRecommendation {
  taskId: string;
  suggestedDate: ISODate;
  minutes: number;
  reason: string;
}

/**
 * When the agenda is over the time limit, suggest which tasks could move to
 * the next Monday. Only suggestions: nothing is moved without confirmation.
 * Urgent, high-priority, blocked, overdue, brought-forward, flagged and
 * manually added tasks are never suggested.
 */
export function recommendDeferrals(params: {
  entries: AgendaEntry[];
  tasks: SchedulableTask[];
  meetingDate: ISODate;
  limitMinutes: number;
  config: SchedulingConfig;
}): DeferralRecommendation[] {
  const { entries, meetingDate, limitMinutes, config } = params;
  const load = summarizeLoad(entries, limitMinutes);
  if (!load.overloaded) return [];

  const byId = new Map(params.tasks.map((t) => [t.id, t]));
  const weights = config.deferral;
  const candidates = entries
    .filter((e) => e.outcome === "PENDING" && e.inclusion === "DUE")
    .filter((e) => ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "NEW"].includes(e.section))
    .map((e) => ({ entry: e, task: byId.get(e.taskId) }))
    .filter(
      (c): c is { entry: AgendaEntry; task: SchedulableTask } =>
        !!c.task &&
        !weights.protectedPriorities.includes(normalizePriority(c.task.priority)) &&
        !c.task.flaggedForReview &&
        !isProtectedFromDeferral(c.task, meetingDate)
    )
    .map((c) => ({
      ...c,
      score:
        weights.priorityScore[normalizePriority(c.task.priority)] +
        (c.entry.section === "NEW" || !c.task.frequency
          ? weights.newTaskScore
          : weights.frequencyScore[c.task.frequency]),
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.entry.estimatedMinutes - a.entry.estimatedMinutes ||
        a.task.title.localeCompare(b.task.title) ||
        a.task.id.localeCompare(b.task.id)
    );

  const suggestedDate = addDays(meetingDate, 7);
  const result: DeferralRecommendation[] = [];
  let remaining = load.totalMinutes;
  for (const c of candidates) {
    if (remaining <= limitMinutes) break;
    remaining -= c.entry.estimatedMinutes;
    const priority = normalizePriority(c.task.priority).toLowerCase();
    result.push({
      taskId: c.task.id,
      suggestedDate,
      minutes: c.entry.estimatedMinutes,
      reason: `Meeting is ${load.overBy} min over; ${priority}-priority ${
        c.task.frequency ? FREQUENCY_LABEL[c.task.frequency].toLowerCase() : "new"
      } task can wait until ${fmt(suggestedDate)}`,
    });
  }
  return result;
}
