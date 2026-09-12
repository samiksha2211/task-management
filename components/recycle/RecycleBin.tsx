"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, formatDate, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

export default function RecycleBin() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<{ tasks: ApiTask[] }>("/api/tasks/recycle-bin");
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recycle bin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useRealtime(
    ["task:deleted", "task:restored", "task:updated"],
    () => void load(true)
  );

  const handleRestore = async (id: string) => {
    try {
      await apiFetch(`/api/tasks/${id}/restore`, { method: "POST" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to restore task");
    }
  };

  const handleHardDelete = async (id: string) => {
    if (!window.confirm("Permanently delete this task? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/tasks/${id}/hard`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete task");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Recycle Bin</h1>
      </div>

      {loading ? (
        <p className="table-status">Loading recycle bin...</p>
      ) : error ? (
        <p className="table-status table-error">{error}</p>
      ) : (
        <div className="task-table-scroll">
        <table className="task-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Task</th>
              <th>Designation</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Deleted On</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{formatDate(task.date)}</td>
                <td>{task.title}</td>
                <td>
                  {task.officer.designation}
                </td>
                <td>
                  <span className={`status ${task.status.toLowerCase()}`}>
                    {task.status}
                  </span>
                </td>
                <td>{formatDate(task.dueDate)}</td>
                <td>{task.deletedAt ? formatDate(task.deletedAt) : "-"}</td>
                <td className="action-buttons">
                  <button
                    className="restore-btn"
                    onClick={() => handleRestore(task.id)}
                  >
                    Restore
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleHardDelete(task.id)}
                  >
                    Delete Forever
                  </button>
                </td>
              </tr>
            ))}

            {tasks.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  Recycle bin is empty.
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
