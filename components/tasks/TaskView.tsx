"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, formatDate, getRole, getStoredUser, isAssignedTo, type ApiTask } from "@/lib/api";
import { inAssignedGroup } from "@/lib/departments";
import { taskDepartments } from "@/lib/departments";
import {
  EMPTY_PENDING,
  addAttachments,
  hasPending,
  removeAttachment,
  uploadPending,
  type PendingAttachments,
} from "@/lib/attachments";
import {
  AttachmentList,
  AttachmentManager,
  PendingAttachmentsField,
} from "@/components/attachments/Attachments";
import { useRealtime } from "@/lib/realtime";
import { WORD_LIMIT, overWordLimit } from "@/lib/wordLimit";
import WordCount from "@/components/WordCount";

export default function TaskView({ id }: { id?: string }) {
  const router = useRouter();

  const [task, setTask] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [actionPlan, setActionPlan] = useState("");
  const [actionPlanDate, setActionPlanDate] = useState("");
  const [boRemark, setBoRemark] = useState("");
  const [boAttachments, setBoAttachments] = useState<PendingAttachments>(EMPTY_PENDING);

  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const isAdmin = getRole() === "ADMIN";
  const myId = getStoredUser()?.id;

  // A BO's own update being edited.
  const [editing, setEditing] = useState<{ id: string; actionPlan: string; actionPlanDate: string; remark: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      !actionPlanDate &&
      !boRemark.trim() &&
      !hasPending(boAttachments)
    ) {
      setUpdateError(
        "Please enter an Action Plan, BO's Remark, or select an attachment."
      );
      return;
    }

    if (overWordLimit(actionPlan) || overWordLimit(boRemark)) {
      setUpdateError(
        `Action Plan and BO's Remark can each be at most ${WORD_LIMIT} words. Please shorten the text before submitting.`
      );
      return;
    }

    setSubmittingUpdate(true);
    setUpdateError(null);

    try {
      // Upload the chosen files first; links are sent as they are.
      const attachments = await uploadPending(boAttachments, "/api/tasks/officer-update/upload");

      // Save Action Plan + BO Remark + Attachments
      const data = await apiFetch<{ task: ApiTask }>(
        `/api/tasks/${task.id}/officer-updates`,
        {
          method: "POST",
          body: JSON.stringify({
            actionPlan: actionPlan.trim() || null,
            actionPlanDate: actionPlanDate || null,
            remark: boRemark.trim() || null,
            attachments,
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
      setActionPlanDate("");
      setBoRemark("");
      setBoAttachments(EMPTY_PENDING);

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
  // EDIT OWN BO UPDATE
  // --------------------------------------------------

  const saveEdit = async () => {
    if (!task || !editing) return;

    setSavingEdit(true);
    setEditError(null);

    try {
      const data = await apiFetch<{ task: ApiTask | null }>(
        `/api/tasks/${task.id}/officer-updates/${editing.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            actionPlan: editing.actionPlan.trim() || null,
            actionPlanDate: editing.actionPlanDate || null,
            remark: editing.remark.trim() || null,
          }),
        }
      );

      if (data.task) {
        setTask(data.task);
      }

      setEditing(null);
    } catch (e) {
      setEditError(
        e instanceof Error
          ? e.message
          : "Failed to save your update."
      );
    } finally {
      setSavingEdit(false);
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

  // View access is for everyone; assigned BOs and members of an assigned group
  // can respond. Only officers named on the task change its status.
  const assigned = isAssignedTo(task, myId);
  const canRespond = assigned || inAssignedGroup(task, getStoredUser()?.designation);

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
    ...(isAdmin
      ? []
      : [
          {
            label: "Department",
            value: taskDepartments(task).join(", ") || "-",
          },
        ]),
    {
      label: "Other Officers",
      value:
        task.additionalAssignees?.length > 0
          ? task.additionalAssignees
              .map((item) => item.designation)
              .join(", ")
          : "-",
    },
    ...(isAdmin
      ? []
      : [
          {
            label: "Action Plan",
            value: task.actionPlan || "-",
          },
        ]),
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
    {
      label: "Review Frequency",
      value: task.reviewCode ? (
        <span className={`review-code code-${task.reviewCode}`}>{task.reviewCode}</span>
      ) : (
        "Not assigned"
      ),
    },
    {
      label: "Allocated Monday",
      value: task.allocatedMonday || "-",
    },
    {
      label: "Scheduled Discussion",
      value: task.nextDiscussionDate ? formatDate(task.nextDiscussionDate) : "-",
    },
    {
      label: "DRM Attachments",
      value: <AttachmentList attachments={task.attachments ?? []} emptyText="-" />,
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

            {task.officerUpdates.map((update) => {
              const mine = !isAdmin && canRespond && update.officer.id === myId;

              return (
              <div
                className="bo-update-card"
                key={update.id}
              >

                <div>
                  <strong>Officer:</strong>{" "}
                  {update.officer.designation}
                </div>

                {editing?.id === update.id ? (
                  <div className="bo-update-edit">
                    <div className="bo-response-field">
                      <label htmlFor="editActionPlan">Action Plan</label>
                      <textarea
                        id="editActionPlan"
                        rows={4}
                        value={editing.actionPlan}
                        onChange={(e) => setEditing({ ...editing, actionPlan: e.target.value })}
                      />
                      <WordCount text={editing.actionPlan} />
                    </div>

                    <div className="bo-response-field">
                      <label htmlFor="editActionPlanDate">Action Plan Date</label>
                      <input
                        id="editActionPlanDate"
                        type="date"
                        value={editing.actionPlanDate}
                        onChange={(e) => setEditing({ ...editing, actionPlanDate: e.target.value })}
                      />
                    </div>

                    <div className="bo-response-field">
                      <label htmlFor="editRemark">BO&apos;s Remark</label>
                      <textarea
                        id="editRemark"
                        rows={4}
                        value={editing.remark}
                        onChange={(e) => setEditing({ ...editing, remark: e.target.value })}
                      />
                      <WordCount text={editing.remark} />
                    </div>

                    {editError && <p className="table-error">{editError}</p>}

                    <button
                      type="button"
                      className="btn-status"
                      onClick={saveEdit}
                      disabled={savingEdit || overWordLimit(editing.actionPlan) || overWordLimit(editing.remark)}
                    >
                      {savingEdit ? "Saving..." : "Save"}
                    </button>{" "}
                    <button type="button" className="btn-back" onClick={() => setEditing(null)} disabled={savingEdit}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>Action Plan:</strong>{" "}
                      {update.actionPlan || "-"}
                    </div>

                    {(update.actionPlanDate || !isAdmin) && (
                      <div>
                        <strong>Action Plan Date:</strong>{" "}
                        {update.actionPlanDate ? formatDate(update.actionPlanDate) : "-"}
                      </div>
                    )}

                    <div>
                      <strong>BO&apos;s Remark:</strong>{" "}
                      {update.remark || "-"}
                    </div>
                  </>
                )}

                <div>
                  <strong>Date:</strong>{" "}
                  {new Date(
                    update.createdAt
                  ).toLocaleString("en-GB")}
                </div>

                <div>
                  <strong>Attachments:</strong>
                  {isAdmin || mine ? (
                    <AttachmentManager
                      attachments={update.attachments ?? []}
                      canEdit
                      onAdd={async (pending) => setTask(await addAttachments(task.id, pending, update.id))}
                      onRemove={async (a) => setTask(await removeAttachment(task.id, a.id))}
                    />
                  ) : (
                    <AttachmentList attachments={update.attachments ?? []} emptyText=" -" />
                  )}
                </div>

                {mine && editing?.id !== update.id && (
                  <button
                    type="button"
                    className="btn-status bo-update-edit"
                    onClick={() => {
                      setEditError(null);
                      setEditing({
                        id: update.id,
                        actionPlan: update.actionPlan ?? "",
                        actionPlanDate: update.actionPlanDate ?? "",
                        remark: update.remark ?? "",
                      });
                    }}
                  >
                    Edit my update
                  </button>
                )}

              </div>
              );
            })}

          </div>
        )}

      {/* BO RESPONSE - ASSIGNED OFFICERS ONLY */}

      {!isAdmin && !canRespond && (
        <p className="bo-view-only">
          View only. Only the officers assigned to this task can submit updates.
        </p>
      )}

      {!isAdmin && canRespond && (
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
            <WordCount text={actionPlan} />
          </div>

          <div className="bo-response-field">
            <label htmlFor="actionPlanDate">
              Action Plan Date
            </label>

            <input
              id="actionPlanDate"
              type="date"
              value={actionPlanDate}
              onChange={(e) =>
                setActionPlanDate(e.target.value)
              }
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
            <WordCount text={boRemark} />
          </div>

          <div className="bo-response-field">
            <label>Attachments</label>
            <PendingAttachmentsField value={boAttachments} onChange={setBoAttachments} />
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
            disabled={submittingUpdate || overWordLimit(actionPlan) || overWordLimit(boRemark)}
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
        ) : assigned ? (
          <button
            onClick={handleToggleStatus}
            className="btn-status"
          >
            {task.status === "Completed"
              ? "Mark as Pending"
              : "Mark as Completed"}
          </button>
        ) : null}

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