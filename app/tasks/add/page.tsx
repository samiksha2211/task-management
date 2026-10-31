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
import MultiDesignationSelect from "@/components/MultiDesignationSelect";
import { PendingAttachmentsField } from "@/components/attachments/Attachments";
import WordCount from "@/components/WordCount";
import { WORD_LIMIT, countWords, overWordLimit } from "@/lib/wordLimit";
import { EMPTY_PENDING, hasPending, uploadPending, type PendingAttachments } from "@/lib/attachments";
import ScheduleFields, {
  EMPTY_SCHEDULE,
  scheduleBody,
  type ScheduleValue,
} from "@/components/meetings/ScheduleFields";
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
  const [additionalDesignations, setAdditionalDesignations] = useState<string[]>([]);
  const [status, setStatus] = useState("Pending");
  const [dueDays, setDueDays] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [actionPlans, setActionPlans] = useState<string[]>([""]);
  const [actionPlanTdc, setActionPlanTdc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachments>(EMPTY_PENDING);
  // Every new task is reviewed weekly (W) by default; it can be changed later.
  const [schedule, setSchedule] = useState<ScheduleValue>({ ...EMPTY_SCHEDULE, cycle: "WEEKLY" });

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

  const updateActionPlan = (index: number, value: string) => {
    setActionPlans((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addActionPlan = () => {
    setActionPlans((prev) => [...prev, ""]);
  };

  const removeActionPlan = (index: number) => {
    setActionPlans((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length ? updated : [""];
    });
  };

  // All action plan lines together; the 60-word limit applies to the whole plan.
  const actionPlanText = actionPlans.map((plan) => plan.trim()).filter(Boolean).join("\n");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskName || !designation || !date) {
      alert("Please fill Date, Task Name and Designation");
      return;
    }

    if (overWordLimit(actionPlanText)) {
      alert(`Action Plan can be at most ${WORD_LIMIT} words (currently ${countWords(actionPlanText)}). Please shorten it.`);
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
       additionalDesignations:
    additionalDesignations.filter(
      (d) => d !== designation
      ),
      status: status as "Pending" | "Completed",
      ...scheduleBody(schedule),
    };

    if (isBrowserOffline()) {
      if (
        hasPending(attachments) &&
        !window.confirm("You are offline, so attachments cannot be saved. Save the task without them?")
      ) {
        return;
      }
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
      // DRM attachments: files are uploaded first, then saved with the task.
      const attachmentPayload = await uploadPending(attachments);
      const officerData = await apiFetch<{ user: ApiUser }>(
        "/api/users/ensure-by-designation",
        {
          method: "POST",
          body: JSON.stringify({ designation }),
        }
      );
      const additionalOfficerData = await Promise.all(
      additionalDesignations
      .filter((d) => d !== designation)
      .map((additionalDesignation) =>
      apiFetch<{ user: ApiUser }>(
        "/api/users/ensure-by-designation",
        {
          method: "POST",
          body: JSON.stringify({
            designation: additionalDesignation,
          }),
        }
      )
    )
);

const additionalOfficerIds = additionalOfficerData.map(
  (item) => item.user.id
);

      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          date: payload.date,
          dueDate: payload.dueDate,
          actionPlan:
            actionPlans.map((plan) => plan.trim()).filter(Boolean).join("\n") || null,
          actionPlanTdc: actionPlanTdc || null,
          remarks: remarks || null,
          officerId: officerData.user.id,
          additionalOfficerIds,
          status: payload.status,
          ...scheduleBody(schedule),
          attachments: attachmentPayload,
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

              <section className="form-section">
                <h2 className="form-section-title">Task details</h2>

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
                  <label>Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => handleDateChange(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    rows={4}
                    placeholder="Enter task description..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </section>

              <section className="form-section">
                <h2 className="form-section-title">Assignment and target</h2>

                <div className="form-group">
                  <label>Designation</label>
                  <DesignationAutocomplete
                    value={designation}
                    onChange={setDesignation}
                    placeholder="Type to search designation"
                  />
                </div>

                <div className="form-group">
                  <label>Also Assigned To</label>
                  <MultiDesignationSelect
                    value={additionalDesignations}
                    onChange={setAdditionalDesignations}
                    exclude={designation}
                  />
                  <span className="form-hint">
                    Optional. Select one or more additional officers.
                  </span>
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
                  <label>Execution TDC (Manual)</label>
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
              </section>

              <section className="form-section">
                <h2 className="form-section-title">Monday review</h2>
                <ScheduleFields value={schedule} onChange={setSchedule} />
                <span className="form-hint">
                  New tasks are reviewed weekly (W) by default, so they come up at the next Monday meeting.
                  Change to FT or M here or later.
                </span>
              </section>

              <section className="form-section">
                <h2 className="form-section-title">Action plan, remarks and attachments</h2>

                <div className="form-group">
                  <label>Action Plan</label>
                  {actionPlans.map((plan, index) => (
                    <div key={index} className="array-field-row">
                      <textarea
                        rows={3}
                        placeholder={`Action Plan ${index + 1}`}
                        value={plan}
                        onChange={(e) => updateActionPlan(index, e.target.value)}
                      />
                      {actionPlans.length > 1 && (
                        <button type="button" onClick={() => removeActionPlan(index)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <WordCount text={actionPlanText} />
                  <button type="button" onClick={addActionPlan}>
                    + Add Action Plan
                  </button>
                </div>

                <div className="form-group">
                  <label>Action Plan TDC</label>
                  <input
                    type="date"
                    value={actionPlanTdc}
                    onChange={(e) => setActionPlanTdc(e.target.value)}
                  />
                  <span className="form-hint">
                    Action Plan TDC is decided by DRM.
                  </span>
                </div>

                <div className="form-group">
                  <label>DRM Remarks</label>
                  <textarea
                    rows={3}
                    placeholder="Enter remarks..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>DRM Attachments</label>
                  <PendingAttachmentsField value={attachments} onChange={setAttachments} />
                </div>
              </section>

              <div className="button-group">

                <button
                  type="submit"
                  className="save-btn"
                  disabled={saving || overWordLimit(actionPlanText)}
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
