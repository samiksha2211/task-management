"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { apiFetch, type ApiTask, type ApiStats } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

type WeeklyData = { labels: string[]; data: number[] };
type TaskStatusData = { labels: string[]; data: number[] };

type DesignationRow = {
  designation: string;
  officerCount: number;
  total: number;
  pending: number;
  completed: number;
  overdue: number;
};

export default function ReportsDashboard() {
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData>({ labels: [], data: [] });
  const [statusData, setStatusData] = useState<TaskStatusData>({
    labels: [],
    data: [],
  });
  const [rows, setRows] = useState<DesignationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [statsData, weeklyData, statusRes, tasksRes] = await Promise.all([
        apiFetch<ApiStats>("/api/dashboard/stats"),
        apiFetch<WeeklyData>("/api/dashboard/weekly"),
        apiFetch<TaskStatusData>("/api/dashboard/task-status"),
        apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=1000"),
      ]);

      setStats(statsData);
      setWeekly(weeklyData);
      setStatusData(statusRes);

      const map = new Map<string, DesignationRow>();
      for (const task of tasksRes.tasks) {
        const key = task.officer.designation || "Unassigned";
        const row = map.get(key) ?? {
          designation: key,
          officerCount: 0,
          total: 0,
          pending: 0,
          completed: 0,
          overdue: 0,
        };
        row.total += 1;
        if (task.status === "Completed") row.completed += 1;
        else if (task.status === "Overdue") row.overdue += 1;
        else row.pending += 1;
        map.set(key, row);
      }

      const officerByDesignation = new Map<string, Set<string>>();
      for (const task of tasksRes.tasks) {
        const key = task.officer.designation || "Unassigned";
        const set = officerByDesignation.get(key) ?? new Set<string>();
        set.add(task.officer.id);
        officerByDesignation.set(key, set);
      }
      for (const row of map.values()) {
        row.officerCount = officerByDesignation.get(row.designation)?.size ?? 0;
      }

      setRows([...map.values()].sort((a, b) => b.total - a.total));
    } catch {
      // ignore
    } finally {
      setLoading(false);
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

  const weeklyBars = weekly.labels.map((label, i) => ({
    day: label,
    tasks: weekly.data[i] ?? 0,
  }));

  const statusBars = statusData.labels.map((label, i) => ({
    name: label,
    count: statusData.data[i] ?? 0,
  }));

  const summary = [
    { label: "Total Tasks", value: stats?.total ?? 0, cls: "blue" },
    { label: "Pending", value: stats?.pending ?? 0, cls: "orange" },
    { label: "Overdue", value: stats?.overdue ?? 0, cls: "red" },
    { label: "Completed", value: stats?.completed ?? 0, cls: "green" },
  ];

  return (
    <div className="reports-page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      <div className="stats-grid">
        {summary.map((item) => (
          <div className="stat-card" key={item.label}>
            <div className={`icon-box ${item.cls}`}>
              <span className="stat-number">{item.value}</span>
            </div>
            <div className="stat-content">
              <h4>{item.label}</h4>
              <h2>{loading ? "…" : item.value}</h2>
            </div>
          </div>
        ))}
      </div>

      <div className="reports-grid">
        <div className="report-card">
          <h3>Tasks Created (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyBars}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="tasks" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="report-card">
          <h3>Task Status Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={statusBars} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={90} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {statusBars.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={["#22c55e", "#facc15", "#ef4444"][i] ?? "#64748b"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="report-card designation-report">
        <h3>Performance by Designation</h3>
        {loading ? (
          <p className="table-status">Loading report...</p>
        ) : (
          <div className="task-table-scroll">
          <table className="task-table">
            <thead>
              <tr>
                <th>Designation</th>
                <th>Officers</th>
                <th>Total Tasks</th>
                <th>Pending</th>
                <th>Completed</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.designation}>
                  <td>{row.designation}</td>
                  <td>{row.officerCount}</td>
                  <td>{row.total}</td>
                  <td>{row.pending}</td>
                  <td>{row.completed}</td>
                  <td>
                    <span className={`status ${row.overdue > 0 ? "overdue" : "completed"}`}>
                      {row.overdue}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No tasks available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
