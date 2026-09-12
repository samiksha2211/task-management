"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getRole, type ApiTask } from "@/lib/api";
import DesignationAutocomplete from "@/components/DesignationAutocomplete";

export default function TaskEditForm({ id }: { id?: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [taskName, setTaskName] = useState("");
  const [designation, setDesignation] = useState("");
  const [status, setStatus] = useState("Pending");
  const [dueDays, setDueDays] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!id) return;
    if (getRole() !== "ADMIN") {
      router.replace("/tasks");
      return;
    }

    let cancelled = false;
    apiFetch<{ task: ApiTask }>(`/api/tasks/${id}`)
      .then(({ task }) => {
        if (cancelled) return;
        const t = task;
        setDate(t.date.slice(0, 10));
        setTaskName(t.title);
        setDesignation(t.officer.designation);
        setStatus(t.status === "Overdue" ? "Pending" : t.status);
        setDueDate(t.dueDate.slice(0, 10));
        setDescription(t.description ?? "");
        setRemarks(t.remarks ?? "");
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
  }, [id, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskName || !designation || !date) {
      alert("Please fill Date, Task Name and Designation");
      return;
    }

    const effectiveDueDate = dueDate || date;

    setSaving(true);
    try {
      const officerData = await apiFetch<{ user: { id: string } }>(
        "/api/users/ensure-by-designation",
        {
          method: "POST",
          body: JSON.stringify({ designation }),
        }
      );

      await apiFetch(`/api/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: taskName,
          description: description || null,
          date,
          dueDate: effectiveDueDate,
          remarks: remarks || null,
          officerId: officerData.user.id,
          status,
        }),
      });
      alert("Task Updated Successfully!");
      router.push("/tasks");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update task");
      setSaving(false);
    }
  };

  const handleDueDaysChange = (value: string) => {
    setDueDays(value);
    if (value.trim() && date) {
      const n = parseInt(value, 10);
      const d = new Date(`${date}T00:00:00`);
      d.setDate(d.getDate() + n);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      if (!Number.isNaN(n) && n >= 0) setDueDate(`${y}-${m}-${day}`);
    }
  };

  const handleDateChange = (value: string) => {
    setDate(value);
    if (dueDays.trim() && value) {
      const n = parseInt(dueDays, 10);
      const d = new Date(`${value}T00:00:00`);
      d.setDate(d.getDate() + n);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      if (!Number.isNaN(n) && n >= 0) setDueDate(`${y}-${m}-${day}`);
    }
  };

  if (!id) {
    return (
      <div className="add-task-page">
        <p className="table-status table-error">No task id provided.</p>
        <div className="button-group">
          <button type="button" className="cancel-btn" onClick={() => router.push("/tasks")}>
            Back to Tasks
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="table-status">Loading task...</p>;
  }

  if (error) {
    return (
      <div className="add-task-page">
        <p className="table-status table-error">{error}</p>
        <div className="button-group">
          <button type="button" className="cancel-btn" onClick={() => router.push("/tasks")}>
            Back to Tasks
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="add-task-page">

      <h1>Edit Task</h1>

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
          <label>Remarks</label>
          <textarea
            rows={3}
            placeholder="Enter remarks..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
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
            {saving ? "Saving..." : "Update Task"}
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
  );
}
