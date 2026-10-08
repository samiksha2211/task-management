"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, fileUrl, getRole, type ApiTask } from "@/lib/api";
import DesignationAutocomplete from "@/components/DesignationAutocomplete";
import MultiDesignationSelect from "@/components/MultiDesignationSelect";

export default function TaskEditForm({ id }: { id?: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [taskName, setTaskName] = useState("");
  const [designation, setDesignation] = useState("");
  const [additionalDesignations, setAdditionalDesignations] = useState<string[]>([]);
  const [currentAttachment, setCurrentAttachment] = useState<{ url: string; name: string } | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [status, setStatus] = useState("Pending");
  const [dueDays, setDueDays] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");
  const [actionPlans, setActionPlans] = useState<string[]>([""]);
  const [actionPlanTdc, setActionPlanTdc] = useState("");
  type BoRemarkItem = {
  id?: string;
  remark: string;
};

 const [boRemarks, setBoRemarks] = useState<BoRemarkItem[]>([
  { remark: "" },
  ]);
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
        setCurrentAttachment(
          t.attachmentUrl
            ? { url: t.attachmentUrl, name: t.attachmentName || "View attachment" }
            : null
        );
        setStatus(t.status === "Overdue" ? "Pending" : t.status);
        setDueDate(t.dueDate.slice(0, 10));
        setDescription(t.description ?? "");
        setRemarks(t.remarks ?? "");
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
              t.officerUpdates?.some((u) => u.remark?.trim())
              ? t.officerUpdates
              .filter((u) => u.remark?.trim())
              .map((u) => ({
              id: u.id,
              remark: u.remark ?? "",
              }))
              : [{ remark: "" }]
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

const addBoRemark = () => {
  setBoRemarks((prev) => [
    ...prev,
    { remark: "" },
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
        : [{ remark: "" }];
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
        : [{ remark: "" }];
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

    // New attachment only if one was chosen; otherwise the current one is kept
    let attachmentData: {
      attachmentUrl: string;
      attachmentName: string;
      attachmentType: string;
    } | null = null;
    if (attachment) {
      const formData = new FormData();
      formData.append("file", attachment);
      attachmentData = await apiFetch<{
        attachmentUrl: string;
        attachmentName: string;
        attachmentType: string;
      }>("/api/tasks/upload", {
        method: "POST",
        body: formData,
      });
    }

    // 2. Prepare Action Plan
    const finalActionPlan =
      actionPlans
        .map((plan) => plan.trim())
        .filter(Boolean)
        .join("\n") || null;

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

        // Only present when a new file was uploaded
        ...(attachmentData ?? {}),

        status,
      }),
    });
    // 4. Save BO Remarks
for (const item of boRemarks) {
  const remark = item.remark.trim();

  // Existing BO Remark
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

  // New BO Remark
  if (remark) {
    await apiFetch(
      `/api/tasks/${id}/officer-updates`,
      {
        method: "POST",
        body: JSON.stringify({
          remark,
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
          <label>Attachment</label>
          {currentAttachment && !attachment && (
            <span className="form-hint">
              Current:{" "}
              <a href={fileUrl(currentAttachment.url)} target="_blank" rel="noopener noreferrer">
                {currentAttachment.name}
              </a>
            </span>
          )}
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setAttachment(file);
            }}
          />
          <span className="form-hint">
            PDF or image only.{currentAttachment ? " Choosing a file replaces the current one." : ""}
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

        <div className="form-group">
  <label>BO's Remarks</label>

  {boRemarks.map((remark, index) => (
    <div key={index} className="array-field-row">
      <textarea
        rows={3}
        placeholder={`BO's Remark ${index + 1}`}
        value={remark.remark}
        onChange={(e) => updateBoRemark(index, e.target.value)}
      />

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
    + Add BO's Remark
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
