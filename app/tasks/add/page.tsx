"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import TopSearchBar from "@/components/TopSearchBar";
import { apiFetch, getRole, type ApiUser } from "@/lib/api";
import {
  enqueueTaskCreate,
  isBrowserOffline,
  isNetworkError,
} from "@/lib/offline";
import DesignationAutocomplete from "@/components/DesignationAutocomplete";
import "../tasks.css";
import "./add.css";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AddTaskPage() {
  const router = useRouter();

  const [date, setDate] = useState("");
  const [taskName, setTaskName] = useState("");
  const [designation, setDesignation] = useState("");
  const [status, setStatus] = useState("Pending");
  const [dueDays, setDueDays] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (getRole() !== "ADMIN") {
      router.replace("/tasks");
    }
  }, [router]);

  const handleDueDaysChange = (value: string) => {
    setDueDays(value);
    if (value.trim() && date) {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n) && n >= 0) {
        setDueDate(addDays(date, n));
      }
    }
  };

  const handleDateChange = (value: string) => {
    setDate(value);
    if (dueDays.trim() && value) {
      const n = parseInt(dueDays, 10);
      if (!Number.isNaN(n) && n >= 0) {
        setDueDate(addDays(value, n));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskName || !designation || !date) {
      alert("Please fill Date, Task Name and Designation");
      return;
    }

    const effectiveDueDate = dueDate || date;
    const clientRequestId = crypto.randomUUID();
    const payload = {
      clientRequestId,
      title: taskName,
      description: description || null,
      date,
      dueDate: effectiveDueDate,
      designation,
      status: status as "Pending" | "Completed",
    };

    if (isBrowserOffline()) {
      setSaving(true);
      try {
        await enqueueTaskCreate(payload);
        alert("Saved offline. It will sync automatically when you are back online.");
        router.push("/tasks");
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save task offline");
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const officerData = await apiFetch<{ user: ApiUser }>(
        "/api/users/ensure-by-designation",
        {
          method: "POST",
          body: JSON.stringify({ designation }),
        }
      );

      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          date: payload.date,
          dueDate: payload.dueDate,
          remarks: null,
          officerId: officerData.user.id,
          status: payload.status,
          clientRequestId,
        }),
      });
      alert("Task Saved Successfully!");
      router.push("/tasks");
    } catch (err) {
      if (isNetworkError(err)) {
        try {
          await enqueueTaskCreate(payload);
          alert("Connection lost. Task saved offline and will sync when back online.");
          router.push("/tasks");
          return;
        } catch (offlineErr) {
          alert(
            offlineErr instanceof Error
              ? offlineErr.message
              : "Failed to save task offline"
          );
        }
      } else {
        alert(err instanceof Error ? err.message : "Failed to save task");
      }
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <div className="tasks-layout">
        <Sidebar />

        <main className="tasks-content">

          <div className="top-navbar">
            <TopSearchBar />
          </div>

          <div className="add-task-page">

            <h1>Add New Task</h1>

            <form className="task-form" onSubmit={handleSubmit}>

              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => handleDateChange(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Task Name</label>
                <input
                  type="text"
                  placeholder="Track Repair"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Designation</label>
                <DesignationAutocomplete
                  value={designation}
                  onChange={setDesignation}
                  placeholder="Type to search designation"
                />
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option>Pending</option>
                  <option>Completed</option>
                </select>
              </div>

              <div className="form-group">
                <label>Due In (Days)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 7"
                  value={dueDays}
                  onChange={(e) => handleDueDaysChange(e.target.value)}
                />
                <span className="form-hint">
                  Auto-calculates the due date from the task date.
                </span>
              </div>

              <div className="form-group">
                <label>Due Date (Manual)</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setDueDays("");
                  }}
                />
                <span className="form-hint">
                  Optional. Picking a date manually overrides the days calculation.
                </span>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows={5}
                  placeholder="Enter task description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="button-group">

                <button
                  type="submit"
                  className="save-btn"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Task"}
                </button>

                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => router.push("/tasks")}
                >
                  Cancel
                </button>

              </div>

            </form>

          </div>

        </main>
      </div>
    </AuthGuard>
  );
}
