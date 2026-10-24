"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, type ApiTask } from "@/lib/api";
import {
  FREQUENCY_SHORT,
  ORDINAL_OPTIONS,
  addAgendaItem,
  addDaysISO,
  bringForward,
  completeTask,
  deferTask,
  downloadAgenda,
  fmtDay,
  fmtMonday,
  getAgenda,
  initializeSchedules,
  isMondayISO,
  mondayOnOrAfterISO,
  recordOutcome,
  removeAgendaItem,
  saveAgenda,
  setMeetingStatus,
  updateMeeting,
  updateSchedule,
  type AgendaItem,
  type AgendaView,
  type BriefTask,
  type Frequency,
  type MeetingStatus,
} from "@/lib/meetings";
import {
  BringForwardDialog,
  DeferDialog,
  DiscussDialog,
  FrequencyDialog,
  HistoryDialog,
} from "./AgendaDialogs";
import ReviewPanel from "./ReviewPanel";

type Tab = "agenda" | "review" | "unscheduled";

type Dialog =
  | { kind: "discuss"; item: AgendaItem }
  | { kind: "defer"; item: AgendaItem; suggestedDate?: string; suggestedReason?: string }
  | { kind: "frequency"; item: AgendaItem }
  | { kind: "history"; taskId: string; title: string }
  | { kind: "bring"; taskId: string; title: string; next: string | null; reason?: string };

const STATUS_CHIP: Record<MeetingStatus | "PREVIEW", { label: string; className: string }> = {
  PREVIEW: { label: "Not saved", className: "" },
  DRAFT: { label: "Draft", className: "is-info" },
  FINALIZED: { label: "Finalized", className: "is-ok" },
  CLOSED: { label: "Closed", className: "" },
};

const OUTCOME_CHIP: Record<AgendaItem["outcome"], { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "" },
  DISCUSSED: { label: "Discussed", className: "is-ok" },
  NOT_DISCUSSED: { label: "Not discussed", className: "is-warn" },
  DEFERRED: { label: "Deferred", className: "is-info" },
};

const PRIORITY_CHIP: Record<string, string> = { URGENT: "is-urgent", HIGH: "is-warn", NORMAL: "", LOW: "" };

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function initialDate(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("date");
  return value && isMondayISO(value) ? value : undefined;
}

export default function MeetingAgenda() {
  const [date, setDate] = useState<string | undefined>(initialDate);
  const [view, setView] = useState<AgendaView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agenda");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");

  const showView = useCallback((data: AgendaView) => {
    setView(data);
    setDate(data.meetingDate);
    setLimitDraft(String(data.load.limitMinutes));
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("date", data.meetingDate);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      try {
        showView(await getAgenda(target));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load the agenda");
      } finally {
        setLoading(false);
      }
    },
    [showView]
  );

  // First load: the date from the URL, or the upcoming Monday.
  useEffect(() => {
    let cancelled = false;
    getAgenda(initialDate())
      .then((data) => !cancelled && showView(data))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load the agenda"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [showView]);

  const meetingDate = view?.meetingDate ?? date ?? "";
  const status: MeetingStatus | "PREVIEW" = view?.meeting?.status ?? "PREVIEW";
  const isClosed = status === "CLOSED";
  const isFinal = status === "FINALIZED" || isClosed;

  /** Run an action, then show the agenda the server returns (or reload it). */
  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      const result = await action();
      if (result && typeof result === "object" && "sections" in result) {
        showView(result as AgendaView);
      } else {
        await load(meetingDate);
      }
      setDialog(null);
      after?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const goTo = (value: string) => {
    if (!value) return;
    load(isMondayISO(value) ? value : mondayOnOrAfterISO(value));
  };

  const allItems = useMemo(() => view?.sections.flatMap((s) => s.items) ?? [], [view]);
  const itemById = useMemo(() => new Map(allItems.map((i) => [i.taskId, i])), [allItems]);

  const handleLimit = () => {
    const minutes = parseInt(limitDraft, 10);
    if (!view || !Number.isFinite(minutes) || minutes === view.load.limitMinutes) return;
    if (minutes < 10 || minutes > 600) {
      alert("Meeting time must be between 10 and 600 minutes.");
      setLimitDraft(String(view.load.limitMinutes));
      return;
    }
    run(() => updateMeeting(meetingDate, { durationLimitMinutes: minutes }));
  };

  const handleReportUpload = async (file: File | null) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    await run(async () => {
      const uploaded = await apiFetch<{ attachmentUrl: string; attachmentName: string }>("/api/tasks/upload", {
        method: "POST",
        body: form,
      });
      return updateMeeting(meetingDate, { reportUrl: uploaded.attachmentUrl, reportName: uploaded.attachmentName });
    });
  };

  const deferAllSuggested = () => {
    if (!view?.recommendations.length) return;
    const names = view.recommendations.map((r) => `• ${itemById.get(r.taskId)?.title ?? r.taskId}`).join("\n");
    if (!window.confirm(`Defer these ${view.recommendations.length} task(s) to ${fmtDay(view.recommendations[0].suggestedDate)}?\n\n${names}`)) {
      return;
    }
    run(async () => {
      for (const r of view.recommendations) {
        await deferTask(r.taskId, { toDate: r.suggestedDate, reason: r.reason, meetingDate });
      }
    });
  };

  if (loading && !view) return <p className="table-status">Loading agenda...</p>;
  if (error && !view) return <p className="table-error">{error}</p>;
  if (!view) return null;

  const { load: meetingLoad } = view;
  const fill = Math.min(100, (meetingLoad.totalMinutes / Math.max(1, meetingLoad.limitMinutes)) * 100);

  return (
    <div className="meeting-page">
      <div className="mtg-header">
        <div>
          <h1 className="page-title">Monday Meeting</h1>
          <p className="mtg-subtitle">
            {fmtMonday(meetingDate)}{" "}
            <span className={`mtg-chip ${STATUS_CHIP[status].className}`}>{STATUS_CHIP[status].label}</span>
            {meetingDate === view.upcomingMonday && <span className="mtg-chip is-info">Upcoming</span>}
          </p>
        </div>
        <div className="mtg-date-picker">
          <button type="button" className="mtg-btn-ghost" onClick={() => goTo(addDaysISO(meetingDate, -7))} disabled={loading}>
            ‹ Previous
          </button>
          <label htmlFor="mtg-date">Meeting date</label>
          <input id="mtg-date" type="date" value={meetingDate} onChange={(e) => goTo(e.target.value)} />
          <button type="button" className="mtg-btn-ghost" onClick={() => goTo(addDaysISO(meetingDate, 7))} disabled={loading}>
            Next ›
          </button>
          {meetingDate !== view.upcomingMonday && (
            <button type="button" className="mtg-btn-ghost" onClick={() => goTo(view.upcomingMonday)}>
              Upcoming Monday
            </button>
          )}
        </div>
      </div>

      {error && <div className="mtg-banner is-error">{error}</div>}

      {/* Workload summary */}
      <div className="mtg-card">
        <div className="mtg-summary">
          <div className="mtg-stat">
            <span className="mtg-stat-label">Tasks</span>
            <span className="mtg-stat-value">{meetingLoad.taskCount}</span>
          </div>
          <div className="mtg-stat">
            <span className="mtg-stat-label">Estimated time</span>
            <span className="mtg-stat-value">{meetingLoad.totalMinutes} min</span>
          </div>
          <div className="mtg-stat">
            <span className="mtg-stat-label">Available time</span>
            <span className="mtg-stat-value">
              <input
                type="number"
                min={10}
                max={600}
                aria-label="Available meeting time in minutes"
                value={limitDraft}
                disabled={busy || isClosed}
                onChange={(e) => setLimitDraft(e.target.value)}
                onBlur={handleLimit}
                onKeyDown={(e) => e.key === "Enter" && handleLimit()}
              />{" "}
              min
            </span>
          </div>
          <div className="mtg-meter">
            <span className="mtg-stat-label">
              {meetingLoad.overloaded ? `Over the limit by ${meetingLoad.overBy} min` : "Within the meeting time"}
            </span>
            <div className="mtg-meter-track" role="presentation">
              <div className={`mtg-meter-fill ${meetingLoad.overloaded ? "is-over" : ""}`} style={{ width: `${fill}%` }} />
            </div>
          </div>
        </div>

        <div className="mtg-actions">
          {(status === "PREVIEW" || status === "DRAFT") && (
            <button
              type="button"
              className="mtg-btn"
              disabled={busy || (status === "DRAFT" && view.unsavedChanges === 0)}
              onClick={() => run(() => saveAgenda(meetingDate))}
            >
              {status === "PREVIEW" ? "Save agenda" : view.unsavedChanges ? `Refresh agenda (${view.unsavedChanges})` : "Agenda saved"}
            </button>
          )}
          {(status === "PREVIEW" || status === "DRAFT") && (
            <button
              type="button"
              className="mtg-btn"
              disabled={busy}
              onClick={() =>
                window.confirm(
                  `Finalize the agenda for ${fmtMonday(meetingDate)}?\n\n${meetingLoad.taskCount} task(s), ${meetingLoad.totalMinutes} of ${meetingLoad.limitMinutes} min.` +
                    (meetingLoad.overloaded ? `\n\nWarning: it is ${meetingLoad.overBy} min over the meeting time.` : "") +
                    "\n\nThe agenda is frozen until you reopen it."
                ) && run(() => setMeetingStatus(meetingDate, "FINALIZED"))
              }
            >
              Finalize agenda
            </button>
          )}
          {status === "FINALIZED" && (
            <button
              type="button"
              className="mtg-btn"
              disabled={busy}
              onClick={() =>
                window.confirm(
                  "Close this meeting?\n\nTasks with no recorded outcome are marked 'not discussed' and carry over to the next meeting."
                ) && run(() => setMeetingStatus(meetingDate, "CLOSED"))
              }
            >
              Close meeting
            </button>
          )}
          {isFinal && (
            <button
              type="button"
              className="mtg-btn-ghost"
              disabled={busy}
              onClick={() =>
                window.confirm("Reopen this agenda for editing? It will be refreshed from the current schedule.") &&
                run(() => setMeetingStatus(meetingDate, "DRAFT"))
              }
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            className="mtg-btn-ghost"
            disabled={busy}
            onClick={() => run(() => downloadAgenda(meetingDate, "xlsx"))}
          >
            Export Excel
          </button>
          <button
            type="button"
            className="mtg-btn-ghost"
            disabled={busy}
            onClick={() => run(() => downloadAgenda(meetingDate, "csv"))}
          >
            CSV
          </button>
          <label className="mtg-btn-ghost" style={{ display: "inline-flex", alignItems: "center", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            {view.meeting?.reportUrl ? "Replace Monday PDF" : "Attach Monday PDF"}
            <input
              type="file"
              accept=".pdf"
              hidden
              disabled={busy}
              onChange={(e) => {
                handleReportUpload(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {view.meeting?.reportUrl && (
            <a className="mtg-btn-ghost" href={view.meeting.reportUrl} target="_blank" rel="noreferrer" style={{ alignSelf: "center" }}>
              Open {view.meeting.reportName || "PDF"}
            </a>
          )}
        </div>
      </div>

      <div className="mtg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "agenda"} className={`mtg-tab ${tab === "agenda" ? "is-active" : ""}`} onClick={() => setTab("agenda")}>
          Agenda ({meetingLoad.taskCount})
        </button>
        <button type="button" role="tab" aria-selected={tab === "review"} className={`mtg-tab ${tab === "review" ? "is-active" : ""}`} onClick={() => setTab("review")}>
          PDF review
        </button>
        <button type="button" role="tab" aria-selected={tab === "unscheduled"} className={`mtg-tab ${tab === "unscheduled" ? "is-active" : ""}`} onClick={() => setTab("unscheduled")}>
          Without frequency ({view.unscheduled.length})
        </button>
      </div>

      {tab === "review" && (
        <ReviewPanel
          meetingDate={meetingDate}
          reportUrl={view.meeting?.reportUrl ?? null}
          reportName={view.meeting?.reportName ?? null}
          onApplied={() => load(meetingDate)}
        />
      )}

      {tab === "unscheduled" && (
        <UnscheduledPanel tasks={view.unscheduled} busy={busy} onAssign={(ids, f, o) => run(() => initializeSchedules(ids, f, o))} />
      )}

      {tab === "agenda" && (
        <>
          {status === "PREVIEW" && (
            <div className="mtg-banner is-info">
              This is a preview built from the current schedule. Save the agenda to edit it, or record outcomes
              directly — the first outcome saves it.
            </div>
          )}
          {status === "DRAFT" && view.unsavedChanges > 0 && (
            <div className="mtg-banner is-info">
              The schedule changed since this agenda was saved ({view.unsavedChanges} difference
              {view.unsavedChanges === 1 ? "" : "s"}). The list below is current; refresh to save it.
            </div>
          )}
          {view.unscheduled.length > 0 && (
            <div className="mtg-banner is-warn">
              {view.unscheduled.length} active task(s) have no discussion frequency and are not on any agenda.
              <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => setTab("unscheduled")}>
                Assign frequencies
              </button>
            </div>
          )}

          {view.recommendations.length > 0 && (
            <div className="mtg-card">
              <div className="mtg-card-head">
                <div>
                  <h2>Agenda is {meetingLoad.overBy} min over</h2>
                  <div className="mtg-muted">
                    These non-urgent tasks could wait a week. Nothing is moved until you confirm.
                  </div>
                </div>
                <button type="button" className="mtg-btn" onClick={deferAllSuggested} disabled={busy}>
                  Defer all suggested
                </button>
              </div>
              <div className="mtg-table-wrap">
                <table className="mtg-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th className="num">Min</th>
                      <th>Suggested date</th>
                      <th>Why</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {view.recommendations.map((r) => {
                      const item = itemById.get(r.taskId);
                      return (
                        <tr key={r.taskId}>
                          <td className="mtg-task-title">{item?.title ?? r.taskId}</td>
                          <td className="num">{r.minutes}</td>
                          <td>{fmtDay(r.suggestedDate)}</td>
                          <td className="mtg-muted">{r.reason}</td>
                          <td>
                            {item && (
                              <button
                                type="button"
                                className="mtg-btn-ghost mtg-btn-sm"
                                onClick={() => setDialog({ kind: "defer", item, suggestedDate: r.suggestedDate, suggestedReason: r.reason })}
                              >
                                Defer…
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view.sections.map((section) => (
            <div className="mtg-card" key={section.key}>
              <div className="mtg-card-head">
                <h2>
                  {section.label}{" "}
                  <span className="mtg-muted">
                    · {section.items.length} task{section.items.length === 1 ? "" : "s"} ·{" "}
                    {section.items.filter((i) => i.outcome !== "DEFERRED").reduce((s, i) => s + i.estimatedMinutes, 0)} min
                  </span>
                </h2>
              </div>
              {section.items.length === 0 ? (
                <div className="mtg-empty">Nothing in this section.</div>
              ) : (
                <div className="mtg-table-wrap">
                  <table className="mtg-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Frequency</th>
                        <th>Priority</th>
                        <th>Last discussed</th>
                        <th>Next discussion</th>
                        <th className="num">Min</th>
                        <th>Outcome</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.items.map((item) => (
                        <AgendaRow
                          key={item.taskId}
                          item={item}
                          meetingDate={meetingDate}
                          closed={isClosed}
                          busy={busy}
                          onDialog={setDialog}
                          onOutcome={(outcome) => run(() => recordOutcome(meetingDate, item.taskId, { outcome }))}
                          onComplete={() =>
                            window.confirm(`Mark "${item.title}" as completed? It will not appear on future agendas.`) &&
                            run(() => completeTask(item.taskId))
                          }
                          onRemove={() =>
                            window.confirm(`Remove "${item.title}" from this agenda?`) &&
                            run(() => removeAgendaItem(meetingDate, item.taskId))
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {view.flagged.length > 0 && (
            <div className="mtg-card">
              <div className="mtg-card-head">
                <div>
                  <h2>Flagged in review, not on this agenda</h2>
                  <div className="mtg-muted">Decide whether each one needs discussion now or can wait for its date.</div>
                </div>
              </div>
              <BriefTable
                tasks={view.flagged}
                actionLabel="Bring forward…"
                disabled={busy || isClosed}
                onAction={(t) => setDialog({ kind: "bring", taskId: t.taskId, title: t.title, next: t.nextDiscussionDate })}
              />
            </div>
          )}

          {!isClosed && (
            <AddTaskCard
              meetingDate={meetingDate}
              onAgenda={itemById}
              busy={busy}
              onBringForward={(t) =>
                setDialog({ kind: "bring", taskId: t.id, title: t.title, next: t.nextDiscussionDate ?? null })
              }
              onAddOnce={(t, reason) => run(() => addAgendaItem(meetingDate, t.id, reason))}
            />
          )}
        </>
      )}

      {dialog?.kind === "discuss" && (
        <DiscussDialog
          item={dialog.item}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(discussionNotes, decisions) =>
            run(() => recordOutcome(meetingDate, dialog.item.taskId, { outcome: "DISCUSSED", discussionNotes, decisions }))
          }
        />
      )}
      {dialog?.kind === "defer" && (
        <DeferDialog
          item={dialog.item}
          meetingDate={meetingDate}
          suggestedDate={dialog.suggestedDate}
          suggestedReason={dialog.suggestedReason}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(toDate, reason, confirmed) =>
            run(() => deferTask(dialog.item.taskId, { toDate, reason, meetingDate, confirmed }))
          }
        />
      )}
      {dialog?.kind === "frequency" && (
        <FrequencyDialog
          item={dialog.item}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(discussionFrequency, monthlyMondayOrdinal, recalculate, reason) =>
            run(() =>
              updateSchedule(dialog.item.taskId, {
                discussionFrequency,
                monthlyMondayOrdinal,
                recalculate,
                reason: reason || null,
              })
            )
          }
        />
      )}
      {dialog?.kind === "bring" && (
        <BringForwardDialog
          title={dialog.title}
          meetingDate={meetingDate}
          nextDiscussionDate={dialog.next}
          defaultReason={dialog.reason}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => run(() => bringForward(dialog.taskId, { toDate: meetingDate, reason }))}
        />
      )}
      {dialog?.kind === "history" && (
        <HistoryDialog taskId={dialog.taskId} title={dialog.title} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function AgendaRow({
  item,
  meetingDate,
  closed,
  busy,
  onDialog,
  onOutcome,
  onComplete,
  onRemove,
}: {
  item: AgendaItem;
  meetingDate: string;
  closed: boolean;
  busy: boolean;
  onDialog: (dialog: Dialog) => void;
  onOutcome: (outcome: "PENDING" | "DISCUSSED" | "NOT_DISCUSSED") => void;
  onComplete: () => void;
  onRemove: () => void;
}) {
  const outcome = OUTCOME_CHIP[item.outcome];
  const done = item.outcome !== "PENDING";
  const undo = () =>
    window.confirm(
      item.outcome === "DISCUSSED"
        ? `Undo "discussed" for "${item.title}"? Its previous schedule is restored.`
        : `Set "${item.title}" back to pending?`
    ) && onOutcome("PENDING");

  return (
    <tr className={done ? "is-done" : ""}>
      <td>
        <div className="mtg-task-title">{item.title}</div>
        <div className="mtg-task-meta">
          <span className="mtg-muted">{item.officer}</span>
          {item.isBlocked && <span className="mtg-chip is-urgent">Blocked</span>}
          {item.flaggedForReview && <span className="mtg-chip is-warn">Flagged</span>}
          {item.inclusion === "BROUGHT_FORWARD" && <span className="mtg-chip is-urgent">Brought forward</span>}
          {item.inclusion === "MANUAL" && <span className="mtg-chip is-info">Added</span>}
          {item.scheduleState === "DEFERRED" && item.inclusion !== "BROUGHT_FORWARD" && (
            <span className="mtg-chip is-info">Deferred here</span>
          )}
        </div>
        <div className="mtg-reason">{item.reason}</div>
        {item.latestReviewNote && <div className="mtg-note">PDF: {item.latestReviewNote}</div>}
        {item.discussionNotes && <div className="mtg-note">Notes: {item.discussionNotes}</div>}
        {item.decisions && <div className="mtg-note">Decision: {item.decisions}</div>}
        {item.outcome === "DEFERRED" && (
          <div className="mtg-note">
            Deferred to {fmtDay(item.deferredTo)}
            {item.deferReason ? `: ${item.deferReason}` : ""}
          </div>
        )}
      </td>
      <td>
        <span className={`mtg-chip ${item.status === "Overdue" ? "is-urgent" : item.status === "Completed" ? "is-ok" : ""}`}>
          {item.status}
        </span>
        <div className="mtg-muted">Due {fmtDay(item.dueDate)}</div>
      </td>
      <td>
        {item.frequency ? FREQUENCY_SHORT[item.frequency] : "—"}
        {item.frequency === "NM" && item.monthlyMondayOrdinal && item.monthlyMondayOrdinal !== 1 && (
          <div className="mtg-muted">
            {ORDINAL_OPTIONS.find((o) => o.value === item.monthlyMondayOrdinal)?.label}
          </div>
        )}
      </td>
      <td>
        <span className={`mtg-chip ${PRIORITY_CHIP[item.priority] ?? ""}`}>{titleCase(item.priority)}</span>
      </td>
      <td>{fmtDay(item.lastDiscussedAt)}</td>
      <td>
        {fmtDay(item.nextDiscussionDate)}
        {item.originalDiscussionDate && item.originalDiscussionDate !== item.nextDiscussionDate && (
          <div className="mtg-muted">was {fmtDay(item.originalDiscussionDate)}</div>
        )}
      </td>
      <td className="num">{item.estimatedMinutes}</td>
      <td>
        <span className={`mtg-chip ${outcome.className}`}>{outcome.label}</span>
      </td>
      <td>
        <div className="mtg-row-actions">
          {item.outcome === "PENDING" && (
            <>
              <button type="button" className="mtg-btn mtg-btn-sm" disabled={busy} onClick={() => onDialog({ kind: "discuss", item })}>
                Discussed…
              </button>
              <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onOutcome("NOT_DISCUSSED")}>
                Not discussed
              </button>
              {!closed && (
                <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onDialog({ kind: "defer", item })}>
                  Defer…
                </button>
              )}
            </>
          )}
          {item.outcome === "DISCUSSED" && (
            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onDialog({ kind: "discuss", item })}>
              Notes…
            </button>
          )}
          {item.outcome === "NOT_DISCUSSED" && (
            <button type="button" className="mtg-btn mtg-btn-sm" disabled={busy} onClick={() => onDialog({ kind: "discuss", item })}>
              Discussed…
            </button>
          )}
          {(item.outcome === "DISCUSSED" || item.outcome === "NOT_DISCUSSED") && (
            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={undo}>
              Undo
            </button>
          )}
          {item.outcome !== "DEFERRED" && (
            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onDialog({ kind: "frequency", item })}>
              Frequency…
            </button>
          )}
          {item.status !== "Completed" && (
            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={onComplete}>
              Complete
            </button>
          )}
          <button
            type="button"
            className="mtg-btn-ghost mtg-btn-sm"
            onClick={() => onDialog({ kind: "history", taskId: item.taskId, title: item.title })}
          >
            History
          </button>
          {item.inclusion === "MANUAL" && item.outcome === "PENDING" && item.stored && meetingDate && (
            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function BriefTable({
  tasks,
  actionLabel,
  disabled,
  onAction,
  selectable,
  selected,
  onToggle,
}: {
  tasks: BriefTask[];
  actionLabel?: string;
  disabled?: boolean;
  onAction?: (task: BriefTask) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (taskId: string, checked: boolean) => void;
}) {
  return (
    <div className="mtg-table-wrap">
      <table className="mtg-table">
        <thead>
          <tr>
            {selectable && <th />}
            <th>Task</th>
            <th>Status</th>
            <th>Due</th>
            <th>Priority</th>
            <th>Next discussion</th>
            {onAction && <th />}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.taskId}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.title}`}
                    checked={selected?.has(t.taskId) ?? false}
                    onChange={(e) => onToggle?.(t.taskId, e.target.checked)}
                  />
                </td>
              )}
              <td>
                <div className="mtg-task-title">{t.title}</div>
                <div className="mtg-muted">{t.officer}</div>
                {t.latestReviewNote && <div className="mtg-note">PDF: {t.latestReviewNote}</div>}
              </td>
              <td>
                <span className={`mtg-chip ${t.status === "Overdue" ? "is-urgent" : ""}`}>{t.status}</span>
              </td>
              <td>{fmtDay(t.dueDate)}</td>
              <td>
                <span className={`mtg-chip ${PRIORITY_CHIP[t.priority] ?? ""}`}>{titleCase(t.priority)}</span>
              </td>
              <td>{fmtDay(t.nextDiscussionDate)}</td>
              {onAction && (
                <td>
                  <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={disabled} onClick={() => onAction(t)}>
                    {actionLabel}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Existing tasks without a frequency: assign one in bulk (nothing is scheduled until you do). */
function UnscheduledPanel({
  tasks,
  busy,
  onAssign,
}: {
  tasks: BriefTask[];
  busy: boolean;
  onAssign: (taskIds: string[], frequency: Frequency, ordinal: number | null) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [frequency, setFrequency] = useState<Frequency>("M");
  const [ordinal, setOrdinal] = useState(1);

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const assign = () => {
    const label = { M: "Weekly (M)", F: "Fortnightly (F)", NM: "Next Month (NM)" }[frequency];
    if (
      !window.confirm(
        `Set ${selected.size} task(s) to ${label}?\n\n` +
          (frequency === "F"
            ? "They are spread over the next two Mondays so they do not all land on one meeting. "
            : "") +
          "Urgent, high-priority, blocked and near-deadline tasks are scheduled for the next meeting."
      )
    ) {
      return;
    }
    onAssign([...selected], frequency, frequency === "NM" ? ordinal : null);
    setSelected(new Set());
  };

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>Tasks without a discussion frequency</h2>
          <div className="mtg-muted">
            These tasks are not on any agenda. Nothing is assigned automatically: choose a frequency to start
            scheduling them.
          </div>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="mtg-empty">Every active task has a discussion frequency.</div>
      ) : (
        <>
          <div className="mtg-toolbar">
            <button
              type="button"
              className="mtg-btn-ghost mtg-btn-sm"
              onClick={() => setSelected(selected.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.taskId)))}
            >
              {selected.size === tasks.length ? "Clear selection" : `Select all ${tasks.length}`}
            </button>
            <select aria-label="Frequency to assign" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="M">M — Weekly</option>
              <option value="F">F — Fortnightly</option>
              <option value="NM">NM — Next Month</option>
            </select>
            {frequency === "NM" && (
              <select aria-label="Monthly discussion day" value={ordinal} onChange={(e) => setOrdinal(Number(e.target.value))}>
                {ORDINAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="mtg-btn" disabled={busy || selected.size === 0} onClick={assign}>
              Assign to {selected.size} task{selected.size === 1 ? "" : "s"}
            </button>
          </div>
          <BriefTable tasks={tasks} selectable selected={selected} onToggle={toggle} />
        </>
      )}
    </div>
  );
}

/** Find any active task and bring it forward (or add it once) to this meeting. */
function AddTaskCard({
  meetingDate,
  onAgenda,
  busy,
  onBringForward,
  onAddOnce,
}: {
  meetingDate: string;
  onAgenda: Map<string, AgendaItem>;
  busy: boolean;
  onBringForward: (task: ApiTask) => void;
  onAddOnce: (task: ApiTask, reason: string) => void;
}) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || tasks) return;
    apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=10000")
      .then((data) => setTasks(data.tasks.filter((t) => t.status !== "Completed")))
      .catch(() => setTasks([]));
  }, [open, tasks]);

  const term = search.trim().toLowerCase();
  const matches = (tasks ?? [])
    .filter((t) => !onAgenda.has(t.id))
    .filter((t) => !term || t.title.toLowerCase().includes(term) || t.officer.designation.toLowerCase().includes(term))
    .slice(0, 20);

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>Add a task to this meeting</h2>
          <div className="mtg-muted">
            Bring forward changes its next discussion date; add once keeps its regular schedule.
          </div>
        </div>
        {!open && (
          <button type="button" className="mtg-btn-ghost" onClick={() => setOpen(true)}>
            Find a task
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="mtg-toolbar">
            <input
              type="search"
              placeholder="Search task or designation"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!tasks && <p className="mtg-muted">Loading tasks...</p>}
          {tasks && matches.length === 0 && <div className="mtg-empty">No tasks match.</div>}
          {matches.length > 0 && (
            <div className="mtg-table-wrap">
              <table className="mtg-table">
                <tbody>
                  {matches.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="mtg-task-title">{t.title}</div>
                        <div className="mtg-muted">
                          {t.officer.designation} · {t.discussionFrequency ? FREQUENCY_SHORT[t.discussionFrequency] : "No frequency"} ·
                          next {fmtDay(t.nextDiscussionDate)}
                        </div>
                      </td>
                      <td>
                        <div className="mtg-row-actions">
                          <button
                            type="button"
                            className="mtg-btn mtg-btn-sm"
                            disabled={busy || (!!t.nextDiscussionDate && t.nextDiscussionDate <= meetingDate)}
                            onClick={() => onBringForward(t)}
                          >
                            Bring forward…
                          </button>
                          <button
                            type="button"
                            className="mtg-btn-ghost mtg-btn-sm"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt(`Why should "${t.title}" be discussed at this meeting?`);
                              if (reason?.trim()) onAddOnce(t, reason.trim());
                            }}
                          >
                            Add once
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
