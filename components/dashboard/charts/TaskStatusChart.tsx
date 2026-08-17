"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

import { Pie } from "react-chartjs-2";
import { apiFetch } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend
);

const defaultData = {
  labels: ["Completed", "Pending", "Overdue"],
  data: [0, 0, 0],
};

export default function TaskStatusChart() {
  const [chart, setChart] = useState(defaultData);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ labels: string[]; data: number[] }>(
        "/api/dashboard/task-status"
      );
      setChart(data);
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

  const data = {
    labels: chart.labels,
    datasets: [
      {
        data: chart.data,
        backgroundColor: [
          "#22c55e",
          "#facc15",
          "#ef4444",
        ],
        borderWidth: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          boxWidth: 18,
          font: {
            size: 14,
          },
        },
      },
    },
  };

  return (
    <div className="chart-card">
      <h3>Task Status</h3>

      <div className="chart-wrap">
        <Pie data={data} options={options} />
      </div>
    </div>
  );
}
