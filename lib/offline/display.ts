import type { ApiTask } from "@/lib/api";
import type { PendingTaskCreate } from "./queue";

function startOfTodayLocal(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function taskStatusFromDue(
  status: PendingTaskCreate["status"],
  dueDate: string
): ApiTask["status"] {
  if (status === "Completed") return "Completed";
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  return due < startOfTodayLocal() ? "Overdue" : "Pending";
}

export function pendingTaskToApiTask(item: PendingTaskCreate): ApiTask {
  const isoDate = `${item.date}T00:00:00.000Z`;
  const isoDueDate = `${item.dueDate}T00:00:00.000Z`;

  return {
    id: `offline:${item.clientRequestId}`,
    title: item.title,
    description: item.description,
    date: isoDate,
    dueDate: isoDueDate,
    remarks: null,
    status: taskStatusFromDue(item.status, item.dueDate),
    deletedAt: null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    officer: {
      id: `offline-officer:${item.designation}`,
      name: item.designation,
      designation: item.designation,
      email: "",
    },
    offlinePending: true,
    clientRequestId: item.clientRequestId,
    syncState: item.syncState,
    syncError: item.lastError,
  };
}

export function mergeTasksWithPending(
  serverTasks: ApiTask[],
  pendingTasks: PendingTaskCreate[]
): ApiTask[] {
  const pending = pendingTasks.map(pendingTaskToApiTask);
  return [...pending, ...serverTasks];
}
