// Tunable scheduling settings. Environment variables override the defaults so
// they can be changed per deployment without code changes.

export type PriorityLevel = "URGENT" | "HIGH" | "NORMAL" | "LOW";
export type Frequency = "M" | "F" | "NM";

export interface SchedulingConfig {
  /** Time zone used to decide what "today" / "the upcoming Monday" is. */
  timeZone: string;
  /** Default meeting length for a new meeting, in minutes. */
  defaultMeetingMinutes: number;
  /** Discussion time assumed for a task with no estimate, in minutes. */
  defaultDiscussionMinutes: number;
  /** A never-discussed task created within this many days of the meeting is "new". */
  newTaskWindowDays: number;
  /**
   * Overload deferral ranking. Lower score = recommended for deferral first.
   * Priorities listed in protectedPriorities are never recommended.
   */
  deferral: {
    priorityScore: Record<PriorityLevel, number>;
    frequencyScore: Record<Frequency, number>;
    newTaskScore: number;
    protectedPriorities: PriorityLevel[];
  };
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const defaultSchedulingConfig: SchedulingConfig = {
  timeZone: process.env.MEETING_TIME_ZONE || "Asia/Kolkata",
  defaultMeetingMinutes: intEnv("MEETING_DURATION_LIMIT_MINUTES", 90),
  defaultDiscussionMinutes: intEnv("DEFAULT_DISCUSSION_MINUTES", 3),
  newTaskWindowDays: 7,
  deferral: {
    priorityScore: { LOW: 0, NORMAL: 10, HIGH: 50, URGENT: 100 },
    // A weekly task deferred one week loses least; a monthly task loses most.
    frequencyScore: { M: 0, F: 3, NM: 6 },
    newTaskScore: 8,
    protectedPriorities: ["URGENT", "HIGH"],
  },
};

export const PRIORITY_LEVELS: PriorityLevel[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

/** Task.priority is free text; anything unrecognised counts as NORMAL. */
export function normalizePriority(value: string | null | undefined): PriorityLevel {
  const upper = (value ?? "").trim().toUpperCase();
  return (PRIORITY_LEVELS as string[]).includes(upper) ? (upper as PriorityLevel) : "NORMAL";
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  M: "Weekly",
  F: "Fortnightly",
  NM: "Next Month",
};
