"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, type ApiTask } from "@/lib/api";
import { designationsByDepartment } from "@/lib/departments";
import { useRealtime } from "@/lib/realtime";

function tasksLink(department: string | null, designation?: string): string {
  const params = new URLSearchParams();
  if (department) params.set("department", department);
  if (designation) params.set("designation", designation);
  return `/tasks?${params.toString()}`;
}

/** All 13 departments and their BO designations, for every BO. */
export default function DepartmentDirectory() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [inUse, setInUse] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [taskData, designationData] = await Promise.all([
        apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=10000"),
        apiFetch<{ designations: string[] }>("/api/users/designations"),
      ]);
      setTasks(taskData.tasks);
      setInUse(designationData.designations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useRealtime(["task:created", "task:updated", "task:deleted", "task:restored", "user:updated", "user:deleted"], () => void load());

  /** Open tasks each designation is concerned with. */
  const openTasks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.status === "Completed") continue;
      const concerned = new Set([task.officer?.designation, ...(task.additionalAssignees ?? []).map((a) => a.designation)]);
      for (const d of concerned) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  if (loading) return <p className="table-status">Loading departments...</p>;
  if (error) return <p className="table-status table-error">{error}</p>;

  const { departments, other } = designationsByDepartment(inUse);
  const row = (department: string | null, designation: string) => (
    <li key={designation}>
      <Link href={tasksLink(department, designation)} className="dept-row">
        <span>{designation}</span>
        <span className="dept-count">{openTasks.get(designation) ?? 0} open</span>
      </Link>
    </li>
  );

  return (
    <div className="officers-page">
      <div className="page-header">
        <h1 className="page-title">Departments</h1>
      </div>
      <p className="dept-intro">
        All departments and Branch Officers. Open a designation to see its tasks, updates and remarks.
      </p>

      <div className="designation-grid">
        {departments.map(({ department, designations }) => (
          <section className="designation-card" key={department}>
            <div className="designation-header">
              <Link href={tasksLink(department)} className="designation-title-link">
                <h2>{department}</h2>
              </Link>
            </div>
            <ul className="dept-list">{designations.map((d) => row(department, d))}</ul>
          </section>
        ))}
        {other.length > 0 && (
          <section className="designation-card">
            <div className="designation-header">
              <h2>Other designations</h2>
            </div>
            <ul className="dept-list">{other.map((d) => row(null, d))}</ul>
          </section>
        )}
      </div>
    </div>
  );
}
