"use client";

import { useEffect, useState } from "react";
import {
  FREQUENCY_OPTIONS,
  FREQUENCY_SHORT,
  ORDINAL_OPTIONS,
  addDaysISO,
  fmtDay,
  fmtMonday,
  getHistory,
  type AgendaItem,
  type Frequency,
  type HistoryResponse,
} from "@/lib/meetings";

export function Modal({
  title,
  subtitle,
  wide,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
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
      <div className={`mtg-modal ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {subtitle && <div className="mtg-muted">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

function Actions({
  busy,
  confirmLabel,
  disabled,
  danger,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  confirmLabel: string;
  disabled?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mtg-modal-actions">
      <button type="button" className="mtg-btn-ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button
        type="button"
        className={danger ? "mtg-btn-danger" : "mtg-btn"}
        onClick={onConfirm}
        disabled={busy || disabled}
      >
        {busy ? "Saving..." : confirmLabel}
      </button>
    </div>
  );
}

/** Record that a task was actually discussed, with notes and decisions. */
export function DiscussDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: AgendaItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (notes: string, decisions: string) => void;
}) {
  const [notes, setNotes] = useState(item.discussionNotes ?? "");
  const [decisions, setDecisions] = useState(item.decisions ?? "");
  const alreadyDiscussed = item.outcome === "DISCUSSED";
  return (
    <Modal
      title={alreadyDiscussed ? "Discussion notes" : "Mark as discussed"}
      subtitle={item.title}
      onClose={onCancel}
    >
      {!alreadyDiscussed && (
        <p className="mtg-muted" style={{ marginTop: 12 }}>
          {item.frequency
            ? `The last-discussed date becomes this meeting, and the next discussion is calculated from its ${FREQUENCY_SHORT[
                item.frequency
              ].toLowerCase()} frequency.`
            : "This task has no frequency, so it will not be scheduled again automatically."}
        </p>
      )}
      <div className="mtg-field">
        <label htmlFor="mtg-notes">Discussion notes</label>
        <textarea id="mtg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="mtg-field">
        <label htmlFor="mtg-decisions">Decisions</label>
        <textarea id="mtg-decisions" value={decisions} onChange={(e) => setDecisions(e.target.value)} />
      </div>
      <Actions
        busy={busy}
        confirmLabel={alreadyDiscussed ? "Save notes" : "Mark as discussed"}
        onCancel={onCancel}
        onConfirm={() => onConfirm(notes, decisions)}
      />
    </Modal>
  );
}

function isProtected(item: AgendaItem, meetingDate: string): boolean {
  return (
    item.priority === "URGENT" ||
    item.isBlocked ||
    item.scheduleState === "BROUGHT_FORWARD" ||
    (item.status !== "Completed" && item.dueDate < meetingDate)
  );
}

/** Defer a task to a later Monday. Urgent / overdue / blocked tasks need an explicit tick. */
export function DeferDialog({
  item,
  meetingDate,
  suggestedDate,
  suggestedReason,
  busy,
  onCancel,
  onConfirm,
}: {
  item: AgendaItem;
  meetingDate: string;
  suggestedDate?: string;
  suggestedReason?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (toDate: string, reason: string, confirmed: boolean) => void;
}) {
  const mondays = Array.from({ length: 8 }, (_, i) => addDaysISO(meetingDate, 7 * (i + 1)));
  const [toDate, setToDate] = useState(suggestedDate ?? mondays[0]);
  const [reason, setReason] = useState(suggestedReason ?? "");
  const needsConfirm = isProtected(item, meetingDate);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Modal title="Defer to another Monday" subtitle={item.title} onClose={onCancel}>
      <p className="mtg-muted" style={{ marginTop: 12 }}>
        The task keeps its {item.frequency ? FREQUENCY_SHORT[item.frequency].toLowerCase() : ""} frequency. It
        will appear only on the date you pick, not on the Mondays in between.
      </p>
      <div className="mtg-field">
        <label htmlFor="mtg-defer-date">Discuss on</label>
        <select id="mtg-defer-date" value={toDate} onChange={(e) => setToDate(e.target.value)}>
          {mondays.map((d) => (
            <option key={d} value={d}>
              {fmtMonday(d)}
            </option>
          ))}
        </select>
      </div>
      <div className="mtg-field">
        <label htmlFor="mtg-defer-reason">Reason for deferring</label>
        <textarea
          id="mtg-defer-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Meeting overloaded; awaiting site report"
        />
      </div>
      {needsConfirm && (
        <>
          <div className="mtg-warning">
            This task is urgent, blocked, overdue or was brought forward. Deferring it needs your confirmation.
          </div>
          <label className="mtg-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I confirm this task should wait until {fmtDay(toDate)}.</span>
          </label>
        </>
      )}
      <Actions
        busy={busy}
        confirmLabel="Defer task"
        disabled={!reason.trim() || (needsConfirm && !confirmed)}
        onCancel={onCancel}
        onConfirm={() => onConfirm(toDate, reason.trim(), confirmed)}
      />
    </Modal>
  );
}

/** Bring a task forward to this meeting, recording why. Frequency stays the same. */
export function BringForwardDialog({
  title,
  meetingDate,
  nextDiscussionDate,
  defaultReason,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  meetingDate: string;
  nextDiscussionDate: string | null;
  defaultReason?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(defaultReason ?? "");
  return (
    <Modal title={`Bring forward to ${fmtMonday(meetingDate)}`} subtitle={title} onClose={onCancel}>
      <p className="mtg-muted" style={{ marginTop: 12 }}>
        {nextDiscussionDate ? `Currently scheduled for ${fmtDay(nextDiscussionDate)}. ` : "Not currently scheduled. "}
        Its regular frequency is not changed: after it is discussed, the next date follows the normal rule.
      </p>
      <div className="mtg-field">
        <label htmlFor="mtg-bf-reason">Why is it needed earlier?</label>
        <textarea
          id="mtg-bf-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Urgent issue reported in this week's PDF"
        />
      </div>
      <Actions
        busy={busy}
        confirmLabel="Bring forward"
        disabled={!reason.trim()}
        onCancel={onCancel}
        onConfirm={() => onConfirm(reason.trim())}
      />
    </Modal>
  );
}

/** Change a task's discussion frequency. Past meeting history is not changed. */
export function FrequencyDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: { title: string; frequency: Frequency | null; monthlyMondayOrdinal: number | null; scheduleState: string };
  busy: boolean;
  onCancel: () => void;
  onConfirm: (frequency: Frequency | null, ordinal: number | null, recalculate: boolean, reason: string) => void;
}) {
  const [frequency, setFrequency] = useState<Frequency | "">(item.frequency ?? "");
  const [ordinal, setOrdinal] = useState(item.monthlyMondayOrdinal ?? 1);
  const [reason, setReason] = useState("");
  const manualDate = ["DEFERRED", "BROUGHT_FORWARD", "PINNED"].includes(item.scheduleState);
  const [recalculate, setRecalculate] = useState(false);
  const unchanged =
    (frequency || null) === item.frequency &&
    (frequency !== "NM" || ordinal === (item.monthlyMondayOrdinal ?? 1)) &&
    !recalculate;

  return (
    <Modal title="Change discussion frequency" subtitle={item.title} onClose={onCancel}>
      <div className="mtg-field">
        <label htmlFor="mtg-freq">Frequency</label>
        <select id="mtg-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency | "")}>
          <option value="">Not on the Monday meeting</option>
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {frequency === "NM" && (
        <div className="mtg-field">
          <label htmlFor="mtg-ordinal">Monthly discussion day</label>
          <select id="mtg-ordinal" value={ordinal} onChange={(e) => setOrdinal(Number(e.target.value))}>
            {ORDINAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} of the month
              </option>
            ))}
          </select>
        </div>
      )}
      {manualDate && (
        <label className="mtg-check">
          <input type="checkbox" checked={recalculate} onChange={(e) => setRecalculate(e.target.checked)} />
          <span>
            Also replace its deferred / brought-forward / agreed date with the date from the new frequency.
          </span>
        </label>
      )}
      <div className="mtg-field">
        <label htmlFor="mtg-freq-reason">Reason (optional)</label>
        <textarea id="mtg-freq-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <p className="mtg-muted" style={{ marginTop: 10 }}>
        Future discussion dates are recalculated from the last discussion. Past meetings are not changed.
      </p>
      <Actions
        busy={busy}
        confirmLabel="Change frequency"
        disabled={unchanged}
        onCancel={onCancel}
        onConfirm={() => onConfirm(frequency || null, frequency === "NM" ? ordinal : null, recalculate, reason.trim())}
      />
    </Modal>
  );
}

const EVENT_LABEL: Record<string, string> = {
  INITIALIZED: "Scheduled",
  FREQUENCY_CHANGED: "Frequency changed",
  RESCHEDULED: "Date agreed",
  BROUGHT_FORWARD: "Brought forward",
  DEFERRED: "Deferred",
  DISCUSSED: "Discussed",
  DISCUSSION_UNDONE: "Discussion outcome undone",
  REVIEW_UPDATED: "Review update",
  ADDED_TO_AGENDA: "Added to agenda",
  REMOVED_FROM_AGENDA: "Removed from agenda",
  COMPLETED: "Completed",
  CANCELLED: "Removed from schedule",
};

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: "Pending",
  DISCUSSED: "Discussed",
  NOT_DISCUSSED: "Not discussed",
  DEFERRED: "Deferred",
};

export function HistoryDialog({ taskId, title, onClose }: { taskId: string; title: string; onClose: () => void }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory(taskId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"));
  }, [taskId]);

  return (
    <Modal title="Discussion history" subtitle={title} wide onClose={onClose}>
      {error && <div className="mtg-warning">{error}</div>}
      {!data && !error && <p className="mtg-muted">Loading...</p>}
      {data && (
        <>
          <p className="mtg-muted" style={{ marginTop: 10 }}>
            Frequency: {data.task.frequency ? FREQUENCY_SHORT[data.task.frequency] : "not set"} · Last discussed:{" "}
            {fmtDay(data.task.lastDiscussedAt)} · Next: {fmtDay(data.task.nextDiscussionDate)}
          </p>

          <h4 style={{ margin: "14px 0 0" }}>Meetings</h4>
          {data.meetings.length === 0 ? (
            <p className="mtg-muted">Not on any saved agenda yet.</p>
          ) : (
            <ul className="mtg-timeline">
              {data.meetings.map((m) => (
                <li key={m.meetingDate}>
                  <strong>{fmtMonday(m.meetingDate)}</strong> — {OUTCOME_LABEL[m.outcome]}
                  {m.deferredTo && ` to ${fmtDay(m.deferredTo)}`}
                  {m.deferReason && <div className="mtg-muted">Reason: {m.deferReason}</div>}
                  {m.discussionNotes && <div className="mtg-note">{m.discussionNotes}</div>}
                  {m.decisions && <div className="mtg-note">Decision: {m.decisions}</div>}
                </li>
              ))}
            </ul>
          )}

          <h4 style={{ margin: "16px 0 0" }}>Scheduling changes</h4>
          {data.events.length === 0 ? (
            <p className="mtg-muted">No changes recorded.</p>
          ) : (
            <ul className="mtg-timeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>{" "}
                  <span className="mtg-muted">
                    {new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    {e.by ? ` · ${e.by}` : ""}
                  </span>
                  {(e.fromDate || e.toDate) && (
                    <div className="mtg-muted">
                      {e.fromDate ? fmtDay(e.fromDate) : "—"} → {e.toDate ? fmtDay(e.toDate) : "—"}
                    </div>
                  )}
                  {e.fromFrequency !== e.toFrequency && (e.fromFrequency || e.toFrequency) && (
                    <div className="mtg-muted">
                      Frequency: {e.fromFrequency ?? "none"} → {e.toFrequency ?? "none"}
                    </div>
                  )}
                  {e.reason && <div className="mtg-note">{e.reason}</div>}
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
