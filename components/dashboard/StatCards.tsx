"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Clock3,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { apiFetch, type ApiStats } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

const fallback = { total: 0, pending: 0, overdue: 0, completed: 0 };

export default function StatCards() {
  const [stats, setStats] = useState(fallback);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ApiStats>("/api/dashboard/stats");
      setStats({
        total: data.total,
        pending: data.pending,
        overdue: data.overdue,
        completed: data.completed,
      });
    } catch {
      // keep current values
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

  const statItems = [
    { title: "Total Tasks", value: stats.total, icon: ClipboardList, color: "blue", link: "/tasks" },
    { title: "Pending", value: stats.pending, icon: Clock3, color: "orange", link: "/tasks?status=pending" },
    { title: "Overdue", value: stats.overdue, icon: AlertTriangle, color: "red", link: "/tasks?status=overdue" },
    { title: "Completed", value: stats.completed, icon: CheckCircle2, color: "green", link: "/tasks?status=completed" },
  ];

  return (
    <div className="stats-grid">
      {statItems.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            href={item.link}
            className="stat-card stat-card-link"
            key={item.title}
          >
            <div className={`icon-box ${item.color}`}>
              <Icon size={40} color="white" />
            </div>

            <div className="stat-content">
              <h4>{item.title}</h4>
              <h2>{loading ? "…" : item.value}</h2>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
