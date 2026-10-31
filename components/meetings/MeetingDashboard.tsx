"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CYCLES,
  CYCLE_HINT,
  CYCLE_LABEL,
  FIFTH_MONDAY_NOTE,
  ORDINAL_OPTIONS,
  REVIEW_CODE,
  STATUS_FILTER_OPTIONS,
  addDaysISO,
  downloadAgenda,
  downloadRegisterPdf,
  finalizeAgenda,
  reopenAgenda,
  fmtDay,
  fmtMonday,
  fortnightStartOptions,
  getAgenda,
  getRegister,
  isMondayISO,
  markDiscussed,
  matchesStatus,
  mondayOnOrAfterISO,
  rescheduleTask,
  setCycle,
  setCycleBulk,
  type AgendaResponse,
  type AgendaTask,
  type Cycle,
  type CycleOptions,
  type RegisterResponse,
  type RegisterTask,
  type StatusFilter,
} from "@/lib/meetings";
import { HistoryDialog, RescheduleDialog } from "./MeetingDialogs";

type View = Cycle | "UNASSIGNED" | "AGENDA";
type SortKey = "taskNumber" | "title" | "nextDiscussionDate" | "status";

const STATUS_CLASS: Record<string, string> = { Pending: "is-warn", Overdue: "is-urgent", Completed: "is-ok" };
const STATUS_ORDER: Record<string, number> = { Overdue: 0, Pending: 1, Completed: 2 };

function initialView(): View {
  if (typeof window === "undefined") return "WEEKLY";
  const v = new URLSearchParams(window.location.search).get("view")?.toUpperCase();
  return v && ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "UNASSIGNED", "AGENDA"].includes(v) ? (v as View) : "WEEKLY";
}

function codeLabel(cycle: Cycle): string {
  return `${REVIEW_CODE[cycle]} (${CYCLE_LABEL[cycle]})`;
}

export default function MeetingDashboard() {
  const [view, setView] = useState<View>(initialView);
  const [register, setRegister] = useState<RegisterResponse | null>(null);
  const [agenda, setAgenda] = useState<AgendaResponse | null>(null);
  const [agendaDate, setAgendaDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "reschedule"; task: RegisterTask; fromDate: string | null } | { kind: "history"; task: RegisterTask } | null
  >(null);

  const loadRegister = useCallback(async () => {
    try {
      setRegister(await getRegister());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    }
  }, []);

  const loadAgenda = useCallback(async (date?: string) => {
    try {
      const data = await getAgenda(date);
      setAgenda(data);
      setAgendaDate(data.meetingDate);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the agenda");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRegister(), getAgenda()])
      .then(([r, a]) => {
        if (cancelled) return;
        setRegister(r);
        setAgenda(a);
        setAgendaDate(a.meetingDate);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  const selectView = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next.toLowerCase());
    window.history.replaceState(null, "", url.toString());
  };

  /** Run a change, then reload both views so everything reflects the database. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await Promise.all([loadRegister(), loadAgenda(agendaDate)]);
      setDialog(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  /** Change a task's review frequency (and, for FT / M, its allocation). */
  const changeSchedule = (task: RegisterTask, cycle: Cycle | null, options: CycleOptions = {}) => {
    const from = task.cycle ? codeLabel(task.cycle) : "not assigned";
    const to = cycle ? codeLabel(cycle) : "not assigned";
    if (
      task.cycle &&
      task.cycle !== cycle &&
      !window.confirm(`Change #${task.taskNumber} from ${from} to ${to}?\n\nIts future Monday dates follow the new frequency. Past discussions are kept.`)
    ) {
      return;
    }
    run(() => setCycle(task.id, cycle, options));
  };

  if (!register) {
    return error ? <p className="table-error">{error}</p> : <p className="table-status">Loading...</p>;
  }

  const agendaCount = agenda?.items.length ?? 0;

  return (
    <div className="meeting-page">
      <div className="mtg-header">
        <div>
          <h1 className="page-title">Monday Meeting</h1>
          <p className="mtg-subtitle">
            Next meeting: {fmtMonday(register.upcomingMonday)} · W = Weekly, FT = Fortnightly, M = Monthly
          </p>
        </div>
        <AllCyclesDownload />
      </div>

      {error && <div className="mtg-banner is-error">{error}</div>}

      <div className="mtg-cards" role="tablist" aria-label="Review frequencies">
        {CYCLES.map((cycle) => (
          <button
            key={cycle}
            type="button"
            role="tab"
            aria-selected={view === cycle}
            className={`mtg-cycle-card ${view === cycle ? "is-active" : ""}`}
            onClick={() => selectView(cycle)}
          >
            <span className="mtg-cycle-name">
              <span className={`review-code code-${REVIEW_CODE[cycle]}`}>{REVIEW_CODE[cycle]}</span> {CYCLE_LABEL[cycle]} tasks
            </span>
            <span className="mtg-cycle-count">{register.counts[cycle]}</span>
            <span className="mtg-cycle-hint">{CYCLE_HINT[cycle].split(" – ")[1]}</span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={view === "AGENDA"}
          className={`mtg-cycle-card is-agenda ${view === "AGENDA" ? "is-active" : ""}`}
          onClick={() => selectView("AGENDA")}
        >
          <span className="mtg-cycle-name">Monday agenda</span>
          <span className="mtg-cycle-count">{agendaCount}</span>
          <span className="mtg-cycle-hint">Scheduled for {agenda ? fmtDay(agenda.meetingDate) : "…"}</span>
        </button>
      </div>

      {register.counts.UNASSIGNED > 0 && view !== "UNASSIGNED" && (
        <div className="mtg-banner is-warn">
          {register.counts.UNASSIGNED} task(s) have no review frequency and are not on any Monday agenda.
          <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => selectView("UNASSIGNED")}>
            Assign frequencies
          </button>
        </div>
      )}

      {view === "AGENDA" ? (
        <AgendaView
          agenda={agenda}
          busy={busy}
          onDate={(d) => loadAgenda(d)}
          onDiscussed={(t, discussed) => run(() => markDiscussed(agenda!.meetingDate, t.id, discussed))}
          onFinalize={() =>
            window.confirm(
              `Finalize the agenda for ${fmtMonday(agenda!.meetingDate)}?\n\nThe list of ${agenda!.items.length} task(s) is frozen. Tasks created after this go to the following Monday.`
            ) && run(() => finalizeAgenda(agenda!.meetingDate))
          }
          onReopen={() =>
            window.confirm("Reopen this agenda? It will follow the review calendar again (new and changed tasks are included).") &&
            run(() => reopenAgenda(agenda!.meetingDate))
          }
          onReschedule={(t) => setDialog({ kind: "reschedule", task: t, fromDate: t.scheduledDate })}
          onHistory={(t) => setDialog({ kind: "history", task: t })}
        />
      ) : (
        <RegisterView
          key={view}
          view={view}
          tasks={register.tasks.filter((t) => (view === "UNASSIGNED" ? !t.cycle : t.cycle === view))}
          upcomingMonday={register.upcomingMonday}
          busy={busy}
          onSchedule={changeSchedule}
          onBulkCycle={(ids, cycle, options) => run(() => setCycleBulk(ids, cycle, options))}
          onReschedule={(t) => setDialog({ kind: "reschedule", task: t, fromDate: t.nextDiscussionDate })}
          onHistory={(t) => setDialog({ kind: "history", task: t })}
        />
      )}

      {dialog?.kind === "reschedule" && (
        <RescheduleDialog
          task={dialog.task}
          fromDate={dialog.fromDate}
          upcomingMonday={register.upcomingMonday}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(toDate, reason) =>
            run(() => rescheduleTask(dialog.task.id, toDate, reason, dialog.fromDate ?? undefined))
          }
        />
      )}
      {dialog?.kind === "history" && <HistoryDialog task={dialog.task} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ReviewBadge({ task }: { task: Pick<RegisterTask, "reviewCode" | "cycle"> }) {
  if (!task.reviewCode || !task.cycle) return <span className="mtg-muted">—</span>;
  return (
    <span className={`review-code code-${task.reviewCode}`} title={CYCLE_HINT[task.cycle]}>
      {task.reviewCode}
    </span>
  );
}

function FrequencySelect({
  task,
  disabled,
  onChange,
}: {
  task: RegisterTask;
  disabled: boolean;
  onChange: (cycle: Cycle | null) => void;
}) {
  return (
    <select
      aria-label={`Review frequency for task ${task.taskNumber}`}
      value={task.cycle ?? ""}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as Cycle | null)}
    >
      <option value="">Not assigned</option>
      {CYCLES.map((c) => (
        <option key={c} value={c}>
          {REVIEW_CODE[c]}
        </option>
      ))}
    </select>
  );
}

/** Allocated Monday: fixed text for W, Monday of the month for M, alternate week for FT. */
function AllocatedMonday({
  task,
  upcomingMonday,
  disabled,
  onChange,
}: {
  task: RegisterTask;
  upcomingMonday: string;
  disabled: boolean;
  onChange: (options: CycleOptions) => void;
}) {
  if (task.cycle === "MONTHLY") {
    return (
      <>
        <select
          aria-label={`Allocated Monday for task ${task.taskNumber}`}
          value={task.monthlyMondayOrdinal ?? 1}
          disabled={disabled}
          onChange={(e) => onChange({ monthlyMondayOrdinal: Number(e.target.value) })}
        >
          {ORDINAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {task.monthlyMondayOrdinal === 5 && <div className="mtg-muted" title={FIFTH_MONDAY_NOTE}>or last Monday</div>}
      </>
    );
  }
  if (task.cycle === "FORTNIGHTLY") {
    const starts = fortnightStartOptions(upcomingMonday);
    // Which of the two alternate weeks the task's cycle is in.
    const current =
      starts.find(
        (o) => task.fortnightAnchor && Math.abs(Date.parse(o.value) - Date.parse(task.fortnightAnchor)) % (14 * 864e5) === 0
      )?.value ?? "";
    return (
      <>
        <select
          aria-label={`Alternate Mondays for task ${task.taskNumber}`}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange({ fortnightAnchor: e.target.value })}
        >
          {!current && <option value="">Choose week</option>}
          {starts.map((o) => (
            <option key={o.value} value={o.value}>
              From {fmtDay(o.value)}
            </option>
          ))}
        </select>
        <div className="mtg-muted">{task.allocatedMonday}</div>
      </>
    );
  }
  if (task.cycle === "WEEKLY") return <span>Every Monday</span>;
  return <span className="mtg-muted">—</span>;
}

function Remarks({ text }: { text: string }) {
  if (!text) return <span className="mtg-muted">—</span>;
  return <div className="mtg-remarks">{text}</div>;
}

function RegisterView({
  view,
  tasks,
  upcomingMonday,
  busy,
  onSchedule,
  onBulkCycle,
  onReschedule,
  onHistory,
}: {
  view: Cycle | "UNASSIGNED";
  tasks: RegisterTask[];
  upcomingMonday: string;
  busy: boolean;
  onSchedule: (task: RegisterTask, cycle: Cycle | null, options?: CycleOptions) => void;
  onBulkCycle: (ids: string[], cycle: Cycle, options: CycleOptions) => void;
  onReschedule: (task: RegisterTask) => void;
  onHistory: (task: RegisterTask) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "taskNumber", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCycle, setBulkCycle] = useState<Cycle>("WEEKLY");
  const [bulkOrdinal, setBulkOrdinal] = useState(1);
  const [bulkAnchor, setBulkAnchor] = useState(upcomingMonday);
  const [downloading, setDownloading] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = tasks.filter(
      (t) =>
        matchesStatus(t.status, status) &&
        (!term ||
          t.title.toLowerCase().includes(term) ||
          t.officer.toLowerCase().includes(term) ||
          String(t.taskNumber) === term.replace(/^#/, "") ||
          t.remarks.toLowerCase().includes(term))
    );
    const value = (t: RegisterTask) =>
      sort.key === "status" ? STATUS_ORDER[t.status] : sort.key === "nextDiscussionDate" ? t.nextDiscussionDate ?? "9999" : t[sort.key];
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sort.dir || a.taskNumber - b.taskNumber;
    });
  }, [tasks, search, status, sort]);

  const counts = {
    Pending: tasks.filter((t) => t.status === "Pending").length,
    Overdue: tasks.filter((t) => t.status === "Overdue").length,
    Completed: tasks.filter((t) => t.status === "Completed").length,
  };

  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="mtg-sort"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );

  const isUnassigned = view === "UNASSIGNED";
  const title = isUnassigned ? "Tasks without a review frequency" : `${codeLabel(view)} task register`;

  const download = async () => {
    if (isUnassigned) return;
    setDownloading(true);
    try {
      await downloadRegisterPdf(view, status);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>{title}</h2>
          <div className="mtg-muted">
            {tasks.length} task(s): {counts.Pending} pending · {counts.Overdue} overdue · {counts.Completed} completed
          </div>
        </div>
        {!isUnassigned && (
          <button type="button" className="mtg-btn" onClick={download} disabled={downloading}>
            {downloading ? "Preparing PDF..." : `Download ${REVIEW_CODE[view]} PDF`}
          </button>
        )}
      </div>

      <div className="mtg-toolbar">
        <input
          type="search"
          placeholder="Search ID, task, officer or remarks"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {isUnassigned && (
          <>
            <span className="mtg-toolbar-gap" />
            <select aria-label="Review frequency to assign" value={bulkCycle} onChange={(e) => setBulkCycle(e.target.value as Cycle)}>
              {CYCLES.map((c) => (
                <option key={c} value={c}>
                  {codeLabel(c)}
                </option>
              ))}
            </select>
            {bulkCycle === "MONTHLY" && (
              <select aria-label="Allocated Monday to assign" value={bulkOrdinal} onChange={(e) => setBulkOrdinal(Number(e.target.value))}>
                {ORDINAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {bulkCycle === "FORTNIGHTLY" && (
              <select aria-label="Alternate Mondays to assign" value={bulkAnchor} onChange={(e) => setBulkAnchor(e.target.value)}>
                {fortnightStartOptions(upcomingMonday).map((o) => (
                  <option key={o.value} value={o.value}>
                    From {fmtDay(o.value)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="mtg-btn"
              disabled={busy || selected.size === 0}
              onClick={() => {
                onBulkCycle(
                  [...selected],
                  bulkCycle,
                  bulkCycle === "MONTHLY"
                    ? { monthlyMondayOrdinal: bulkOrdinal }
                    : bulkCycle === "FORTNIGHTLY"
                      ? { fortnightAnchor: bulkAnchor }
                      : {}
                );
                setSelected(new Set());
              }}
            >
              Assign to {selected.size} selected
            </button>
          </>
        )}
      </div>
      {!isUnassigned && status !== "all" && (
        <p className="mtg-muted" style={{ margin: "-4px 0 10px" }}>
          The PDF follows this status filter. Choose “All Statuses” for the complete register.
        </p>
      )}

      <div className="mtg-table-wrap">
        <table className="mtg-table">
          <thead>
            <tr>
              {isUnassigned && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th>S. No.</th>
              <th>Review Frequency</th>
              {header("title", "Task Name")}
              <th>Allocated Monday</th>
              {header("nextDiscussionDate", "Scheduled Discussion")}
              {header("status", "Status")}
              <th>Latest Remark / Update</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t, index) => (
              <tr key={t.id}>
                {isUnassigned && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select task ${t.taskNumber}`}
                      checked={selected.has(t.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td className="mtg-id">{index + 1}</td>
                <td>
                  <FrequencySelect task={t} disabled={busy} onChange={(cycle) => onSchedule(t, cycle)} />
                </td>
                <td>
                  <div className="mtg-task-title">{t.title}</div>
                  <div className="mtg-muted">
                    #{t.taskNumber} · {t.officer}
                  </div>
                </td>
                <td>
                  <AllocatedMonday
                    task={t}
                    upcomingMonday={upcomingMonday}
                    disabled={busy}
                    onChange={(options) => onSchedule(t, t.cycle, options)}
                  />
                </td>
                <td className="mtg-nowrap">
                  {fmtDay(t.nextDiscussionDate)}
                  {t.rescheduled && <div className="mtg-muted">Rescheduled</div>}
                </td>
                <td>
                  <span className={`mtg-chip ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                </td>
                <td>
                  <Remarks text={t.remarks} />
                </td>
                <td>
                  <div className="mtg-row-actions">
                    {t.cycle && t.status !== "Completed" && (
                      <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onReschedule(t)}>
                        Reschedule
                      </button>
                    )}
                    <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => onHistory(t)}>
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isUnassigned ? 9 : 8} className="mtg-empty">
                  {tasks.length === 0
                    ? isUnassigned
                      ? "Every task has a review frequency."
                      : "No tasks with this review frequency yet."
                    : "No tasks match the search or filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && rows.length !== tasks.length && (
        <p className="mtg-muted" style={{ marginTop: 8 }}>
          Showing {rows.length} of {tasks.length} tasks.
        </p>
      )}
    </div>
  );
}

function AgendaView({
  agenda,
  busy,
  onDate,
  onDiscussed,
  onFinalize,
  onReopen,
  onReschedule,
  onHistory,
}: {
  agenda: AgendaResponse | null;
  busy: boolean;
  onDate: (date: string) => void;
  onDiscussed: (task: AgendaTask, discussed: boolean) => void;
  onFinalize: () => void;
  onReopen: () => void;
  onReschedule: (task: AgendaTask) => void;
  onHistory: (task: AgendaTask) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  if (!agenda) return <p className="table-status">Loading agenda...</p>;

  const date = agenda.meetingDate;
  const goTo = (value: string) => value && onDate(isMondayISO(value) ? value : mondayOnOrAfterISO(value));
  const discussed = agenda.items.filter((i) => i.outcome === "DISCUSSED").length;
  const groups: { key: string; label: string; items: AgendaTask[] }[] = [
    ...CYCLES.map((c) => ({ key: c, label: codeLabel(c), items: agenda.items.filter((i) => i.cycle === c) })),
    { key: "OTHER", label: "No review frequency", items: agenda.items.filter((i) => !i.cycle) },
  ].filter((g) => g.items.length > 0);

  const download = async (format: "pdf" | "xlsx") => {
    setDownloading(true);
    try {
      await downloadAgenda(date, format);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  let serial = 0;

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>
            Agenda for {fmtMonday(date)}{" "}
            {agenda.finalized ? (
              <span className="mtg-chip is-ok">Finalized</span>
            ) : (
              <span className="mtg-chip is-info">Draft · updates automatically</span>
            )}
          </h2>
          <div className="mtg-muted">
            {agenda.finalized
              ? `Finalized ${agenda.finalizedAt ? new Date(agenda.finalizedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}. Tasks created after this go to the following Monday.`
              : "Tasks are selected automatically from their review frequency. Finalize the agenda once it is sent out."}
          </div>
        </div>
        <div className="mtg-row-actions">
          {agenda.finalized ? (
            <button type="button" className="mtg-btn-ghost" disabled={busy} onClick={onReopen}>
              Reopen
            </button>
          ) : (
            <button type="button" className="mtg-btn-ghost" disabled={busy || agenda.items.length === 0} onClick={onFinalize}>
              Finalize agenda
            </button>
          )}
          <button type="button" className="mtg-btn" disabled={downloading} onClick={() => download("pdf")}>
            Download agenda PDF
          </button>
          <button type="button" className="mtg-btn-ghost" disabled={downloading} onClick={() => download("xlsx")}>
            Excel
          </button>
        </div>
      </div>

      <div className="mtg-summary" aria-label="Meeting summary">
        <div className="mtg-stat">
          <span className="mtg-stat-value">{agenda.items.length}</span>
          <span className="mtg-stat-label">Tasks</span>
        </div>
        {CYCLES.map((c) => (
          <div className="mtg-stat" key={c}>
            <span className="mtg-stat-value">{agenda.items.filter((i) => i.cycle === c).length}</span>
            <span className="mtg-stat-label">
              <span className={`review-code code-${REVIEW_CODE[c]}`}>{REVIEW_CODE[c]}</span> {CYCLE_LABEL[c]}
            </span>
          </div>
        ))}
        <div className="mtg-stat">
          <span className="mtg-stat-value is-urgent">{agenda.items.filter((i) => i.status === "Overdue").length}</span>
          <span className="mtg-stat-label">Overdue</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value">
            {discussed}/{agenda.items.length}
          </span>
          <span className="mtg-stat-label">Discussed</span>
        </div>
      </div>

      <div className="mtg-toolbar">
        <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(addDaysISO(date, -7))}>
          ‹ Previous Monday
        </button>
        <input type="date" aria-label="Meeting date" value={date} onChange={(e) => goTo(e.target.value)} />
        <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(addDaysISO(date, 7))}>
          Next Monday ›
        </button>
        {date !== agenda.upcomingMonday && (
          <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(agenda.upcomingMonday)}>
            Back to next meeting
          </button>
        )}
      </div>

      {agenda.items.length === 0 && <div className="mtg-empty">No tasks are scheduled for this Monday.</div>}

      {groups.map((g) => (
        <div key={g.key} className="mtg-group">
          <h3 className="mtg-group-title">
            {g.label} <span className="mtg-muted">· {g.items.length}</span>
          </h3>
          <div className="mtg-table-wrap">
            <table className="mtg-table">
              <thead>
                <tr>
                  <th>S. No.</th>
                  <th>Review Frequency</th>
                  <th>Task Name</th>
                  <th>Allocated Monday</th>
                  <th>Scheduled Discussion</th>
                  <th>Status</th>
                  <th>Latest Remark / Update</th>
                  <th>Discussed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.items.map((t) => {
                  serial += 1;
                  const done = t.outcome === "DISCUSSED";
                  const moved = t.inclusion === "BROUGHT_FORWARD" ? t.reason : null;
                  return (
                    <tr key={t.id} className={done ? "is-done" : ""}>
                      <td className="mtg-id">{serial}</td>
                      <td>
                        <ReviewBadge task={t} />
                      </td>
                      <td>
                        <div className="mtg-task-title">{t.title}</div>
                        <div className="mtg-muted">
                          #{t.taskNumber} · {t.officer}
                        </div>
                      </td>
                      <td>{t.allocatedMonday || "—"}</td>
                      <td className="mtg-nowrap">
                        {fmtDay(t.scheduledDate)}
                        {moved && <div className="mtg-note">{moved}</div>}
                      </td>
                      <td>
                        <span className={`mtg-chip ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                      </td>
                      <td>
                        <Remarks text={t.remarks} />
                      </td>
                      <td>
                        <label className="mtg-discussed">
                          <input
                            type="checkbox"
                            checked={done}
                            disabled={busy || t.outcome === "DEFERRED"}
                            onChange={(e) => onDiscussed(t, e.target.checked)}
                          />
                          <span>Discussed</span>
                        </label>
                      </td>
                      <td>
                        <div className="mtg-row-actions">
                          {!done && (
                            <button type="button" className="mtg-btn-ghost mtg-btn-sm" disabled={busy} onClick={() => onReschedule(t)}>
                              Reschedule
                            </button>
                          )}
                          <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => onHistory(t)}>
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One PDF with W, FT and M sections; Pending/Overdue by default. */
function AllCyclesDownload() {
  const [status, setStatus] = useState<StatusFilter>("pending_overdue");
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadRegisterPdf("ALL", status);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="mtg-all-download">
      <select aria-label="Status for the all-frequencies PDF" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
        {STATUS_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="button" className="mtg-btn" onClick={download} disabled={downloading}>
        {downloading ? "Preparing PDF..." : "Download W / FT / M PDF"}
      </button>
    </div>
  );
}
