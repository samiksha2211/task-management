import { apiFetch, getToken } from "./api";

export type Cycle = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
export type TaskStatusLabel = "Pending" | "Overdue" | "Completed";

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
  cycle: Cycle | null;
  reviewCode: "W" | "FT" | "M" | null;
  monthlyMondayOrdinal: number | null;
  fortnightAnchor: string | null;
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
  counts: Record<Cycle | "UNASSIGNED", number>;
  tasks: RegisterTask[];
}

export interface AgendaTask extends RegisterTask {
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
    fromCycle: Cycle | null;
    toCycle: Cycle | null;
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
}

export const setCycle = (taskId: string, cycle: Cycle | null, options: CycleOptions = {}) =>
  apiFetch(`/api/schedule/tasks/${taskId}/cycle`, {
    method: "PATCH",
    body: JSON.stringify({ cycle, ...options }),
  });

export const setCycleBulk = (taskIds: string[], cycle: Cycle | null, options: CycleOptions = {}) =>
  apiFetch<{ updated: number }>("/api/schedule/cycle", {
    method: "POST",
    body: JSON.stringify({ taskIds, cycle, ...options }),
  });

export const rescheduleTask = (taskId: string, toDate: string, reason?: string, fromDate?: string) =>
  apiFetch(`/api/schedule/tasks/${taskId}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ toDate, reason, fromDate }),
  });

export const markDiscussed = (date: string, taskId: string, discussed: boolean) =>
  apiFetch<AgendaResponse>(`/api/meetings/${date}/items/${taskId}/outcome`, {
    method: "POST",
    body: JSON.stringify({ outcome: discussed ? "DISCUSSED" : "PENDING" }),
  });

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

export type StatusFilter = "all" | "pending" | "overdue" | "completed" | "pending_overdue";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
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
  download(`/api/meetings/${date}/export?format=${format}`, `monday_agenda_${date}.${format}`);
