import { apiFetch, getToken } from "./api";

export type Frequency = "M" | "F" | "NM";
export type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW";
export type AgendaSection = "URGENT" | "BLOCKED_OVERDUE" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "NEW";
export type AgendaOutcome = "PENDING" | "DISCUSSED" | "NOT_DISCUSSED" | "DEFERRED";
export type MeetingStatus = "DRAFT" | "FINALIZED" | "CLOSED";

export const FREQUENCY_OPTIONS: { value: Frequency; label: string; hint: string }[] = [
  { value: "M", label: "M — Weekly", hint: "Discussed every Monday" },
  { value: "F", label: "F — Fortnightly", hint: "Every two weeks after the last discussion" },
  { value: "NM", label: "NM — Next Month", hint: "A set Monday of the following month" },
];

export const FREQUENCY_SHORT: Record<Frequency, string> = { M: "Weekly", F: "Fortnightly", NM: "Next Month" };

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
];

export const ORDINAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "First Monday" },
  { value: 2, label: "Second Monday" },
  { value: 3, label: "Third Monday" },
  { value: 4, label: "Fourth Monday" },
  { value: -1, label: "Last Monday" },
];

export interface AgendaItem {
  taskId: string;
  title: string;
  officer: string;
  status: "Pending" | "Completed" | "Overdue";
  dueDate: string;
  frequency: Frequency | null;
  monthlyMondayOrdinal: number | null;
  priority: Priority;
  lastDiscussedAt: string | null;
  nextDiscussionDate: string | null;
  originalDiscussionDate: string | null;
  scheduleState: string;
  scheduleReason: string | null;
  isBlocked: boolean;
  flaggedForReview: boolean;
  latestReviewNote: string | null;
  estimatedMinutes: number;
  section: AgendaSection;
  inclusion: "DUE" | "BROUGHT_FORWARD" | "MANUAL";
  reason: string;
  outcome: AgendaOutcome;
  discussionNotes: string | null;
  decisions: string | null;
  deferredTo: string | null;
  deferReason: string | null;
  stored: boolean;
}

export interface BriefTask {
  taskId: string;
  title: string;
  officer: string;
  status: "Pending" | "Completed" | "Overdue";
  dueDate: string;
  priority: Priority;
  frequency: Frequency | null;
  nextDiscussionDate: string | null;
  latestReviewNote: string | null;
  createdAt: string;
}

export interface AgendaView {
  meetingDate: string;
  today: string;
  upcomingMonday: string;
  defaults: { meetingMinutes: number; discussionMinutes: number };
  meeting: {
    id: string;
    meetingDate: string;
    status: MeetingStatus;
    durationLimitMinutes: number;
    notes: string | null;
    reportUrl: string | null;
    reportName: string | null;
    finalizedAt: string | null;
    closedAt: string | null;
  } | null;
  unsavedChanges: number;
  sections: { key: AgendaSection; label: string; items: AgendaItem[] }[];
  load: { taskCount: number; totalMinutes: number; limitMinutes: number; overBy: number; overloaded: boolean };
  recommendations: { taskId: string; suggestedDate: string; minutes: number; reason: string }[];
  unscheduled: BriefTask[];
  flagged: BriefTask[];
}

export interface HistoryResponse {
  task: {
    id: string;
    title: string;
    frequency: Frequency | null;
    lastDiscussedAt: string | null;
    nextDiscussionDate: string | null;
    scheduleState: string;
    scheduleReason: string | null;
  };
  meetings: {
    meetingDate: string;
    section: AgendaSection;
    outcome: AgendaOutcome;
    reason: string;
    discussionNotes: string | null;
    decisions: string | null;
    deferredTo: string | null;
    deferReason: string | null;
  }[];
  events: {
    id: string;
    type: string;
    createdAt: string;
    by: string | null;
    meetingDate: string | null;
    fromDate: string | null;
    toDate: string | null;
    fromFrequency: Frequency | null;
    toFrequency: Frequency | null;
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
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const getAgenda = (date?: string) =>
  apiFetch<AgendaView>(`/api/meetings/agenda${date ? `?date=${date}` : ""}`);

export const saveAgenda = (date: string) =>
  apiFetch<AgendaView>(`/api/meetings/${date}/save`, { method: "POST" });

export const updateMeeting = (
  date: string,
  body: Partial<{ durationLimitMinutes: number; notes: string | null; reportUrl: string | null; reportName: string | null }>
) => apiFetch<AgendaView>(`/api/meetings/${date}`, { method: "PATCH", body: JSON.stringify(body) });

export const setMeetingStatus = (date: string, status: MeetingStatus) =>
  apiFetch<AgendaView>(`/api/meetings/${date}/status`, { method: "POST", body: JSON.stringify({ status }) });

export const addAgendaItem = (date: string, taskId: string, reason: string) =>
  apiFetch<AgendaView>(`/api/meetings/${date}/items`, { method: "POST", body: JSON.stringify({ taskId, reason }) });

export const removeAgendaItem = (date: string, taskId: string) =>
  apiFetch<AgendaView>(`/api/meetings/${date}/items/${taskId}`, { method: "DELETE" });

export const recordOutcome = (
  date: string,
  taskId: string,
  body: { outcome: "PENDING" | "DISCUSSED" | "NOT_DISCUSSED"; discussionNotes?: string | null; decisions?: string | null }
) =>
  apiFetch<AgendaView>(`/api/meetings/${date}/items/${taskId}/outcome`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deferTask = (
  taskId: string,
  body: { toDate: string; reason: string; meetingDate?: string; confirmed?: boolean }
) => apiFetch(`/api/schedule/tasks/${taskId}/defer`, { method: "POST", body: JSON.stringify(body) });

export const bringForward = (taskId: string, body: { toDate?: string; reason: string }) =>
  apiFetch(`/api/schedule/tasks/${taskId}/bring-forward`, { method: "POST", body: JSON.stringify(body) });

export const updateSchedule = (
  taskId: string,
  body: Partial<{
    discussionFrequency: Frequency | null;
    monthlyMondayOrdinal: number | null;
    recalculate: boolean;
    priority: string | null;
    estimatedDiscussionMinutes: number | null;
    isBlocked: boolean;
    flaggedForReview: boolean;
    latestReviewNote: string | null;
    pinnedDate: string | null;
    cancelled: boolean;
    reason: string | null;
  }>
) => apiFetch(`/api/schedule/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) });

export const completeTask = (taskId: string, reason?: string) =>
  apiFetch(`/api/schedule/tasks/${taskId}/complete`, { method: "POST", body: JSON.stringify({ reason }) });

export const initializeSchedules = (taskIds: string[], discussionFrequency: Frequency, monthlyMondayOrdinal?: number | null) =>
  apiFetch<{ initialized: number }>("/api/schedule/initialize", {
    method: "POST",
    body: JSON.stringify({ taskIds, discussionFrequency, monthlyMondayOrdinal: monthlyMondayOrdinal ?? null }),
  });

export const getHistory = (taskId: string) => apiFetch<HistoryResponse>(`/api/schedule/tasks/${taskId}/history`);

export interface ReviewUpdate {
  taskId: string;
  priority?: string | null;
  isBlocked?: boolean;
  flaggedForReview?: boolean;
  latestReviewNote?: string | null;
  needsDiscussion?: boolean;
  bringForward?: boolean;
  reason?: string;
}

export const proposeReview = (meetingDate: string, updates: ReviewUpdate[]) =>
  apiFetch<{ proposals: { taskId: string; action: "BRING_FORWARD" | "KEEP" | "NONE"; toDate: string | null; reason: string }[] }>(
    "/api/schedule/review/propose",
    { method: "POST", body: JSON.stringify({ meetingDate, updates }) }
  );

export const applyReview = (meetingDate: string, updates: ReviewUpdate[]) =>
  apiFetch<{ results: { taskId: string; ok: boolean; error?: string; broughtForward?: boolean }[] }>(
    "/api/schedule/review/apply",
    { method: "POST", body: JSON.stringify({ meetingDate, updates }) }
  );

export async function downloadAgenda(date: string, format: "xlsx" | "csv"): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/meetings/${date}/export?format=${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = "Failed to export the agenda";
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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] || `monday_agenda_${date}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
