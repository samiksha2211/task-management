"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, formatDate, getRole, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

export default function TaskView({ id }: { id?: string }) {
  const router = useRouter();

  const [task, setTask] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [actionPlan, setActionPlan] = useState("");
  const [boRemark, setBoRemark] = useState("");
  const [boAttachment, setBoAttachment] = useState<File | null>(null);

  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const isAdmin = getRole() === "ADMIN";

  // --------------------------------------------------
  // LOAD TASK
  // --------------------------------------------------

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    apiFetch<{ task: ApiTask }>(`/api/tasks/${id}`)
      .then((data) => {
        if (!cancelled) {
          setTask(data.task);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load task"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // --------------------------------------------------
  // RELOAD TASK
  // --------------------------------------------------

  const reload = useCallback(async () => {
    if (!id) return;

    try {
      const data = await apiFetch<{ task: ApiTask }>(
        `/api/tasks/${id}`
      );

      setTask(data.task);
    } catch {
      // Keep current task on screen if reload fails
    }
  }, [id]);

  // --------------------------------------------------
  // REALTIME REFRESH
  // --------------------------------------------------

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored"],
    () => void reload()
  );

  // --------------------------------------------------
  // DELETE TASK - ADMIN
  // --------------------------------------------------

  const handleDelete = async () => {
    if (!task) return;

    const confirmed = window.confirm(
      "Delete this task? It can be restored later from the Recycle Bin."
    );

    if (!confirmed) return;

    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: "DELETE",
      });

      router.push("/tasks");
    } catch (e) {
      alert(
        e instanceof Error ? e.message : "Failed to delete task"
      );
    }
  };

  // --------------------------------------------------
  // CHANGE TASK STATUS
  // --------------------------------------------------

  const handleToggleStatus = async () => {
    if (!task) return;

    const next =
      task.status === "Completed" ? "Pending" : "Completed";

    try {
      const data = await apiFetch<{ task: ApiTask }>(
        `/api/tasks/${task.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: next,
          }),
        }
      );

      setTask(data.task);
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "Failed to update status"
      );
    }
  };

  // --------------------------------------------------
  // SUBMIT BO UPDATE
  // --------------------------------------------------

  const handleOfficerUpdate = async () => {
    if (!task) return;

    if (
      !actionPlan.trim() &&
      !boRemark.trim() &&
      !boAttachment
    ) {
      setUpdateError(
        "Please enter an Action Plan, BO's Remark, or select an attachment."
      );
      return;
    }

    setSubmittingUpdate(true);
    setUpdateError(null);

    try {
      let attachmentUrl: string | null = null;
      let attachmentName: string | null = null;
      let attachmentType: string | null = null;

      // Upload BO attachment first
      if (boAttachment) {
        const formData = new FormData();
        formData.append("file", boAttachment);

        const uploaded = await apiFetch<{
          attachmentUrl: string;
          attachmentName: string;
          attachmentType: string;
        }>("/api/tasks/officer-update/upload", {
          method: "POST",
          body: formData,
        });

        attachmentUrl = uploaded.attachmentUrl;
        attachmentName = uploaded.attachmentName;
        attachmentType = uploaded.attachmentType;
      }

      // Save Action Plan + BO Remark + Attachment
      const data = await apiFetch<{ task: ApiTask }>(
        `/api/tasks/${task.id}/officer-updates`,
        {
          method: "POST",
          body: JSON.stringify({
            actionPlan: actionPlan.trim() || null,
            remark: boRemark.trim() || null,
            attachmentUrl,
            attachmentName,
            attachmentType,
          }),
        }
      );

      if (data.task) {
        setTask(data.task);
      } else {
        await reload();
      }

      // Clear form after successful submission
      setActionPlan("");
      setBoRemark("");
      setBoAttachment(null);

      alert("BO update submitted successfully.");
    } catch (e) {
      setUpdateError(
        e instanceof Error
          ? e.message
          : "Failed to submit BO update."
      );
    } finally {
      setSubmittingUpdate(false);
    }
  };

  // --------------------------------------------------
  // NO TASK ID
  // --------------------------------------------------

  if (!id) {
    return (
      <div className="task-detail-card">
        <h1 className="task-detail-error">
          Task Details
        </h1>

        <p className="table-status table-error">
          No task id provided.
        </p>

        <div className="task-detail-actions">
          <Link href="/tasks" className="btn-back">
            ← Back to Tasks
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <p className="table-status">
        Loading task...
      </p>
    );
  }

  // --------------------------------------------------
  // ERROR
  // --------------------------------------------------

  if (error || !task) {
    return (
      <div className="task-detail-card">
        <h1 className="task-detail-error">
          Task Details
        </h1>

        <p className="table-status table-error">
          {error || "Task not found."}
        </p>

        <div className="task-detail-actions">
          <Link href="/tasks" className="btn-back">
            ← Back to Tasks
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // TASK DETAIL ROWS
  // --------------------------------------------------

  const rows = [
    {
      label: "Task",
      value: task.title,
    },
    {
      label: "Date",
      value: formatDate(task.date),
    },
    {
      label: "Co-ordinator Officer",
      value: task.officer.designation,
    },
    {
      label: "Other Officers",
      value:
        task.additionalAssignees?.length > 0
          ? task.additionalAssignees
              .map((item) => item.designation)
              .join(", ")
          : "-",
    },
    {
      label: "Action Plan TDC",
      value: task.actionPlanTdc
        ? formatDate(task.actionPlanTdc)
        : "-",
    },
    {
      label: "Execution TDC",
      value: formatDate(task.dueDate),
    },
    {
      label: "DRM Remark",
      value: task.remarks || "-",
    },
  ];

  // --------------------------------------------------
  // MAIN UI
  // --------------------------------------------------

  return (
    <div className="task-detail-card">

      <div className="task-detail-header">
        <h1>Task Details</h1>

        <span
          className={`status ${task.status.toLowerCase()}`}
        >
          {task.status}
        </span>
      </div>

      {/* TASK DETAILS */}

      <div className="task-detail-grid">
        {rows.map((row) => (
          <div
            className="task-detail-row"
            key={row.label}
          >
            <div className="task-detail-label">
              {row.label}
            </div>

            <div className="task-detail-value">
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {/* TASK DESCRIPTION */}

      <div className="task-detail-description">
        <div className="task-detail-label">
          Task Description
        </div>

        <p>
          {task.description ||
            "No description provided."}
        </p>
      </div>

      {/* PREVIOUS BO UPDATES */}

      {task.officerUpdates &&
        task.officerUpdates.length > 0 && (
          <div className="bo-response-section">

            <h2>BO Updates</h2>

            {task.officerUpdates.map((update) => (
              <div
                className="bo-update-card"
                key={update.id}
              >

                <div>
                  <strong>Officer:</strong>{" "}
                  {update.officer.designation}
                </div>

                <div>
                  <strong>Action Plan:</strong>{" "}
                  {update.actionPlan || "-"}
                </div>

                <div>
                  <strong>BO&apos;s Remark:</strong>{" "}
                  {update.remark || "-"}
                </div>

                <div>
                  <strong>Date:</strong>{" "}
                  {new Date(
                    update.createdAt
                  ).toLocaleString("en-GB")}
                </div>

                {update.attachmentUrl && (
                  <div>
                    <strong>Attachment:</strong>{" "}

                    <a
                      href={`http://localhost:4000${update.attachmentUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {update.attachmentName ||
                        "View Attachment"}
                    </a>
                  </div>
                )}

              </div>
            ))}

          </div>
        )}

      {/* BO RESPONSE - OFFICER ONLY */}

      {!isAdmin && (
        <div className="bo-response-section">

          <h2>BO Response</h2>

          <div className="bo-response-field">
            <label htmlFor="actionPlan">
              Action Plan
            </label>

            <textarea
              id="actionPlan"
              value={actionPlan}
              onChange={(e) =>
                setActionPlan(e.target.value)
              }
              placeholder="Enter action plan"
              rows={4}
            />
          </div>

          <div className="bo-response-field">
            <label htmlFor="boRemark">
              BO&apos;s Remark
            </label>

            <textarea
              id="boRemark"
              value={boRemark}
              onChange={(e) =>
                setBoRemark(e.target.value)
              }
              placeholder="Enter BO's remark"
              rows={4}
            />
          </div>

          <div className="bo-response-field">
            <label htmlFor="boAttachment">
              Attachment
            </label>

            <input
              id="boAttachment"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                const file =
                  e.target.files?.[0] ?? null;

                if (
                  file &&
                  file.size > 10 * 1024 * 1024
                ) {
                  setUpdateError(
                    "Attachment must be 10 MB or smaller."
                  );

                  e.target.value = "";
                  setBoAttachment(null);
                  return;
                }

                setUpdateError(null);
                setBoAttachment(file);
              }}
            />

            {boAttachment && (
              <p>
                Selected:{" "}
                <strong>
                  {boAttachment.name}
                </strong>
              </p>
            )}
          </div>

          {updateError && (
            <p className="table-error">
              {updateError}
            </p>
          )}

          <button
            type="button"
            className="btn-status"
            onClick={handleOfficerUpdate}
            disabled={submittingUpdate}
          >
            {submittingUpdate
              ? "Submitting..."
              : "Submit Update"}
          </button>

        </div>
      )}

      {/* ACTION BUTTONS */}

      <div className="task-detail-actions">

        {isAdmin ? (
          <>
            <Link
              href={`/tasks/edit?id=${task.id}`}
              className="btn-edit"
            >
              Edit Task
            </Link>

            <button
              onClick={handleDelete}
              className="btn-delete"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            onClick={handleToggleStatus}
            className="btn-status"
          >
            {task.status === "Completed"
              ? "Mark as Pending"
              : "Mark as Completed"}
          </button>
        )}

        <Link
          href="/tasks"
          className="btn-back"
        >
          ← Back to Tasks
        </Link>

      </div>

    </div>
  );
}