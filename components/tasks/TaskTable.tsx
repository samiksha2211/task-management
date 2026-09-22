"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FaDownload } from "react-icons/fa";
import { apiFetch, formatDate, getRole, type ApiTask } from "@/lib/api";
import { DESIGNATIONS } from "@/lib/designations";
import {
  isNetworkError,
  listPendingTasks,
  mergeTasksWithPending,
  onOfflineQueueChange,
  type PendingTaskCreate,
} from "@/lib/offline";
import { useRealtime } from "@/lib/realtime";
import { downloadTasks, type DownloadFormat } from "@/lib/download";
import DownloadMenu from "./DownloadMenu";

function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function TaskTable({
  initialSearch = "",
  initialStatus = "all",
}: {
  initialSearch?: string;
  initialStatus?: string;
}) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTaskCreate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [date, setDate] = useState("");
  const [selectedDesignations, setSelectedDesignations] = useState<string[]>([]);
  const [designationFilterOpen, setDesignationFilterOpen] = useState(false);
  const [sortDate, setSortDate] = useState<"desc" | "asc">("desc");
  const [downloading, setDownloading] = useState(false);

  const isAdmin = getRole() === "ADMIN";

  const loadPending = useCallback(async () => {
    const rows = await listPendingTasks();
    setPendingTasks(rows);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      params.set("limit", "10000");

      const [data] = await Promise.all([
        apiFetch<{ tasks: ApiTask[] }>(`/api/tasks?${params.toString()}`),
        loadPending(),
      ]);
      setTasks(data.tasks);
    } catch (e) {
      if (isNetworkError(e)) {
        await loadPending();
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load tasks");
      }
    } finally {
      setLoading(false);
    }
  }, [search, loadPending]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return onOfflineQueueChange(() => {
      void loadPending();
      void load(true);
    });
  }, [load, loadPending]);

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored"],
    () => void load(true)
  );

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this task? It can be restored later from the Recycle Bin.")) return;
    try {
      await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete task");
    }
  };

  const handleToggleStatus = async (task: ApiTask) => {
    if (task.offlinePending) return;
    const next = task.status === "Completed" ? "Pending" : "Completed";
    try {
      await apiFetch(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  // All filterable designations: the app-wide source (used by the add-task
  // autocomplete) plus any designation actually present on loaded tasks, so the
  // dropdown is never an incomplete hardcoded list.
  const allTasks = useMemo(() => {
    let pending = pendingTasks;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      pending = pending.filter(
        (item) =>
          item.title.toLowerCase().includes(term) ||
          item.designation.toLowerCase().includes(term)
      );
    }
    return mergeTasksWithPending(tasks, pending);
  }, [tasks, pendingTasks, search]);

  const designations = useMemo(() => {
  const set = new Set<string>(DESIGNATIONS);

  for (const t of allTasks) {
    // Primary designation
    if (t.officer?.designation) {
      set.add(t.officer.designation);
    }

    // Additional designations
    for (const additional of t.additionalAssignees ?? []) {
      if (additional.designation) {
        set.add(additional.designation);
      }
    }
  }

  return [...set].sort((a, b) =>
    a.localeCompare(b)
  );
}, [allTasks]);

  // Single dataset that drives both the rendered table and the exports, so the
  // downloaded PDF/CSV always contains exactly the rows the user sees. Search
  // runs on the server; status/date/designation combine here (AND).
  const filteredTasks = allTasks
    .filter((task) => {
      if (status === "pending_overdue") {
        if (task.status !== "Pending" && task.status !== "Overdue") return false;
      } else if (status === "pending") {
        if (task.status !== "Pending") return false;
      } else if (status === "overdue") {
        if (task.status !== "Overdue") return false;
      } else if (status === "completed") {
        if (task.status !== "Completed") return false;
      }
      if (date && toLocalDateKey(task.date) !== date) return false;
      if (selectedDesignations.length > 0) {
  const taskDesignations = [
    task.officer?.designation,
    ...(task.additionalAssignees ?? []).map(
      (officer) => officer.designation
    ),
  ].filter(Boolean) as string[];

  const matchesDesignation =
    selectedDesignations.some((selected) =>
      taskDesignations.includes(selected)
    );

  if (!matchesDesignation) {
    return false;
  }
  }
      return true;
    })
    .sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return sortDate === "desc" ? db - da : da - db;
    });

  const handleDownload = async (format: DownloadFormat, id?: string) => {
    const downloadable = filteredTasks.filter((task) => !task.offlinePending);
    if (!id && downloadable.length === 0) {
      alert("No tasks available to download.");
      return;
    }
    setDownloading(true);
    try {
      await downloadTasks({
        format,
        ...(id
          ? { id }
          : { ids: downloadable.map((t) => t.id) }),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to download tasks");
    } finally {
      setDownloading(false);
    }
  };
<div
  className="designation-multi-filter"
  style={{ position: "relative" }}
>
  <button
  type="button"
  className="designation-filter-button"
  onClick={() =>
    setDesignationFilterOpen((prev) => !prev)
  }
  aria-label="Filter by designation"
>
  <span className="designation-filter-text">
    {selectedDesignations.length === 0
      ? "All Designations"
      : selectedDesignations.length === 1
        ? selectedDesignations[0]
        : `${selectedDesignations.length} Designations`}
  </span>

  <span className="designation-filter-arrow">
    {designationFilterOpen ? "▲" : "▼"}
  </span>
</button>

  {designationFilterOpen && (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 1000,
        minWidth: "240px",
        maxHeight: "300px",
        overflowY: "auto",
        background: "white",
        border: "1px solid #ddd",
        borderRadius: "6px",
        padding: "8px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      {selectedDesignations.length > 0 && (
        <button
          type="button"
          onClick={() => setSelectedDesignations([])}
          style={{
            width: "100%",
            marginBottom: "6px",
            padding: "6px",
            cursor: "pointer",
          }}
        >
          Clear All
        </button>
      )}

      {designations.map((d) => (
        <label
          key={d}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selectedDesignations.includes(d)}
            onChange={() => {
  setSelectedDesignations((current) =>
    current.includes(d)
      ? current.filter((item) => item !== d)
      : [...current, d]
  );

  setDesignationFilterOpen(false);
}}
          />

          <span>{d}</span>
        </label>
      ))}
    </div>
  )}
</div>
  return (
    <div>
      <div className="task-toolbar">
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Filter by date"
        >
          <option value="">All Dates</option>
          {[...new Set(allTasks.map((t) => toLocalDateKey(t.date)).filter(Boolean))].sort().reverse().map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <div
  className="designation-multi-filter"
  style={{ position: "relative" }}
>
  <button
    type="button"
    className="designation-filter-button"
    onClick={() =>
      setDesignationFilterOpen((prev) => !prev)
    }
  >
    {selectedDesignations.length === 0
      ? "All Designations"
      : `${selectedDesignations.length} selected`}

    <span style={{ marginLeft: "8px" }}>▼</span>
  </button>

  {designationFilterOpen && (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 1000,
        minWidth: "240px",
        maxHeight: "300px",
        overflowY: "auto",
        background: "white",
        border: "1px solid #ddd",
        borderRadius: "6px",
        padding: "8px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
      }}
    >
      {selectedDesignations.length > 0 && (
        <button
          type="button"
          onClick={() => setSelectedDesignations([])}
          style={{
            width: "100%",
            marginBottom: "6px",
            padding: "6px",
            cursor: "pointer",
          }}
        >
          Clear All
        </button>
      )}

      {designations.map((d) => (
        <label
          key={d}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selectedDesignations.includes(d)}
            onChange={() => {
              setSelectedDesignations((current) =>
                current.includes(d)
                  ? current.filter((item) => item !== d)
                  : [...current, d]
              );
            }}
          />

          <span>{d}</span>
        </label>
      ))}
    </div>
  )}
</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
          <option value="pending_overdue">Pending/Overdue</option>
        </select>
        <select value={sortDate} onChange={(e) => setSortDate(e.target.value as "desc" | "asc")}>
          <option value="desc">Date: Newest First</option>
          <option value="asc">Date: Oldest First</option>
        </select>

        <div className="download-actions">
          <DownloadMenu
            label="Download"
            disabled={downloading}
            onSelect={(format) => void handleDownload(format)}
          />
          {downloading && (
            <span className="download-status">
              <span className="spinner" />
              Preparing download…
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="table-status">Loading tasks...</p>
      ) : error ? (
        <p className="table-status table-error">{error}</p>
      ) : (
        <div className="task-table-scroll">
        <table className="task-table">
          <thead>
            <tr>
              <th>Done</th>
              <th>Date</th>
              <th>Task</th>
              <th>Designation</th>
              <th>Also Assigned To</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Remarks</th>
              <th>Attachment</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredTasks.map((task) => (
              <tr key={task.id} className={task.offlinePending ? "offline-task-row" : undefined}>
                <td>
                  <label className="task-checkbox-label">
                    <input
                      type="checkbox"
                      className="task-checkbox"
                      checked={task.status === "Completed"}
                      onChange={() => handleToggleStatus(task)}
                      disabled={task.offlinePending}
                      title={
                        task.offlinePending
                          ? "Available after sync"
                          : task.status === "Completed"
                            ? "Mark as Pending"
                            : "Mark as Completed"
                      }
                    />
                  </label>
                </td>
                <td>{formatDate(task.date)}</td>
                <td>
                  {task.title}
                  {task.offlinePending && (
                    <span
                      className={`sync-badge sync-${task.syncState ?? "pending"}`}
                      title={task.syncError ?? "Waiting to sync"}
                    >
                      {task.syncState === "syncing"
                        ? "Syncing"
                        : task.syncState === "failed"
                          ? "Sync failed"
                          : "Offline"}
                    </span>
                  )}
                </td>
                <td>
                  {task.officer.designation}
                </td>
                <td>
               {(task.additionalAssignees ?? []).length > 0
               ? task.additionalAssignees
              .map((officer) => officer.designation)
              .join(", ")
                 : "-"}
              </td>
                <td>
                  <span className={`status ${task.status.toLowerCase()}`}>
                    {task.status}
                  </span>
                </td>
                <td>{formatDate(task.dueDate)}</td>
                <td>{task.remarks || "-"}</td>
                <td>
                {task.attachmentUrl ? (
                <a
                 href={'http://localhost:4000' + task.attachmentUrl}
                 target="_blank"
                 rel="noopener noreferrer"
                 >
                  View
                  </a>
                  ) : (
                     "-"
                     )}
                   </td>
                   <td className="action-buttons">
                     {!task.offlinePending && (
                    <button
                      className="row-download-btn"
                      title="Download PDF"
                      disabled={downloading}
                      onClick={() => void handleDownload("pdf", task.id)}
                    >
                      <FaDownload />
                    </button>
                  )}
                  {!task.offlinePending ? (
                    <Link href={`/tasks/view?id=${task.id}`} className="view-btn">
                      View
                    </Link>
                  ) : (
                    <span className="view-btn view-btn-disabled">View</span>
                  )}
                  {isAdmin ? (
                    <>
                      {!task.offlinePending && (
                        <Link href={`/tasks/edit?id=${task.id}`} className="edit-btn">
                          Edit
                        </Link>
                      )}
                      {!task.offlinePending && (
                        <button
                          className="delete-btn"
                          onClick={() => handleDelete(task.id)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  ) : (
                    !task.offlinePending && (
                      <button
                        className="status-toggle-btn"
                        onClick={() => handleToggleStatus(task)}
                      >
                        {task.status === "Completed" ? "Mark Pending" : "Mark Complete"}
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}

            {filteredTasks.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-state">
                  No tasks found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
