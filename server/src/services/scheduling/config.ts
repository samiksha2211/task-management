// Scheduling settings. Environment variables override the defaults.

export type RepeatingCycle = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
/** One-time review: discussed once, on the task's allocated Monday. */
export type OneTimeCycle = "NEXT_MONDAY" | "NEXT_MONTH" | "FLEXIBLE";
export type Cycle = RepeatingCycle | OneTimeCycle;

/** The repeating W / F1 / F2 / M frequencies (registers and grouped PDFs). */
export const CYCLES: RepeatingCycle[] = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"];
export const ONE_TIME_CYCLES: OneTimeCycle[] = ["NEXT_MONDAY", "NEXT_MONTH", "FLEXIBLE"];
export const ALL_CYCLES: Cycle[] = [...CYCLES, ...ONE_TIME_CYCLES];

/** Review frequency as entered: F1 / F2 are fortnightly with a group. */
export const CYCLE_INPUTS = ["WEEKLY", "F1", "F2", "FORTNIGHTLY", "MONTHLY", "NEXT_MONDAY", "NEXT_MONTH", "FLEXIBLE"] as const;
export type CycleInput = (typeof CYCLE_INPUTS)[number];

export function parseCycleInput(input: CycleInput | null): { cycle: Cycle | null; fortnightGroup?: 1 | 2 } {
  if (input === "F1") return { cycle: "FORTNIGHTLY", fortnightGroup: 1 };
  if (input === "F2") return { cycle: "FORTNIGHTLY", fortnightGroup: 2 };
  return { cycle: input };
}

export function isOneTime(cycle: Cycle | null | undefined): cycle is OneTimeCycle {
  return cycle === "NEXT_MONDAY" || cycle === "NEXT_MONTH" || cycle === "FLEXIBLE";
}

export const CYCLE_LABEL: Record<Cycle, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  NEXT_MONDAY: "Next Monday",
  NEXT_MONTH: "Next Month",
  FLEXIBLE: "Flexible Date",
};

export interface SchedulingConfig {
  /** Time zone used to decide what "today" / "the upcoming Monday" is. */
  timeZone: string;
}

export const defaultSchedulingConfig: SchedulingConfig = {
  timeZone: process.env.MEETING_TIME_ZONE || "Asia/Kolkata",
};
