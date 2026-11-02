import { apiFetch, getToken } from "./api";

/** The repeating review frequencies (W / FT / M). */
export type Cycle = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
/** One-time review: discussed once, on the allocated Monday. */
export type OneTimeCycle = "NEXT_MONDAY" | "NEXT_MONTH" | "FLEXIBLE";
export type Frequency = Cycle | OneTimeCycle;
export type TaskStatusLabel = "Pending" | "Running" | "Overdue" | "Completed";

export const ONE_TIME_CYCLES: OneTimeCycle[] = ["NEXT_MONDAY", "NEXT_MONTH", "FLEXIBLE"];

export const ONE_TIME_LABEL: Record<OneTimeCycle, string> = {
  NEXT_MONDAY: "Next Monday",
  NEXT_MONTH: "Next Month",
  FLEXIBLE: "Flexible Date",
};

export const ONE_TIME_HINT: Record<OneTimeCycle, string> = {
  NEXT_MONDAY: "Discussed once, on the coming Monday.",
  NEXT_MONTH: "Discussed once, on the Monday of next month you choose.",
  FLEXIBLE: "Discussed once, on any Monday you choose.",
};

export function isOneTime(f: Frequency | "" | null | undefined): f is OneTimeCycle {
  return f === "NEXT_MONDAY" || f === "NEXT_MONTH" || f === "FLEXIBLE";
}

/** "W (Weekly)", "Next Month", ... */
export function frequencyLabel(f: Frequency | null | undefined): string {
  if (!f) return "—";
  return isOneTime(f) ? ONE_TIME_LABEL[f] : `${REVIEW_CODE[f]} (${CYCLE_LABEL[f]})`;
}

/** The Mondays of the month after `today` (choices for "Next Month"). */
export function nextMonthMondaysISO(today: string): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const month = first.slice(0, 7);
  const out: string[] = [];
  for (let m = mondayOnOrAfterISO(first); m.startsWith(month); m = addDaysISO(m, 7)) out.push(m);
  return out;
}

export const CYCLES: Cycle[] = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"];

export const CYCLE_LABEL: Record<Cycle, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

/** Short review-frequency codes used everywhere (website and PDFs). */
export const REVIEW_CODE: Record<Cycle, "W" | "FT" | "M"> = {
  WEEKLY: "W",
  FORTNIGHTLY: "FT",
  MONTHLY: "M",
};

export const CYCLE_HINT: Record<Cycle, string> = {
  WEEKLY: "Weekly – every Monday",
  FORTNIGHTLY: "Fortnightly – once every two weeks",
  MONTHLY: "Monthly – once a month",
};

/** Allocated Monday of the month for M tasks. */
export const ORDINAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1st Monday" },
  { value: 2, label: "2nd Monday" },
  { value: 3, label: "3rd Monday" },
  { value: 4, label: "4th Monday" },
  { value: 5, label: "5th Monday" },
];

export const FIFTH_MONDAY_NOTE = "In months with four Mondays, a 5th-Monday task is on the last Monday.";

/** Which Monday of its month a date is: "1st Monday" ... "5th Monday". */
export function mondayPositionLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDate();
  return ORDINAL_OPTIONS[Math.ceil(day / 7) - 1]?.label ?? "";
}

/** The two alternate-week choices for a fortnightly task: starting on the coming Monday or the one after. */
export function fortnightStartOptions(upcomingMonday: string): { value: string; label: string }[] {
  return [upcomingMonday, addDaysISO(upcomingMonday, 7)].map((d) => ({
    value: d,
    label: `From ${fmtMonday(d)} (${mondayPositionLabel(d)}), then every other Monday`,
  }));
}

export interface RegisterTask {
  id: string;
  taskNumber: number;
  title: string;
  officer: string;
  status: TaskStatusLabel;
  dueDate: string;
  cycle: Frequency | null;
  /** W / FT / M, or the one-time frequency's name. */
  reviewCode: string | null;
  monthlyMondayOrdinal: number | null;
  fortnightAnchor: string | null;
  oneTime: boolean;
  /** One-time frequencies: the allocated Monday (YYYY-MM-DD). */
  allocatedMondayDate: string | null;
  /** Marked important for immediate discussion. */
  important: boolean;
  /** "Every Monday", "3rd Monday", "2nd Monday · alternate weeks" */
  allocatedMonday: string | null;
  /** Next Monday the task is scheduled for discussion. */
  nextDiscussionDate: string | null;
  lastDiscussedAt: string | null;
  rescheduled: boolean;
  scheduleReason: string | null;
  remarks: string;
}

export interface RegisterResponse {
  today: string;
  upcomingMonday: string;
  nextMonthMondays: string[];
  counts: Record<Cycle | "ONE_TIME" | "UNASSIGNED", number>;
  tasks: RegisterTask[];
}

export interface AgendaFile {
  id: string;
  kind: "FILE" | "LINK";
  name: string;
  url: string;
}

export interface AgendaTask extends RegisterTask {
  /** S.N.: position in the agenda (newest task date first). */
  serial: number;
  /** Task date (YYYY-MM-DD). */
  date: string;
  /** "W (Weekly)", "Next Month", ... */
  frequency: string;
  otherOfficers: string[];
  actionPlan: string | null;
  drmRemark: string | null;
  drmFiles: AgendaFile[];
  latestBo: { remark: string | null; by: string; at: string; files: AgendaFile[] } | null;
  /** The meeting date the task is on. */
  scheduledDate: string;
  reason: string;
  inclusion: "DUE" | "BROUGHT_FORWARD" | "MANUAL";
  outcome: "PENDING" | "DISCUSSED" | "NOT_DISCUSSED" | "DEFERRED";
  notes: string | null;
}

export interface AgendaResponse {
  meetingDate: string;
  today: string;
  upcomingMonday: string;
  /** Finalized agendas are frozen; tasks created afterwards go to the next Monday. */
  finalized: boolean;
  finalizedAt: string | null;
  items: AgendaTask[];
}

export interface HistoryResponse {
  meetings: { meetingDate: string; outcome: string; notes: string | null }[];
  events: {
    id: string;
    type: string;
    createdAt: string;
    by: string | null;
    fromDate: string | null;
    toDate: string | null;
    fromCycle: Frequency | null;
    toCycle: Frequency | null;
    reason: string | null;
  }[];
}

/** Calendar-day helpers on "YYYY-MM-DD" strings (UTC maths, no time-zone drift). */
export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isMondayISO(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

export function mondayOnOrAfterISO(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysISO(date, (8 - day) % 7);
}

export function fmtDay(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtMonday(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const getRegister = () => apiFetch<RegisterResponse>("/api/meetings/register");

export const getAgenda = (date?: string) =>
  apiFetch<AgendaResponse>(`/api/meetings/agenda${date ? `?date=${date}` : ""}`);

export interface CycleOptions {
  monthlyMondayOrdinal?: number | null;
  fortnightAnchor?: string | null;
  /** Next Month / Flexible Date: the chosen Monday. */
  allocatedMonday?: string | null;
}

export const setCycle = (taskId: string, cycle: Frequency | null, options: CycleOptions = {}) =>
  apiFetch(`/api/schedule/tasks/${taskId}/cycle`, {
    method: "PATCH",
    body: JSON.stringify({ cycle, ...options }),
  });

export const setCycleBulk = (taskIds: string[], cycle: Frequency | null, options: CycleOptions = {}) =>
  apiFetch<{ updated: number }>("/api/schedule/cycle", {
    method: "POST",
    body: JSON.stringify({ taskIds, cycle, ...options }),
  });

export const rescheduleTask = (taskId: string, toDate: string, reason?: string, fromDate?: string) =>
  apiFetch(`/api/schedule/tasks/${taskId}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ toDate, reason, fromDate }),
  });

export const setImportant = (taskId: string, important: boolean) =>
  apiFetch(`/api/schedule/tasks/${taskId}/important`, {
    method: "POST",
    body: JSON.stringify({ important }),
  });

export const markDiscussed = (date: string, taskId: string, discussed: boolean) =>
  apiFetch<AgendaResponse>(`/api/meetings/${date}/items/${taskId}/outcome`, {
    method: "POST",
    body: JSON.stringify({ outcome: discussed ? "DISCUSSED" : "PENDING" }),
  });

export const finalizeAgenda = (date: string) =>
  apiFetch<AgendaResponse>(`/api/meetings/${date}/finalize`, { method: "POST" });

export const reopenAgenda = (date: string) =>
  apiFetch<AgendaResponse>(`/api/meetings/${date}/reopen`, { method: "POST" });

export const getHistory = (taskId: string) => apiFetch<HistoryResponse>(`/api/schedule/tasks/${taskId}/history`);

/** Download a file from an authenticated API route. */
async function download(url: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = "Download failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const match = /filename="?([^"]+)"?/.exec(res.headers.get("Content-Disposition") ?? "");
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = match?.[1] || fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export type StatusFilter = "all" | "pending" | "running" | "overdue" | "completed" | "pending_overdue";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "overdue", label: "Overdue" },
  { value: "completed", label: "Completed" },
  { value: "pending_overdue", label: "Pending/Overdue" },
];

export function matchesStatus(status: TaskStatusLabel, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending_overdue") return status !== "Completed";
  return status.toLowerCase() === filter;
}

/** Cycle PDF in the Task Report layout. "ALL" = Weekly, Fortnightly and Monthly sections in one PDF. */
export const downloadRegisterPdf = (cycle: Cycle | "ALL", status: StatusFilter = "all") =>
  download(`/api/meetings/register/pdf?cycle=${cycle}&status=${status}`, `monday_meeting_${cycle.toLowerCase()}.pdf`);

export const downloadAgenda = (date: string, format: "pdf" | "xlsx") =>
  download(`/api/meetings/${date}/export?format=${format}`, `monday_discussion_agenda_${date}.${format}`);
