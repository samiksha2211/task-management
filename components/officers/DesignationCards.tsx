"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, type ApiTask, type ApiUser } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

type DesignationGroup = {
  designation: string;
  officers: ApiUser[];
};

export default function DesignationCards() {
  const [groups, setGroups] = useState<DesignationGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasksByOfficer, setTasksByOfficer] = useState<Record<string, ApiTask[]>>(
    {}
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, tasksData] = await Promise.all([
        apiFetch<{ users: ApiUser[] }>("/api/users"),
        apiFetch<{ tasks: ApiTask[] }>("/api/tasks?limit=10000"),
      ]);

      const map = new Map<string, ApiUser[]>();
      for (const user of usersData.users) {
        const key = user.designation || "Unassigned";
        const arr = map.get(key) ?? [];
        arr.push(user);
        map.set(key, arr);
      }
      const grouped: DesignationGroup[] = [];
      for (const [designation, officers] of map.entries()) {
        officers.sort((a, b) => a.name.localeCompare(b.name));
        grouped.push({ designation, officers });
      }
      grouped.sort((a, b) => a.designation.localeCompare(b.designation));
      setGroups(grouped);

      const byOfficer: Record<string, ApiTask[]> = {};
      for (const task of tasksData.tasks) {
        const arr = byOfficer[task.officer.id] ?? [];
        arr.push(task);
        byOfficer[task.officer.id] = arr;
      }
      for (const key of Object.keys(byOfficer)) {
        byOfficer[key].sort((a, b) => a.title.localeCompare(b.title));
      }
      setTasksByOfficer(byOfficer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load officers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored", "user:updated", "user:deleted"],
    () => void load()
  );

  const handleToggleStatus = async (task: ApiTask) => {
    const nextStatus = task.status === "Completed" ? "Pending" : "Completed";
    try {
      await apiFetch(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setTasksByOfficer((prev) => {
        const current: ApiTask[] = (prev[task.officer.id] ?? []).map((t) =>
          t.id === task.id ? { ...t, status: nextStatus } : t
        );
        return { ...prev, [task.officer.id]: current };
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update task");
    }
  };

  if (loading) {
    return <p className="table-status">Loading designations...</p>;
  }

  if (error) {
    return <p className="table-status table-error">{error}</p>;
  }

  const countDesignationTasks = (group: DesignationGroup): number =>
    group.officers.reduce(
      (acc, officer) =>
        acc +
        (tasksByOfficer[officer.id] ?? []).filter(
          (t) => t.status !== "Completed"
        ).length,
      0
    );

  const visibleGroups = groups.filter((group) => countDesignationTasks(group) > 0);

  return (
    <div className="officers-page">
      <div className="page-header">
        <h1 className="page-title">Designation</h1>
      </div>

      <div className="designation-grid">
        {visibleGroups.map((group) => (
          <div className="designation-card" key={group.designation}>
            <div className="designation-header">
              <Link
                href={`/tasks?search=${encodeURIComponent(group.designation)}`}
                className="designation-title-link"
                title={`View tasks for ${group.designation}`}
              >
                <h2>{group.designation}</h2>
              </Link>
            </div>

            <div className="designation-body">
              {group.officers
                .filter(
                  (officer) =>
                    (tasksByOfficer[officer.id] ?? []).filter(
                      (t) => t.status !== "Completed"
                    ).length > 0
                )
                .map((officer) => (
                <div className="officer-block" key={officer.id}>
                  <Link
                    href={`/tasks?search=${encodeURIComponent(officer.designation)}`}
                    className="officer-row officer-row-link"
                    title={`View tasks for ${officer.designation}`}
                  >
                    <div className="officer-avatar">
                      {officer.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={officer.avatar} alt={officer.name} className="officer-avatar-img" />
                      ) : (
                        officer.designation.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="officer-info">
                      <span className="officer-name">{officer.designation}</span>
                    </div>
                    <span className="officer-task-count" title="Assigned tasks">
                      {
                        (tasksByOfficer[officer.id] ?? []).filter(
                          (t) => t.status !== "Completed"
                        ).length
                      }{" "}
                      task
                      {(tasksByOfficer[officer.id] ?? []).filter(
                        (t) => t.status !== "Completed"
                      ).length === 1
                        ? ""
                        : "s"}
                    </span>
                  </Link>

                  {(tasksByOfficer[officer.id] ?? []).length > 0 && (
                    <div className="officer-tasks">
                      {(tasksByOfficer[officer.id] ?? []).map((task) => (
                        <label
                          className="officer-task"
                          key={task.id}
                          title={
                            task.status === "Completed"
                              ? "Mark as Pending"
                              : "Mark as Completed"
                          }
                        >
                          <input
                            type="checkbox"
                            className="officer-task-checkbox"
                            checked={task.status === "Completed"}
                            onChange={() => handleToggleStatus(task)}
                          />
                          <span
                            className={`officer-task-title${
                              task.status === "Completed" ? " done" : ""
                            }`}
                          >
                            {task.title}
                          </span>
                          <span className={`status ${task.status.toLowerCase()}`}>
                            {task.status}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="designation-footer">
              <span className="designation-count">
                {countDesignationTasks(group)} task
                {countDesignationTasks(group) === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        ))}

        {visibleGroups.length === 0 && (
          <p className="table-status">No officers found.</p>
        )}
      </div>
    </div>
  );
}