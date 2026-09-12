import type { Task, User } from "@prisma/client";

export type TaskStatusLabel = "Pending" | "Completed" | "Overdue";

function startOfTodayUTC(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function todayUTCStart(): Date {
  return new Date(startOfTodayUTC());
}

export function tomorrowUTCStart(): Date {
  const d = todayUTCStart();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function isOverdue(dueDate: Date): boolean {
  const due = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate()
  );
  return due < startOfTodayUTC();
}

export interface SerializedTask {
  id: string;
  title: string;
  description: string | null;
  date: string;
  dueDate: string;
  remarks: string | null;
  status: TaskStatusLabel;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  officer: {
    id: string;
    name: string;
    designation: string;
    email: string;
  };
}

export function serializeTask(task: Task & { officer: User }): SerializedTask {
  const status: TaskStatusLabel =
    task.status === "COMPLETED"
      ? "Completed"
      : isOverdue(task.dueDate)
        ? "Overdue"
        : "Pending";

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    date: task.date.toISOString(),
    dueDate: task.dueDate.toISOString(),
    remarks: task.remarks,
    
    attachmentUrl: task.attachmentUrl,
    attachmentName: task.attachmentName,
    attachmentType: task.attachmentType,
    status,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    officer: {
      id: task.officer.id,
      name: task.officer.name,
      designation: task.officer.designation,
      email: task.officer.email,
    },
  };
}
