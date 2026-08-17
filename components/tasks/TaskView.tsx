"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, formatDate, getRole, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

export default function TaskView({ id }: { id?: string }) {
  const router = useRouter();
  const [task, setTask] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = getRole() === "ADMIN";

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    apiFetch<{ task: ApiTask }>(`/api/tasks/${id}`)
      .then((data) => {
        if (!cancelled) setTask(data.task);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load task");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<{ task: ApiTask }>(`/api/tasks/${id}`);
      setTask(data.task);
    } catch {
      // keep current view
    }
  }, [id]);

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored"],
    () => void reload()
  );

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm("Delete this task? It can be restored later from the Recycle Bin.")) return;
    try {
      await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      router.push("/tasks");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete task");
    }
  };

  const handleToggleStatus = async () => {
    if (!task) return;
    const next = task.status === "Completed" ? "Pending" : "Completed";
    try {
      const data = await apiFetch<{ task: ApiTask }>(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setTask(data.task);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  if (!id) {
    return (
      <div className="task-detail-card">
        <h1 className="task-detail-error">Task Details</h1>
        <p className="table-status table-error">No task id provided.</p>
        <div className="task-detail-actions">
          <Link href="/tasks" className="btn-back">← Back to Tasks</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="table-status">Loading task...</p>;
  }

  if (error || !task) {
    return (
      <div className="task-detail-card">
        <h1 className="task-detail-error">Task Details</h1>
        <p className="table-status table-error">{error || "Task not found."}</p>
        <div className="task-detail-actions">
          <Link href="/tasks" className="btn-back">← Back to Tasks</Link>
        </div>
      </div>
    );
  }

  const rows = [
    { label: "Task", value: task.title },
    { label: "Date", value: formatDate(task.date) },
    { label: "Due Date", value: formatDate(task.dueDate) },
    { label: "Assigned To", value: task.officer.designation },
    { label: "Remarks", value: task.remarks || "-" },
  ];

  return (
    <div className="task-detail-card">

      <div className="task-detail-header">
        <h1>Task Details</h1>
        <span className={`status ${task.status.toLowerCase()}`}>
          {task.status}
        </span>
      </div>

      <div className="task-detail-grid">
        {rows.map((row) => (
          <div className="task-detail-row" key={row.label}>
            <div className="task-detail-label">{row.label}</div>
            <div className="task-detail-value">{row.value}</div>
          </div>
        ))}
      </div>

      <div className="task-detail-description">
        <div className="task-detail-label">Description</div>
        <p>{task.description || "No description provided."}</p>
      </div>

      <div className="task-detail-actions">
        {isAdmin ? (
          <>
            <Link href={`/tasks/edit?id=${task.id}`} className="btn-edit">
              Edit Task
            </Link>
            <button onClick={handleDelete} className="btn-delete">
              Delete
            </button>
          </>
        ) : (
          <button onClick={handleToggleStatus} className="btn-status">
            {task.status === "Completed" ? "Mark as Pending" : "Mark as Completed"}
          </button>
        )}
        <Link href="/tasks" className="btn-back">
          ← Back to Tasks
        </Link>
      </div>

    </div>
  );
}
