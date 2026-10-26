// Scheduling settings. Environment variables override the defaults.

export type Cycle = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

export const CYCLES: Cycle[] = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"];

export const CYCLE_LABEL: Record<Cycle, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

export interface SchedulingConfig {
  /** Time zone used to decide what "today" / "the upcoming Monday" is. */
  timeZone: string;
}

export const defaultSchedulingConfig: SchedulingConfig = {
  timeZone: process.env.MEETING_TIME_ZONE || "Asia/Kolkata",
};
