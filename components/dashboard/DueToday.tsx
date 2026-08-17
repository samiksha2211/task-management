"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, type ApiStats, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

export default function DueToday() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ApiStats>("/api/dashboard/stats");
      setTasks(data.dueToday);
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
    <div className="due-today">

      <h2>📅 Due Today</h2>

      {tasks.map((task) => (
        <div className="due-item" key={task.id}>
          <h4>{task.title}</h4>
          <p>{task.officer.designation}</p>
          <span>Due Today</span>
        </div>
      ))}

      {tasks.length === 0 && (
        <div className="due-item">
          <p>No tasks due today.</p>
        </div>
      )}

    </div>
  );
}
