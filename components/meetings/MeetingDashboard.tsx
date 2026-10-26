"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CYCLES,
  CYCLE_HINT,
  CYCLE_LABEL,
  addDaysISO,
  downloadAgenda,
  downloadRegisterPdf,
  fmtDay,
  fmtMonday,
  getAgenda,
  getRegister,
  isMondayISO,
  markDiscussed,
  mondayOnOrAfterISO,
  rescheduleTask,
  setCycle,
  setCycleBulk,
  type AgendaResponse,
  type AgendaTask,
  type Cycle,
  type RegisterResponse,
  type RegisterTask,
} from "@/lib/meetings";
import { HistoryDialog, RescheduleDialog } from "./MeetingDialogs";

type View = Cycle | "UNASSIGNED" | "AGENDA";
type StatusFilter = "all" | "pending" | "overdue" | "completed";
type SortKey = "taskNumber" | "title" | "nextDiscussionDate" | "status";

const STATUS_CLASS: Record<string, string> = { Pending: "is-warn", Overdue: "is-urgent", Completed: "is-ok" };
const STATUS_ORDER: Record<string, number> = { Overdue: 0, Pending: 1, Completed: 2 };

function initialView(): View {
  if (typeof window === "undefined") return "WEEKLY";
  const v = new URLSearchParams(window.location.search).get("view")?.toUpperCase();
  return v && ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "UNASSIGNED", "AGENDA"].includes(v) ? (v as View) : "WEEKLY";
}

export default function MeetingDashboard() {
  const [view, setView] = useState<View>(initialView);
  const [register, setRegister] = useState<RegisterResponse | null>(null);
  const [agenda, setAgenda] = useState<AgendaResponse | null>(null);
  const [agendaDate, setAgendaDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "reschedule" | "history"; task: RegisterTask } | null>(null);

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

  const changeCycle = (task: RegisterTask, value: string) => {
    const cycle = (value || null) as Cycle | null;
    if (cycle === task.cycle) return;
    if (
      task.cycle &&
      !window.confirm(
        `Change #${task.taskNumber} from ${CYCLE_LABEL[task.cycle]} to ${cycle ? CYCLE_LABEL[cycle] : "no cycle"}?\n\n` +
          "Its next discussion date is recalculated. Past discussions are kept."
      )
    ) {
      return;
    }
    run(() => setCycle(task.id, cycle));
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
          <p className="mtg-subtitle">Next meeting: {fmtMonday(register.upcomingMonday)}</p>
        </div>
      </div>

      {error && <div className="mtg-banner is-error">{error}</div>}

      <div className="mtg-cards" role="tablist" aria-label="Discussion cycles">
        {CYCLES.map((cycle) => (
          <button
            key={cycle}
            type="button"
            role="tab"
            aria-selected={view === cycle}
            className={`mtg-cycle-card ${view === cycle ? "is-active" : ""}`}
            onClick={() => selectView(cycle)}
          >
            <span className="mtg-cycle-name">{CYCLE_LABEL[cycle]} tasks</span>
            <span className="mtg-cycle-count">{register.counts[cycle]}</span>
            <span className="mtg-cycle-hint">{CYCLE_HINT[cycle]}</span>
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
          <span className="mtg-cycle-hint">Due on {agenda ? fmtDay(agenda.meetingDate) : "…"}</span>
        </button>
      </div>

      {register.counts.UNASSIGNED > 0 && view !== "UNASSIGNED" && (
        <div className="mtg-banner is-warn">
          {register.counts.UNASSIGNED} task(s) have no discussion cycle yet.
          <button type="button" className="mtg-btn-ghost mtg-btn-sm" onClick={() => selectView("UNASSIGNED")}>
            Assign cycles
          </button>
        </div>
      )}

      {view === "AGENDA" ? (
        <AgendaView
          agenda={agenda}
          busy={busy}
          onDate={(d) => loadAgenda(d)}
          onDiscussed={(t, discussed) => run(() => markDiscussed(agenda!.meetingDate, t.id, discussed))}
          onReschedule={(t) => setDialog({ kind: "reschedule", task: t })}
          onHistory={(t) => setDialog({ kind: "history", task: t })}
        />
      ) : (
        <RegisterView
          key={view}
          view={view}
          tasks={register.tasks.filter((t) => (view === "UNASSIGNED" ? !t.cycle : t.cycle === view))}
          busy={busy}
          onCycle={changeCycle}
          onBulkCycle={(ids, cycle) => run(() => setCycleBulk(ids, cycle))}
          onReschedule={(t) => setDialog({ kind: "reschedule", task: t })}
          onHistory={(t) => setDialog({ kind: "history", task: t })}
        />
      )}

      {dialog?.kind === "reschedule" && (
        <RescheduleDialog
          task={dialog.task}
          upcomingMonday={register.upcomingMonday}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(toDate, reason) => run(() => rescheduleTask(dialog.task.id, toDate, reason))}
        />
      )}
      {dialog?.kind === "history" && <HistoryDialog task={dialog.task} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CycleSelect({
  task,
  disabled,
  onChange,
}: {
  task: RegisterTask;
  disabled: boolean;
  onChange: (task: RegisterTask, value: string) => void;
}) {
  return (
    <select
      aria-label={`Discussion cycle for task ${task.taskNumber}`}
      value={task.cycle ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(task, e.target.value)}
    >
      <option value="">Not assigned</option>
      {CYCLES.map((c) => (
        <option key={c} value={c}>
          {CYCLE_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

function Remarks({ text }: { text: string }) {
  if (!text) return <span className="mtg-muted">—</span>;
  return <div className="mtg-remarks">{text}</div>;
}

function RegisterView({
  view,
  tasks,
  busy,
  onCycle,
  onBulkCycle,
  onReschedule,
  onHistory,
}: {
  view: Cycle | "UNASSIGNED";
  tasks: RegisterTask[];
  busy: boolean;
  onCycle: (task: RegisterTask, value: string) => void;
  onBulkCycle: (ids: string[], cycle: Cycle) => void;
  onReschedule: (task: RegisterTask) => void;
  onHistory: (task: RegisterTask) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "taskNumber", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCycle, setBulkCycle] = useState<Cycle>("WEEKLY");
  const [downloading, setDownloading] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = tasks.filter(
      (t) =>
        (status === "all" || t.status.toLowerCase() === status) &&
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
  const title = isUnassigned ? "Tasks without a discussion cycle" : `${CYCLE_LABEL[view]} task register`;

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
            {downloading ? "Preparing PDF..." : `Download ${CYCLE_LABEL[view]} PDF`}
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
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
        </select>
        {isUnassigned && (
          <>
            <span className="mtg-toolbar-gap" />
            <select aria-label="Cycle to assign" value={bulkCycle} onChange={(e) => setBulkCycle(e.target.value as Cycle)}>
              {CYCLES.map((c) => (
                <option key={c} value={c}>
                  {CYCLE_LABEL[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mtg-btn"
              disabled={busy || selected.size === 0}
              onClick={() => {
                onBulkCycle([...selected], bulkCycle);
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
          The PDF follows this status filter. Choose “All statuses” for the complete register.
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
              {header("taskNumber", "ID")}
              {header("title", "Task")}
              <th>Cycle</th>
              {header("nextDiscussionDate", "Next discussion")}
              {header("status", "Status")}
              <th>Latest remarks / update</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
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
                <td className="mtg-id">#{t.taskNumber}</td>
                <td>
                  <div className="mtg-task-title">{t.title}</div>
                  <div className="mtg-muted">{t.officer}</div>
                </td>
                <td>
                  <CycleSelect task={t} disabled={busy} onChange={onCycle} />
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
                <td colSpan={isUnassigned ? 8 : 7} className="mtg-empty">
                  {tasks.length === 0
                    ? isUnassigned
                      ? "Every task has a discussion cycle."
                      : "No tasks in this cycle yet. Assign a cycle from any task’s Cycle column."
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
  onReschedule,
  onHistory,
}: {
  agenda: AgendaResponse | null;
  busy: boolean;
  onDate: (date: string) => void;
  onDiscussed: (task: AgendaTask, discussed: boolean) => void;
  onReschedule: (task: AgendaTask) => void;
  onHistory: (task: AgendaTask) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  if (!agenda) return <p className="table-status">Loading agenda...</p>;

  const date = agenda.meetingDate;
  const goTo = (value: string) => value && onDate(isMondayISO(value) ? value : mondayOnOrAfterISO(value));
  const discussed = agenda.items.filter((i) => i.outcome === "DISCUSSED").length;
  const groups: { key: string; label: string; items: AgendaTask[] }[] = [
    ...CYCLES.map((c) => ({ key: c, label: CYCLE_LABEL[c], items: agenda.items.filter((i) => i.cycle === c) })),
    { key: "OTHER", label: "No cycle", items: agenda.items.filter((i) => !i.cycle) },
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

  return (
    <div className="mtg-card">
      <div className="mtg-card-head">
        <div>
          <h2>Agenda for {fmtMonday(date)}</h2>
          <div className="mtg-muted">
            {agenda.items.length} task(s) due · {discussed} discussed. Tick “Discussed” after a task is discussed; its
            next date then follows its cycle.
          </div>
        </div>
        <div className="mtg-row-actions">
          <button type="button" className="mtg-btn" disabled={downloading} onClick={() => download("pdf")}>
            Download agenda PDF
          </button>
          <button type="button" className="mtg-btn-ghost" disabled={downloading} onClick={() => download("xlsx")}>
            Excel
          </button>
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

      {agenda.items.length === 0 && <div className="mtg-empty">No tasks are due on this Monday.</div>}

      {groups.map((g) => (
        <div key={g.key} className="mtg-group">
          <h3 className="mtg-group-title">
            {g.label} <span className="mtg-muted">· {g.items.length}</span>
          </h3>
          <div className="mtg-table-wrap">
            <table className="mtg-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Last discussed</th>
                  <th>Latest remarks / update</th>
                  <th>Discussed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.items.map((t) => {
                  const done = t.outcome === "DISCUSSED";
                  const note = t.inclusion === "BROUGHT_FORWARD" || /^Carried over|^Moved/.test(t.reason) ? t.reason : null;
                  return (
                    <tr key={t.id} className={done ? "is-done" : ""}>
                      <td className="mtg-id">#{t.taskNumber}</td>
                      <td>
                        <div className="mtg-task-title">{t.title}</div>
                        <div className="mtg-muted">{t.officer}</div>
                        {note && <div className="mtg-note">{note}</div>}
                      </td>
                      <td>
                        <span className={`mtg-chip ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                      </td>
                      <td className="mtg-nowrap">{fmtDay(t.lastDiscussedAt)}</td>
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
                          <span>{done ? `Next: ${fmtDay(t.nextDiscussionDate)}` : "Discussed"}</span>
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
