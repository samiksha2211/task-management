"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getRole, type ApiAttachment, type ApiTask } from "@/lib/api";
import {
  EMPTY_PENDING,
  addAttachments,
  hasPending,
  removeAttachment,
  uploadPending,
  type PendingAttachments,
} from "@/lib/attachments";
import { AttachmentManager, PendingAttachmentsField } from "@/components/attachments/Attachments";
import DesignationAutocomplete from "@/components/DesignationAutocomplete";
import MultiDesignationSelect from "@/components/MultiDesignationSelect";
import ScheduleFields, {
  EMPTY_SCHEDULE,
  scheduleBody,
  type ScheduleValue,
} from "@/components/meetings/ScheduleFields";

export default function TaskEditForm({ id }: { id?: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [taskName, setTaskName] = useState("");
  const [designation, setDesignation] = useState("");
  const [additionalDesignations, setAdditionalDesignations] = useState<string[]>([]);
  const [drmAttachments, setDrmAttachments] = useState<ApiAttachment[]>([]);
  const [status, setStatus] = useState("Pending");
  const [dueDays, setDueDays] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");
  const [actionPlans, setActionPlans] = useState<string[]>([""]);
  const [actionPlanTdc, setActionPlanTdc] = useState("");
  const [schedule, setSchedule] = useState<ScheduleValue>(EMPTY_SCHEDULE);
  const [initialSchedule, setInitialSchedule] = useState<ScheduleValue>(EMPTY_SCHEDULE);
  const [nextDiscussionDate, setNextDiscussionDate] = useState<string | null>(null);
  type BoRemarkItem = {
  id?: string;
  remark: string;
  // Saved attachments of an existing BO entry
  attachments: ApiAttachment[];
  // Files/links chosen for a new BO entry, sent when the task is saved
  pending: PendingAttachments;
};

 const [boRemarks, setBoRemarks] = useState<BoRemarkItem[]>([
  { remark: "", attachments: [], pending: EMPTY_PENDING },
  ]);

  // After an attachment is added or removed, show what the server saved.
  const applyTask = (t: ApiTask) => {
    setDrmAttachments(t.attachments ?? []);
    setBoRemarks((prev) =>
      prev.map((item) =>
        item.id
          ? { ...item, attachments: t.officerUpdates.find((u) => u.id === item.id)?.attachments ?? [] }
          : item
      )
    );
  };
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
        setAdditionalDesignations(
          (t.additionalAssignees ?? []).map((a) => a.designation)
        );
        setDrmAttachments(t.attachments ?? []);
        setStatus(t.status === "Overdue" ? "Pending" : t.status);
        setDueDate(t.dueDate.slice(0, 10));
        setDescription(t.description ?? "");
        setRemarks(t.remarks ?? "");
        const loadedSchedule: ScheduleValue = {
          cycle: t.discussionFrequency ?? "",
          monthlyMondayOrdinal: t.monthlyMondayOrdinal ?? 1,
          fortnightAnchor: t.fortnightAnchor ?? "",
        };
        setSchedule(loadedSchedule);
        setInitialSchedule(loadedSchedule);
        setNextDiscussionDate(t.nextDiscussionDate ?? null);
        setActionPlanTdc(
          t.actionPlanTdc ? t.actionPlanTdc.slice(0, 10) : "" );
       

          setActionPlans(
            t.actionPlan
              ? t.actionPlan
                  .split("\n")
                  .map((plan) => plan.trim())
                  .filter(Boolean)
              : [""]
              );

            setBoRemarks(
              t.officerUpdates?.some((u) => u.remark?.trim() || u.attachments?.length)
              ? t.officerUpdates
              .filter((u) => u.remark?.trim() || u.attachments?.length)
              .map((u) => ({
              id: u.id,
              remark: u.remark ?? "",
              attachments: u.attachments ?? [],
              pending: EMPTY_PENDING,
              }))
              : [{ remark: "", attachments: [], pending: EMPTY_PENDING }]
              );
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
  const updateActionPlan = (index: number, value: string) => {
  setActionPlans((prev) =>
    prev.map((item, i) => (i === index ? value : item))
  );
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

const updateBoRemark = (
  index: number,
  value: string
) => {
  setBoRemarks((prev) =>
    prev.map((item, i) =>
      i === index
        ? { ...item, remark: value }
        : item
    )
  );
};

const setBoPending = (index: number, pending: PendingAttachments) => {
  setBoRemarks((prev) =>
    prev.map((item, i) => (i === index ? { ...item, pending } : item))
  );
};

const addBoRemark = () => {
  setBoRemarks((prev) => [
    ...prev,
    { remark: "", attachments: [], pending: EMPTY_PENDING },
  ]);
};

const removeBoRemark = async (index: number) => {
  const item = boRemarks[index];

  // New unsaved remark: only remove from screen
  if (!item.id) {
    setBoRemarks((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length
        ? updated
        : [{ remark: "", attachments: [], pending: EMPTY_PENDING }];
    });
    return;
  }

  if (!id) return;

  if (!window.confirm("Remove this BO Remark?")) {
    return;
  }

  try {
    await apiFetch(
      `/api/tasks/${id}/officer-updates/${item.id}`,
      {
        method: "DELETE",
      }
    );

    setBoRemarks((prev) => {
      const updated = prev.filter((_, i) => i !== index);

      return updated.length
        ? updated
        : [{ remark: "", attachments: [], pending: EMPTY_PENDING }];
    });
  } catch (err) {
    alert(
      err instanceof Error
        ? err.message
        : "Failed to remove BO Remark"
    );
  }
  };
  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!id) {
    alert("Task ID is missing");
    return;
  }

  if (!taskName || !designation || !date) {
    alert("Please fill Date, Task Name and Designation");
    return;
  }

  const effectiveDueDate = dueDate || date;

  setSaving(true);

  try {
    // 1. Find/create Co-ordinator Officer
    const officerData = await apiFetch<{
      user: { id: string };
    }>("/api/users/ensure-by-designation", {
      method: "POST",
      body: JSON.stringify({
        designation,
      }),
    });

    // Other officers (pre-filled with the current ones, so saving keeps them)
    const additionalOfficerData = await Promise.all(
      additionalDesignations
        .filter((d) => d !== designation)
        .map((additionalDesignation) =>
          apiFetch<{ user: { id: string } }>("/api/users/ensure-by-designation", {
            method: "POST",
            body: JSON.stringify({ designation: additionalDesignation }),
          })
        )
    );
    const additionalOfficerIds = additionalOfficerData.map((item) => item.user.id);

    // DRM attachments are saved as soon as they are added or removed.

    // 2. Prepare Action Plan
    const finalActionPlan =
      actionPlans
        .map((plan) => plan.trim())
        .filter(Boolean)
        .join("\n") || null;

    // Only changed scheduling fields are sent, so saving other edits never
    // recalculates the meeting schedule.
    const nextSchedule = scheduleBody(schedule);
    const prevSchedule = scheduleBody(initialSchedule);
    const scheduleChanges =
      nextSchedule.discussionFrequency !== prevSchedule.discussionFrequency ||
      nextSchedule.monthlyMondayOrdinal !== prevSchedule.monthlyMondayOrdinal ||
      nextSchedule.fortnightAnchor !== prevSchedule.fortnightAnchor
        ? nextSchedule
        : {};

    // 3. Update the task
    const result = await apiFetch<{
      task: ApiTask;
    }>(`/api/tasks/${id}`, {
      method: "PUT",

      body: JSON.stringify({
        title: taskName,
        description: description || null,

        date,
        dueDate: effectiveDueDate,

        // Action Plan
        actionPlan: finalActionPlan,

        // Action Plan TDC
        actionPlanTdc:
          actionPlanTdc || null,

        // DRM Remark
        remarks: remarks || null,

        // Co-ordinator Officer
        officerId: officerData.user.id,
        additionalOfficerIds,

        status,
        ...scheduleChanges,
      }),
    });
    // 4. Save BO Remarks
for (const item of boRemarks) {
  const remark = item.remark.trim();

  // Existing BO Remark (its attachments are saved as they are added/removed)
  if (item.id) {
    await apiFetch(
      `/api/tasks/${id}/officer-updates/${item.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          remark: remark || null,
        }),
      }
    );

    continue;
  }

  // New BO Remark and/or attachments
  if (remark || hasPending(item.pending)) {
    const attachments = await uploadPending(item.pending, "/api/tasks/officer-update/upload");
    await apiFetch(
      `/api/tasks/${id}/officer-updates`,
      {
        method: "POST",
        body: JSON.stringify({
          remark: remark || null,
          attachments,
        }),
      }
    );
  }
}
    console.log(
      "Updated task received from API:",
      result.task
    );

    alert("Task Updated Successfully!");

    // Go back to Task Management
    router.push("/tasks");

  } catch (err) {
    console.error("Task update failed:", err);

    alert(
      err instanceof Error
        ? err.message
        : "Failed to update task"
    );
  } finally {
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

        <ScheduleFields
          value={schedule}
          onChange={setSchedule}
          nextDiscussionDate={nextDiscussionDate}
        />

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
        <button
          type="button"
          onClick={() => removeActionPlan(index)}
        >
          Remove
        </button>
      )}
    </div>
  ))}

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
          {id && (
            <AttachmentManager
              attachments={drmAttachments}
              canEdit
              onAdd={async (pending) => applyTask(await addAttachments(id, pending))}
              onRemove={async (a) => applyTask(await removeAttachment(id, a.id))}
            />
          )}
          <span className="form-hint">Attachments are saved as soon as you add or remove them.</span>
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

        <div className="form-group">
  <label>BO&apos;s Remarks</label>

  {boRemarks.map((remark, index) => (
    <div key={index} className="array-field-row">
      <textarea
        rows={3}
        placeholder={`BO's Remark ${index + 1}`}
        value={remark.remark}
        onChange={(e) => updateBoRemark(index, e.target.value)}
      />

      <div className="bo-attachment-field">
        <label>BO&apos;s Attachments</label>
        {remark.id && id ? (
          <AttachmentManager
            attachments={remark.attachments}
            canEdit
            onAdd={async (pending) => applyTask(await addAttachments(id, pending, remark.id))}
            onRemove={async (a) => applyTask(await removeAttachment(id, a.id))}
          />
        ) : (
          <>
            <PendingAttachmentsField value={remark.pending} onChange={(p) => setBoPending(index, p)} />
            <span className="form-hint">Saved with this BO remark when you save the task.</span>
          </>
        )}
      </div>

      {boRemarks.length > 1 && (
        <button
          type="button"
          onClick={() => removeBoRemark(index)}
        >
          Remove
        </button>
      )}
    </div>
  ))}

  <button type="button" onClick={addBoRemark}>
    + Add BO&apos;s Remark
  </button>
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
