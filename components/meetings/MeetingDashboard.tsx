"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CYCLES,
  CYCLE_HINT,
  CYCLE_LABEL,
  FIFTH_MONDAY_NOTE,
  ONE_TIME_CYCLES,
  ONE_TIME_HINT,
  ONE_TIME_LABEL,
  isOneTime,
  setImportant,
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
  REPEATING_CHOICES,
  choiceLabel,
  choiceOf,
  codeClass,
  getAgenda,
  getRegister,
  isMondayISO,
  markDiscussed,
  matchesStatus,
  mondayOnOrAfterISO,
  rescheduleTask,
  setCycle,
  setCycleBulk,
  type AgendaFile,
  type AgendaResponse,
  type AgendaTask,
  type Cycle,
  type CycleOptions,
  type Frequency,
  type FrequencyChoice,
  type RegisterResponse,
  type RegisterTask,
  type StatusFilter,
} from "@/lib/meetings";
import { HistoryDialog, RescheduleDialog } from "./MeetingDialogs";

type View = Cycle | "ONE_TIME" | "UNASSIGNED" | "AGENDA";
type SortKey = "taskNumber" | "title" | "nextDiscussionDate" | "status";

const STATUS_CLASS: Record<string, string> = { Pending: "is-warn", Running: "is-info", Overdue: "is-urgent", Completed: "is-ok" };
const STATUS_ORDER: Record<string, number> = { Overdue: 0, Pending: 1, Running: 2, Completed: 3 };

function initialView(): View {
  if (typeof window === "undefined") return "WEEKLY";
  const v = new URLSearchParams(window.location.search).get("view")?.toUpperCase();
  return v && ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ONE_TIME", "UNASSIGNED", "AGENDA"].includes(v) ? (v as View) : "WEEKLY";
}

function codeLabel(cycle: FrequencyChoice | Frequency): string {
  return choiceLabel(cycle);
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
  const changeSchedule = (task: RegisterTask, cycle: FrequencyChoice | null, options: CycleOptions = {}) => {
    const current = choiceOf(task);
    const from = current ? codeLabel(current) : "not assigned";
    const to = cycle ? codeLabel(cycle) : "not assigned";
    if (
      current &&
      current !== cycle &&
      !window.confirm(`Change #${task.taskNumber} from ${from} to ${to}?\n\nIts future Monday dates follow the new frequency. Past discussions are kept.`)
    ) {
      return;
    }
    run(() => setCycle(task.id, cycle, options));
  };

  /** One-time tasks: move the allocated Monday. */
  const allocate = (task: RegisterTask, date: string) => run(() => rescheduleTask(task.id, date));

  const toggleImportant = (task: RegisterTask) => {
    if (
      !task.important &&
      !window.confirm(`Mark #${task.taskNumber} as important for immediate discussion?\n\nIt is highlighted and put on the coming Monday's agenda.`)
    ) {
      return;
    }
    run(() => setImportant(task.id, !task.important));
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
            Next meeting: {fmtMonday(register.upcomingMonday)} · W = Weekly, F1 = 1st & 3rd Mondays, F2 = 2nd & 4th Mondays, M = Monthly · One-time: Next
            Monday, Next Month, Flexible Date
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
              <span className={`review-code code-${cycle === "FORTNIGHTLY" ? "F1" : REVIEW_CODE[cycle]}`}>{REVIEW_CODE[cycle]}</span> {CYCLE_LABEL[cycle]} tasks
            </span>
            <span className="mtg-cycle-count">{register.counts[cycle]}</span>
            <span className="mtg-cycle-hint">{CYCLE_HINT[cycle].split(" – ")[1]}</span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={view === "ONE_TIME"}
          className={`mtg-cycle-card ${view === "ONE_TIME" ? "is-active" : ""}`}
          onClick={() => selectView("ONE_TIME")}
        >
          <span className="mtg-cycle-name">
            <span className="review-code code-ONE">1×</span> One-time tasks
          </span>
          <span className="mtg-cycle-count">{register.counts.ONE_TIME}</span>
          <span className="mtg-cycle-hint">Next Monday, Next Month or Flexible Date</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "AGENDA"}
          className={`mtg-cycle-card is-agenda ${view === "AGENDA" ? "is-active" : ""}`}
          onClick={() => selectView("AGENDA")}
        >
          <span className="mtg-cycle-name">Monday Discussion Agenda</span>
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
          onImportant={toggleImportant}
          onHistory={(t) => setDialog({ kind: "history", task: t })}
        />
      ) : (
        <RegisterView
          key={view}
          view={view}
          tasks={register.tasks.filter((t) =>
            view === "UNASSIGNED" ? !t.cycle : view === "ONE_TIME" ? t.oneTime : t.cycle === view
          )}
          upcomingMonday={register.upcomingMonday}
          nextMonthMondays={register.nextMonthMondays}
          busy={busy}
          onSchedule={changeSchedule}
          onAllocate={allocate}
          onImportant={toggleImportant}
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
  if (isOneTime(task.cycle)) {
    return (
      <span className="review-code code-ONE" title={ONE_TIME_HINT[task.cycle]}>
        {ONE_TIME_LABEL[task.cycle]}
      </span>
    );
  }
  return (
    <span className={`review-code code-${codeClass(task.reviewCode)}`} title={CYCLE_HINT[task.cycle]}>
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
  onChange: (cycle: FrequencyChoice | null) => void;
}) {
  return (
    <select
      aria-label={`Review frequency for task ${task.taskNumber}`}
      value={choiceOf(task)}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as FrequencyChoice | null)}
    >
      <option value="">Not assigned</option>
      <optgroup label="Repeating">
        {REPEATING_CHOICES.map((c) => (
          <option key={c.value} value={c.value} title={c.hint}>
            {c.code}
          </option>
        ))}
      </optgroup>
      <optgroup label="One-time">
        {ONE_TIME_CYCLES.map((c) => (
          <option key={c} value={c}>
            {ONE_TIME_LABEL[c]}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** Allocated Monday: fixed text for W, Monday of the month for M, alternate week for FT. */
function AllocatedMonday({
  task,
  upcomingMonday,
  nextMonthMondays,
  disabled,
  onChange,
  onAllocate,
}: {
  task: RegisterTask;
  upcomingMonday: string;
  nextMonthMondays: string[];
  disabled: boolean;
  onChange: (options: CycleOptions) => void;
  onAllocate: (date: string) => void;
}) {
  if (isOneTime(task.cycle)) {
    // Next Month: one of next month's Mondays. Otherwise any coming Monday.
    const choices =
      task.cycle === "NEXT_MONTH" ? nextMonthMondays : Array.from({ length: 26 }, (_, i) => addDaysISO(upcomingMonday, 7 * i));
    const current = task.allocatedMondayDate ?? "";
    return (
      <select
        aria-label={`Allocated Monday for task ${task.taskNumber}`}
        value={current}
        disabled={disabled || task.status === "Completed"}
        onChange={(e) => e.target.value && e.target.value !== current && onAllocate(e.target.value)}
      >
        {current && !choices.includes(current) && <option value={current}>{fmtDay(current)}</option>}
        {!current && <option value="">Choose Monday</option>}
        {choices.map((d) => (
          <option key={d} value={d}>
            {fmtMonday(d)}
          </option>
        ))}
      </select>
    );
  }
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
  // F1 / F2: the Mondays follow from the frequency.
  if (task.cycle === "FORTNIGHTLY") return <span>{task.allocatedMonday}</span>;
  if (task.cycle === "WEEKLY") return <span>Every Monday</span>;
  return <span className="mtg-muted">—</span>;
}

function Remarks({ text }: { text: string }) {
  if (!text) return <span className="mtg-muted">—</span>;
  return <div className="mtg-remarks">{text}</div>;
}

function Files({ files }: { files: AgendaFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mtg-files">
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url} target="_blank" rel="noopener noreferrer">
            {f.kind === "LINK" ? "🔗" : "📎"} {f.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ImportantButton({ task, disabled, onClick }: { task: RegisterTask; disabled: boolean; onClick: () => void }) {
  if (task.status === "Completed" && !task.important) return null;
  return (
    <button
      type="button"
      className={`mtg-btn-ghost mtg-btn-sm mtg-important-btn ${task.important ? "is-on" : ""}`}
      aria-pressed={task.important}
      disabled={disabled}
      onClick={onClick}
      title={task.important ? "Remove the Important mark" : "Mark important for immediate discussion (coming Monday)"}
    >
      {task.important ? "★ Important" : "☆ Mark important"}
    </button>
  );
}

function RegisterView({
  view,
  tasks,
  upcomingMonday,
  nextMonthMondays,
  busy,
  onSchedule,
  onAllocate,
  onImportant,
  onBulkCycle,
  onReschedule,
  onHistory,
}: {
  view: Cycle | "ONE_TIME" | "UNASSIGNED";
  tasks: RegisterTask[];
  upcomingMonday: string;
  nextMonthMondays: string[];
  busy: boolean;
  onSchedule: (task: RegisterTask, cycle: FrequencyChoice | null, options?: CycleOptions) => void;
  onAllocate: (task: RegisterTask, date: string) => void;
  onImportant: (task: RegisterTask) => void;
  onBulkCycle: (ids: string[], cycle: FrequencyChoice, options: CycleOptions) => void;
  onReschedule: (task: RegisterTask) => void;
  onHistory: (task: RegisterTask) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "taskNumber", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCycle, setBulkCycle] = useState<FrequencyChoice>("WEEKLY");
  const [bulkOrdinal, setBulkOrdinal] = useState(1);
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
    Running: tasks.filter((t) => t.status === "Running").length,
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
  const isOneTimeView = view === "ONE_TIME";
  const title = isUnassigned
    ? "Tasks without a review frequency"
    : isOneTimeView
      ? "One-time tasks (Next Monday / Next Month / Flexible Date)"
      : `${codeLabel(view)} task register`;

  const download = async () => {
    if (isUnassigned || isOneTimeView) return;
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
            {tasks.length} task(s): {counts.Pending} pending · {counts.Running} running · {counts.Overdue} overdue ·{" "}
            {counts.Completed} completed
          </div>
        </div>
        {!isUnassigned && !isOneTimeView && (
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
            <select aria-label="Review frequency to assign" value={bulkCycle} onChange={(e) => setBulkCycle(e.target.value as FrequencyChoice)}>
              {REPEATING_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
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
            <button
              type="button"
              className="mtg-btn"
              disabled={busy || selected.size === 0}
              onClick={() => {
                onBulkCycle(
                  [...selected],
                  bulkCycle,
                  bulkCycle === "MONTHLY" ? { monthlyMondayOrdinal: bulkOrdinal } : {}
                );
                setSelected(new Set());
              }}
            >
              Assign to {selected.size} selected
            </button>
          </>
        )}
      </div>
      {!isUnassigned && !isOneTimeView && status !== "all" && (
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
                  <div className="mtg-task-title">
                    {t.important && <span className="mtg-important-tag">★ Important</span>}
                    {t.title}
                  </div>
                  <div className="mtg-muted">
                    #{t.taskNumber} · {t.officer}
                  </div>
                </td>
                <td>
                  <AllocatedMonday
                    task={t}
                    upcomingMonday={upcomingMonday}
                    nextMonthMondays={nextMonthMondays}
                    disabled={busy}
                    onChange={(options) => onSchedule(t, choiceOf(t) || null, options)}
                    onAllocate={(date) => onAllocate(t, date)}
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
                    <ImportantButton task={t} disabled={busy} onClick={() => onImportant(t)} />
                    {t.cycle && !t.oneTime && t.status !== "Completed" && (
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
                      : isOneTimeView
                        ? "No one-time tasks. Choose Next Monday, Next Month or Flexible Date as a task's review frequency."
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

/**
 * Monday Discussion Agenda: the tasks allocated to one Monday in 12 columns,
 * newest task date first (same order and numbering as the PDF).
 */
function AgendaView({
  agenda,
  busy,
  onDate,
  onDiscussed,
  onFinalize,
  onReopen,
  onReschedule,
  onImportant,
  onHistory,
}: {
  agenda: AgendaResponse | null;
  busy: boolean;
  onDate: (date: string) => void;
  onDiscussed: (task: AgendaTask, discussed: boolean) => void;
  onFinalize: () => void;
  onReopen: () => void;
  onReschedule: (task: AgendaTask) => void;
  onImportant: (task: AgendaTask) => void;
  onHistory: (task: AgendaTask) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  if (!agenda) return <p className="table-status">Loading agenda...</p>;

  const date = agenda.meetingDate;
  const goTo = (value: string) => value && onDate(isMondayISO(value) ? value : mondayOnOrAfterISO(value));
  const items = agenda.items;
  const discussed = items.filter((i) => i.outcome === "DISCUSSED").length;

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

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>
            Monday Discussion Agenda — {fmtMonday(date)}{" "}
            {agenda.finalized ? (
              <span className="mtg-chip is-ok">Finalized</span>
            ) : (
              <span className="mtg-chip is-info">Draft · updates automatically</span>
            )}
          </h2>
          <div className="mtg-muted">
            {agenda.finalized
              ? `Finalized ${agenda.finalizedAt ? new Date(agenda.finalizedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}. Tasks created after this go to the following Monday.`
              : "Only tasks allocated to this Monday are shown, newest date first. Finalize the agenda once it is sent out."}
          </div>
        </div>
        <div className="mtg-row-actions">
          {agenda.finalized ? (
            <button type="button" className="mtg-btn-ghost" disabled={busy} onClick={onReopen}>
              Reopen
            </button>
          ) : (
            <button type="button" className="mtg-btn-ghost" disabled={busy || items.length === 0} onClick={onFinalize}>
              Finalize agenda
            </button>
          )}
          <button type="button" className="mtg-btn" disabled={downloading} onClick={() => download("pdf")}>
            {downloading ? "Preparing..." : "Download Agenda PDF"}
          </button>
          <button type="button" className="mtg-btn-ghost" disabled={downloading} onClick={() => download("xlsx")}>
            Excel
          </button>
        </div>
      </div>

      <div className="mtg-summary" aria-label="Meeting summary">
        <div className="mtg-stat">
          <span className="mtg-stat-value">{items.length}</span>
          <span className="mtg-stat-label">Tasks</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value is-urgent">{items.filter((i) => i.important).length}</span>
          <span className="mtg-stat-label">★ Important</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value">{items.filter((i) => i.oneTime).length}</span>
          <span className="mtg-stat-label">One-time</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value">{items.filter((i) => i.status === "Running").length}</span>
          <span className="mtg-stat-label">Running</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value is-urgent">{items.filter((i) => i.status === "Overdue").length}</span>
          <span className="mtg-stat-label">Overdue</span>
        </div>
        <div className="mtg-stat">
          <span className="mtg-stat-value">
            {discussed}/{items.length}
          </span>
          <span className="mtg-stat-label">Discussed</span>
        </div>
      </div>

      <div className="mtg-toolbar">
        <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(addDaysISO(date, -7))}>
          ‹ Previous Monday
        </button>
        <label className="mtg-date-pick">
          <span>Meeting date</span>
          <input type="date" aria-label="Meeting date" value={date} onChange={(e) => goTo(e.target.value)} />
        </label>
        <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(addDaysISO(date, 7))}>
          Next Monday ›
        </button>
        {date !== agenda.upcomingMonday && (
          <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => goTo(agenda.upcomingMonday)}>
            Back to next meeting
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mtg-empty">No tasks are allocated to this Monday.</div>
      ) : (
        <div className="mtg-table-wrap">
          <table className="mtg-table mtg-agenda-table">
            <thead>
              <tr>
                <th>S.N.</th>
                <th>Date</th>
                <th>Review Frequency</th>
                <th>Allocated Monday</th>
                <th>Task</th>
                <th>Coordinator Officer</th>
                <th>Other Officers</th>
                <th>Action Plan</th>
                <th>Execution Date (TDC)</th>
                <th>Status</th>
                <th>DRM Remark / File</th>
                <th>Latest BO Remark / File</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const done = t.outcome === "DISCUSSED";
                const moved = t.inclusion === "BROUGHT_FORWARD" ? t.reason : null;
                const rule = t.cycle && !t.oneTime ? t.allocatedMonday : null;
                return (
                  <tr key={t.id} className={`${done ? "is-done" : ""} ${t.important ? "is-important" : ""}`}>
                    <td className="mtg-id">{t.serial}</td>
                    <td className="mtg-nowrap">{fmtDay(t.date)}</td>
                    <td>
                      <ReviewBadge task={t} />
                    </td>
                    <td className="mtg-nowrap">
                      {fmtDay(t.scheduledDate)}
                      {rule && <div className="mtg-muted">{rule}</div>}
                      {moved && <div className="mtg-note">{moved}</div>}
                      {!done && t.status !== "Completed" && (
                        <div>
                          <button type="button" className="mtg-link-btn" disabled={busy} onClick={() => onReschedule(t)}>
                            Change Monday
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="mtg-agenda-task">
                      <div className="mtg-task-title">
                        {t.important && <span className="mtg-important-tag">★ Important</span>}
                        {t.title}
                      </div>
                      <div className="mtg-muted">#{t.taskNumber}</div>
                      <div className="mtg-row-actions" style={{ marginTop: 6 }}>
                        <ImportantButton task={t} disabled={busy} onClick={() => onImportant(t)} />
                        <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => onHistory(t)}>
                          History
                        </button>
                      </div>
                    </td>
                    <td>{t.officer}</td>
                    <td>{t.otherOfficers.length ? t.otherOfficers.join(", ") : <span className="mtg-muted">—</span>}</td>
                    <td>
                      <Remarks text={t.actionPlan ?? ""} />
                    </td>
                    <td className="mtg-nowrap">{fmtDay(t.dueDate)}</td>
                    <td>
                      <span className={`mtg-chip ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                      <label className="mtg-discussed" style={{ marginTop: 8 }}>
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
                      <Remarks text={t.drmRemark ?? ""} />
                      <Files files={t.drmFiles} />
                    </td>
                    <td>
                      {t.latestBo ? (
                        <>
                          {t.latestBo.remark && <div className="mtg-remarks">{t.latestBo.remark}</div>}
                          <div className="mtg-muted">
                            {t.latestBo.by} · {fmtDay(t.latestBo.at)}
                          </div>
                          <Files files={t.latestBo.files} />
                        </>
                      ) : (
                        <span className="mtg-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
        {downloading ? "Preparing PDF..." : "Download W / F1 / F2 / M PDF"}
      </button>
    </div>
  );
}
