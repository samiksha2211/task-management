import type {
  Task,
  User,
  TaskAdditionalAssignee,
  TaskOfficerUpdate,
} from "@prisma/client";

export type TaskStatusLabel =
  | "Pending"
  | "Completed"
  | "Overdue";

function startOfTodayUTC(): number {
  const now = new Date();

  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
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

  // DRM / Task-level Action Plan
  actionPlan: string | null;

  // Action Plan TDC decided by DRM
  actionPlanTdc: string | null;

  // DRM Remark
  remarks: string | null;

  // DRM Attachment
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;

  status: TaskStatusLabel;

  priority: string | null;

  // Monday meeting scheduling
  discussionFrequency: "M" | "F" | "NM" | null;
  monthlyMondayOrdinal: number | null;
  lastDiscussedAt: string | null;
  nextDiscussionDate: string | null;
  scheduleState: string;
  scheduleReason: string | null;
  estimatedDiscussionMinutes: number | null;
  isBlocked: boolean;
  flaggedForReview: boolean;
  latestReviewNote: string | null;

  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // Co-ordinator Officer
  officer: {
    id: string;
    name: string;
    designation: string;
    email: string;
  };

  // Other Officers
  additionalAssignees: {
    id: string;
    name: string;
    designation: string;
    email: string;
  }[];

  // BO Action Plans / Remarks / Attachments
  officerUpdates: {
    id: string;

    actionPlan: string | null;
    remark: string | null;

    attachmentUrl: string | null;
    attachmentName: string | null;
    attachmentType: string | null;

    createdAt: string;
    updatedAt: string;

    officer: {
      id: string;
      name: string;
      designation: string;
      email: string;
    };
  }[];
}

type TaskWithAssignees = Task & {
  officer: User;

  additionalAssignees: (
    TaskAdditionalAssignee & {
      officer: User;
    }
  )[];

  officerUpdates: (
    TaskOfficerUpdate & {
      officer: User;
    }
  )[];
};

export function serializeTask(
  task: TaskWithAssignees
): SerializedTask {
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

    // Action Plan
    actionPlan: task.actionPlan ?? null,

    // Action Plan TDC
    actionPlanTdc: task.actionPlanTdc
      ? task.actionPlanTdc.toISOString()
      : null,

    // DRM Remark
    remarks: task.remarks,

    // DRM Attachment
    attachmentUrl: task.attachmentUrl,
    attachmentName: task.attachmentName,
    attachmentType: task.attachmentType,

    status,

    priority: task.priority,

    discussionFrequency: task.discussionFrequency,
    monthlyMondayOrdinal: task.monthlyMondayOrdinal,
    lastDiscussedAt: task.lastDiscussedAt
      ? task.lastDiscussedAt.toISOString().slice(0, 10)
      : null,
    nextDiscussionDate: task.nextDiscussionDate
      ? task.nextDiscussionDate.toISOString().slice(0, 10)
      : null,
    scheduleState: task.scheduleState,
    scheduleReason: task.scheduleReason,
    estimatedDiscussionMinutes: task.estimatedDiscussionMinutes,
    isBlocked: task.isBlocked,
    flaggedForReview: task.flaggedForReview,
    latestReviewNote: task.latestReviewNote,

    deletedAt: task.deletedAt
      ? task.deletedAt.toISOString()
      : null,

    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),

    // Co-ordinator Officer
    officer: {
      id: task.officer.id,
      name: task.officer.name,
      designation: task.officer.designation,
      email: task.officer.email,
    },

    // Other Officers
    additionalAssignees:
      task.additionalAssignees.map(
        (assignment) => ({
          id: assignment.officer.id,
          name: assignment.officer.name,
          designation:
            assignment.officer.designation,
          email: assignment.officer.email,
        })
      ),

    // BO Updates
    officerUpdates: (task.officerUpdates ?? []).map(
      (update) => ({
        id: update.id,

        actionPlan: update.actionPlan ?? null,
        remark: update.remark ?? null,

        attachmentUrl:
          update.attachmentUrl ?? null,
        attachmentName:
          update.attachmentName ?? null,
        attachmentType:
          update.attachmentType ?? null,

        createdAt:
          update.createdAt.toISOString(),

        updatedAt:
          update.updatedAt.toISOString(),

        officer: {
          id: update.officer.id,
          name: update.officer.name,
          designation:
            update.officer.designation,
          email: update.officer.email,
        },
      })
    ),
  };
}