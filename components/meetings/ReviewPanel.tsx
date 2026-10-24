"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, type ApiTask } from "@/lib/api";
import {
  FREQUENCY_SHORT,
  PRIORITY_OPTIONS,
  applyReview,
  fmtDay,
  fmtMonday,
  proposeReview,
  type ReviewUpdate,
} from "@/lib/meetings";
import { Modal } from "./AgendaDialogs";

type Edit = {
  priority?: string;
  isBlocked?: boolean;
  flaggedForReview?: boolean;
  needsDiscussion?: boolean;
  latestReviewNote?: string;
};

type Proposal = {
  taskId: string;
  action: "BRING_FORWARD" | "KEEP" | "NONE";
  toDate: string | null;
  reason: string;
};

/**
 * Step 1 of the Monday workflow: go through the latest PDF and record what
 * changed per task. The system then proposes schedule changes, which are only
 * applied once confirmed.
 */
export default function ReviewPanel({
  meetingDate,
  reportUrl,
  reportName,
  onApplied,
}: {
  meetingDate: string;
  reportUrl: string | null;
  reportName: string | null;
  onApplied: () => void;
}) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=10000")
      .then((data) => setTasks(data.tasks.filter((t) => t.status !== "Completed")))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tasks"));
  }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tasks ?? [])
      .filter((t) => !onlyEdited || edits[t.id])
      .filter(
        (t) =>
          !term ||
          t.title.toLowerCase().includes(term) ||
          t.officer.designation.toLowerCase().includes(term)
      )
      .sort((a, b) => (a.nextDiscussionDate ?? "9999").localeCompare(b.nextDiscussionDate ?? "9999"));
  }, [tasks, search, onlyEdited, edits]);

  const editedIds = Object.keys(edits);

  const value = <K extends keyof Edit>(task: ApiTask, key: K, fallback: NonNullable<Edit[K]>) =>
    (edits[task.id]?.[key] ?? fallback) as NonNullable<Edit[K]>;

  const setEdit = (task: ApiTask, patch: Edit) => {
    setEdits((prev) => {
      const next: Edit = { ...prev[task.id], ...patch };
      const original: Edit = {
        priority: (task.priority ?? "NORMAL").toUpperCase(),
        isBlocked: Boolean(task.isBlocked),
        flaggedForReview: Boolean(task.flaggedForReview),
        needsDiscussion: false,
        latestReviewNote: task.latestReviewNote ?? "",
      };
      const isChanged = (Object.keys(next) as (keyof Edit)[]).some((k) => next[k] !== original[k]);
      const copy = { ...prev };
      if (isChanged) copy[task.id] = next;
      else delete copy[task.id];
      return copy;
    });
  };

  const updates = (): ReviewUpdate[] =>
    editedIds.map((taskId) => {
      const e = edits[taskId];
      return {
        taskId,
        ...(e.priority !== undefined && { priority: e.priority }),
        ...(e.isBlocked !== undefined && { isBlocked: e.isBlocked }),
        ...(e.flaggedForReview !== undefined && { flaggedForReview: e.flaggedForReview }),
        ...(e.needsDiscussion !== undefined && { needsDiscussion: e.needsDiscussion }),
        ...(e.latestReviewNote !== undefined && { latestReviewNote: e.latestReviewNote }),
      };
    });

  const handlePropose = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { proposals } = await proposeReview(meetingDate, updates());
      setProposals(proposals);
      setAccepted(Object.fromEntries(proposals.map((p) => [p.taskId, p.action === "BRING_FORWARD"])));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to prepare proposals");
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!proposals) return;
    setBusy(true);
    try {
      const reasons = Object.fromEntries(proposals.map((p) => [p.taskId, p.reason]));
      const { results } = await applyReview(
        meetingDate,
        updates().map((u) => ({
          ...u,
          bringForward: Boolean(accepted[u.taskId]),
          reason: reasons[u.taskId]?.replace(/^Bring forward: /, ""),
        }))
      );
      const failed = results.filter((r) => !r.ok);
      const moved = results.filter((r) => r.broughtForward).length;
      setResult(
        `${results.length - failed.length} task(s) updated, ${moved} brought forward to ${fmtMonday(meetingDate)}.` +
          (failed.length ? ` ${failed.length} failed: ${failed.map((f) => f.error).join("; ")}` : "")
      );
      setProposals(null);
      setEdits({});
      const data = await apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=10000");
      setTasks(data.tasks.filter((t) => t.status !== "Completed"));
      onApplied();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to apply review changes");
    } finally {
      setBusy(false);
    }
  };

  const titleOf = (taskId: string) => tasks?.find((t) => t.id === taskId)?.title ?? taskId;

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>Review the Monday PDF</h2>
          <div className="mtg-muted">
            Record what changed for each task. Nothing changes the schedule until you review and confirm the
            proposals.
            {reportUrl && (
              <>
                {" "}
                Report:{" "}
                <a href={reportUrl} target="_blank" rel="noreferrer">
                  {reportName || "open PDF"}
                </a>
              </>
            )}
          </div>
        </div>
        <button type="button" className="mtg-btn" disabled={!editedIds.length || busy} onClick={handlePropose}>
          Review {editedIds.length || ""} change{editedIds.length === 1 ? "" : "s"}
        </button>
      </div>

      {result && <div className="mtg-banner is-info">{result}</div>}
      {error && <div className="mtg-banner is-error">{error}</div>}

      <div className="mtg-toolbar">
        <input
          type="search"
          placeholder="Search task or designation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="mtg-check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={onlyEdited} onChange={(e) => setOnlyEdited(e.target.checked)} />
          <span>Show only changed rows</span>
        </label>
      </div>

      {!tasks && !error && <p className="mtg-muted">Loading tasks...</p>}
      {tasks && (
        <div className="mtg-table-wrap">
          <table className="mtg-table mtg-review-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Next discussion</th>
                <th>Priority</th>
                <th>Blocked</th>
                <th>Flag</th>
                <th>Discuss this Monday</th>
                <th>Latest PDF update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={edits[t.id] ? "is-edited" : ""}>
                  <td>
                    <div className="mtg-task-title">{t.title}</div>
                    <div className="mtg-muted">
                      {t.officer.designation} ·{" "}
                      {t.discussionFrequency ? FREQUENCY_SHORT[t.discussionFrequency] : "No frequency"}
                      {t.status === "Overdue" && " · Overdue"}
                    </div>
                  </td>
                  <td>{fmtDay(t.nextDiscussionDate)}</td>
                  <td>
                    <select
                      aria-label={`Priority for ${t.title}`}
                      value={value(t, "priority", (t.priority ?? "NORMAL").toUpperCase())}
                      onChange={(e) => setEdit(t, { priority: e.target.value })}
                    >
                      {PRIORITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Blocked: ${t.title}`}
                      checked={value(t, "isBlocked", Boolean(t.isBlocked))}
                      onChange={(e) => setEdit(t, { isBlocked: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Flag for review: ${t.title}`}
                      checked={value(t, "flaggedForReview", Boolean(t.flaggedForReview))}
                      onChange={(e) => setEdit(t, { flaggedForReview: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Needs discussion this Monday: ${t.title}`}
                      checked={value(t, "needsDiscussion", false)}
                      onChange={(e) => setEdit(t, { needsDiscussion: e.target.checked })}
                    />
                  </td>
                  <td>
                    <textarea
                      rows={2}
                      aria-label={`Latest PDF update for ${t.title}`}
                      value={value(t, "latestReviewNote", t.latestReviewNote ?? "")}
                      onChange={(e) => setEdit(t, { latestReviewNote: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="mtg-empty">
                    No tasks match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {proposals && (
        <Modal
          title="Confirm review changes"
          subtitle={`For the meeting on ${fmtMonday(meetingDate)}`}
          wide
          onClose={() => setProposals(null)}
        >
          <p className="mtg-muted" style={{ marginTop: 10 }}>
            Priority, blocked, flag and note changes are saved for every row. Tick the tasks that should be brought
            forward to this meeting; their regular frequency is not changed.
          </p>
          <div className="mtg-table-wrap">
            <table className="mtg-table">
              <thead>
                <tr>
                  <th>Bring forward</th>
                  <th>Task</th>
                  <th>Proposal</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.taskId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Bring forward ${titleOf(p.taskId)}`}
                        disabled={p.action === "NONE" || (p.action === "KEEP" && p.reason.startsWith("Already due"))}
                        checked={Boolean(accepted[p.taskId])}
                        onChange={(e) => setAccepted((prev) => ({ ...prev, [p.taskId]: e.target.checked }))}
                      />
                    </td>
                    <td className="mtg-task-title">{titleOf(p.taskId)}</td>
                    <td>
                      <span
                        className={`mtg-chip ${p.action === "BRING_FORWARD" ? "is-urgent" : "is-info"}`}
                      >
                        {p.action === "BRING_FORWARD" ? "Bring forward" : p.action === "KEEP" ? "Keep" : "No change"}
                      </span>
                      <div className="mtg-reason">{p.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mtg-modal-actions">
            <button type="button" className="mtg-btn-ghost" onClick={() => setProposals(null)} disabled={busy}>
              Back
            </button>
            <button type="button" className="mtg-btn" onClick={handleApply} disabled={busy}>
              {busy ? "Saving..." : "Confirm and save"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
