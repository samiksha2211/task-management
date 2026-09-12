"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, formatDate, type ApiStats, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

export default function RecentTasks() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ApiStats>("/api/dashboard/stats");
      setTasks(data.recentTasks);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored"],
    () => void load()
  );

  return (
    <div className="dashboard-card recent-tasks-card">

      <div className="recent-header">
        <h2>Recent Tasks</h2>

        <Link href="/tasks" className="view-all-btn">
          View All →
        </Link>
      </div>

      <div className="task-table-scroll">
      <table className="recent-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Task</th>
            <th>Designation</th>
            <th>Status</th>
            <th>Remarks</th>
          </tr>
        </thead>

        <tbody>

          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{formatDate(task.date)}</td>
              <td>{task.title}</td>
              <td>{task.officer.designation}</td>
              <td>
                <span className={`status-badge ${task.status.toLowerCase()}`}>
                  {task.status}
                </span>
              </td>
              <td>{task.remarks || "-"}</td>
            </tr>
          ))}

          {tasks.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">
                No recent tasks.
              </td>
            </tr>
          )}

        </tbody>
      </table>
      </div>

    </div>
  );
}
