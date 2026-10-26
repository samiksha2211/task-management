"use client";

import { useEffect, useState } from "react";
import {
  CYCLE_LABEL,
  addDaysISO,
  fmtDay,
  fmtMonday,
  getHistory,
  type HistoryResponse,
  type RegisterTask,
} from "@/lib/meetings";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mtg-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mtg-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {subtitle && <div className="mtg-muted">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/** Move a task's next discussion to another Monday. Its cycle stays the same. */
export function RescheduleDialog({
  task,
  upcomingMonday,
  busy,
  onCancel,
  onConfirm,
}: {
  task: RegisterTask;
  upcomingMonday: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (toDate: string, reason: string) => void;
}) {
  const mondays = Array.from({ length: 12 }, (_, i) => addDaysISO(upcomingMonday, 7 * i)).filter(
    (d) => d !== task.nextDiscussionDate
  );
  const [toDate, setToDate] = useState(mondays[0]);
  const [reason, setReason] = useState("");

  return (
    <Modal title="Reschedule discussion" subtitle={`#${task.taskNumber} · ${task.title}`} onClose={onCancel}>
      <p className="mtg-muted" style={{ marginTop: 12 }}>
        Currently: {fmtDay(task.nextDiscussionDate)}. The task stays{" "}
        {task.cycle ? CYCLE_LABEL[task.cycle].toLowerCase() : "without a cycle"}; after it is discussed, its normal
        cycle continues.
      </p>
      <div className="mtg-field">
        <label htmlFor="mtg-reschedule-date">Discuss on</label>
        <select id="mtg-reschedule-date" value={toDate} onChange={(e) => setToDate(e.target.value)}>
          {mondays.map((d) => (
            <option key={d} value={d}>
              {fmtMonday(d)}
            </option>
          ))}
        </select>
      </div>
      <div className="mtg-field">
        <label htmlFor="mtg-reschedule-reason">Reason (optional)</label>
        <input
          id="mtg-reschedule-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Urgent issue in this week's report"
        />
      </div>
      <div className="mtg-modal-actions">
        <button type="button" className="mtg-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="mtg-btn" onClick={() => onConfirm(toDate, reason.trim())} disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </Modal>
  );
}

const EVENT_LABEL: Record<string, string> = {
  INITIALIZED: "Cycle assigned",
  FREQUENCY_CHANGED: "Cycle changed",
  RESCHEDULED: "Rescheduled",
  BROUGHT_FORWARD: "Brought forward",
  DEFERRED: "Moved later",
  DISCUSSED: "Discussed",
  DISCUSSION_UNDONE: "Discussion undone",
  ADDED_TO_AGENDA: "Added to agenda",
  REMOVED_FROM_AGENDA: "Removed from agenda",
  COMPLETED: "Completed",
};

export function HistoryDialog({ task, onClose }: { task: RegisterTask; onClose: () => void }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory(task.id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"));
  }, [task.id]);

  const events = data?.events.filter((e) => e.type !== "ADDED_TO_AGENDA" && e.type !== "REMOVED_FROM_AGENDA") ?? [];

  return (
    <Modal title="Discussion history" subtitle={`#${task.taskNumber} · ${task.title}`} onClose={onClose}>
      {error && <div className="mtg-banner is-error">{error}</div>}
      {!data && !error && <p className="mtg-muted">Loading...</p>}
      {data && (
        <>
          <p className="mtg-muted" style={{ marginTop: 10 }}>
            Discussed at {data.meetings.filter((m) => m.outcome === "DISCUSSED").length} meeting(s). Last discussed:{" "}
            {fmtDay(task.lastDiscussedAt)}.
          </p>
          {events.length === 0 ? (
            <p className="mtg-muted">No changes recorded yet.</p>
          ) : (
            <ul className="mtg-timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>{" "}
                  <span className="mtg-muted">
                    {new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    {e.by ? ` · ${e.by}` : ""}
                  </span>
                  {e.fromCycle !== e.toCycle && (
                    <div className="mtg-muted">
                      {e.fromCycle ? CYCLE_LABEL[e.fromCycle] : "No cycle"} → {e.toCycle ? CYCLE_LABEL[e.toCycle] : "No cycle"}
                    </div>
                  )}
                  {e.toDate && <div className="mtg-muted">Next discussion: {fmtDay(e.toDate)}</div>}
                  {e.reason && <div className="mtg-muted">{e.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mtg-modal-actions">
        <button type="button" className="mtg-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
