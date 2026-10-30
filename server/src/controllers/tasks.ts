import { sendSMS } from "../services/sms";
import { assignmentSms } from "../services/smsTemplates";
import type { TaskStatus } from "@prisma/client";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { param, queryString } from "../lib/http";
import { serializeTask, taskInclude, todayUTCStart } from "../lib/serialize";
import { storeFile, deleteStoredFile, isStoredFileUrl, type StoredFile } from "../lib/storage";
import {
  AttachmentError,
  attachmentInputSchema,
  canManageBo,
  canManageDrm,
  cleanUpFiles,
  createAttachments,
  sheetLinkSchema,
  type AttachmentInput,
} from "../services/attachments";
import {
  exportToCsv,
  exportToPdf,
  rowsFromTasks,
} from "../lib/export";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";
import { setTaskCycle } from "../services/scheduling/actions";
import { isISODate, isMonday } from "../services/scheduling/dates";
import { syncUpcomingMeetings, TX_OPTIONS } from "../services/scheduling/repository";

const statusInput = z.enum(["Pending", "Completed", "pending", "completed"]);

function normalizeStatus(value: z.infer<typeof statusInput>): TaskStatus {
  return value.toLowerCase() === "completed" ? "COMPLETED" : "PENDING";
}

const taskFields = {
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  date: z.coerce.date(),
  dueDate: z.coerce.date(),
  actionPlan: z.string().optional().nullable(),
  actionPlanTdc: z.coerce.date().optional().nullable(),
  remarks: z.string().optional().nullable(),
  officerId: z.string().min(1),
  additionalOfficerIds: z.array(z.string().min(1)).optional().default([]),
  status: statusInput.default("Pending"),
  priority: z.string().trim().max(30).optional().nullable(),

  // Legacy single attachment (still accepted; stored as an attachment row).
  attachmentUrl: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),

  // DRM attachments: uploaded files and Google Sheets links.
  attachments: z.array(attachmentInputSchema).max(20).optional(),

  // Monday meeting scheduling
  discussionFrequency: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY"]).optional().nullable(),
  // M: allocated Monday of the month (1-5). FT: a Monday the cycle runs from.
  monthlyMondayOrdinal: z.number().int().min(1).max(5).optional().nullable(),
  fortnightAnchor: z
    .string()
    .refine((v) => isISODate(v) && isMonday(v), "must be a Monday (YYYY-MM-DD)")
    .optional()
    .nullable(),
};

type ScheduleFields = {
  discussionFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | null;
  monthlyMondayOrdinal?: number | null;
  fortnightAnchor?: string | null;
};

function hasScheduleFields(body: ScheduleFields): boolean {
  return (
    body.discussionFrequency !== undefined ||
    body.monthlyMondayOrdinal !== undefined ||
    body.fortnightAnchor !== undefined
  );
}

const createSchema = z.object({
  ...taskFields,
  clientRequestId: z.string().uuid().optional(),
});
const updateSchema = z.object(taskFields).partial();
const officerUpdateSchema = z.object({
  actionPlan: z.string().trim().optional().nullable(),
  remark: z.string().trim().optional().nullable(),

  // Legacy single attachment (still accepted; stored as an attachment row).
  attachmentUrl: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),

  // BO attachments: uploaded files and Google Sheets links.
  attachments: z.array(attachmentInputSchema).max(20).optional(),
});

/** Attachments sent with a create/update request, including the legacy single field. */
function attachmentInputs(body: {
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachments?: AttachmentInput[];
}): AttachmentInput[] {
  const inputs = [...(body.attachments ?? [])];
  if (body.attachmentUrl) {
    if (!isStoredFileUrl(body.attachmentUrl)) {
      throw new AttachmentError("Attachment must be uploaded through this application.");
    }
    inputs.push({
      kind: "FILE",
      url: body.attachmentUrl,
      name: body.attachmentName || "Attachment",
      mimeType: body.attachmentType ?? null,
    });
  }
  return inputs;
}
const listQuerySchema = z.object({
  status: z.string().optional(),
  officerId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(50),
});

const exportQuerySchema = z.object({
  format: z.enum(["pdf", "csv"]).default("pdf"),
  id: z.string().optional(),
  ids: z.string().optional(),
  all: z.string().optional(),
  status: z.string().optional(),
  officerId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const activeWhere: Prisma.TaskWhereInput = { deletedAt: null };

// taskInclude (shared with the dashboard and PDFs) lives in ../lib/serialize.

function statusFilterToWhere(status?: string): Prisma.TaskWhereInput {
  switch (status?.toLowerCase()) {
    case "overdue":
      return { status: "PENDING", dueDate: { lt: todayUTCStart() } };
    case "pending":
      return { status: "PENDING", dueDate: { gte: todayUTCStart() } };
    case "completed":
      return { status: "COMPLETED" };
    default:
      return {};
  }
}

interface ListQuery {
  status?: string;
  officerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildListWhere(q: ListQuery): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = statusFilterToWhere(q.status);

  if (q.officerId) where.officerId = q.officerId;
  if (q.search) {
    const term = q.search.trim();
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
      { remarks: { contains: term, mode: "insensitive" } },
      { officer: { name: { contains: term, mode: "insensitive" } } },
      { officer: { designation: { contains: term, mode: "insensitive" } } },
    ];
  }
  if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = new Date(q.dateFrom);
    if (q.dateTo) where.date.lte = new Date(q.dateTo);
  }

  return where;
}

// Scheduling goes through the central scheduling service so the first
// discussion date follows the same rules as the meeting agenda.
async function applyScheduleFields(taskId: string, body: ScheduleFields, userId: string | null) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const cycle = body.discussionFrequency !== undefined ? body.discussionFrequency : current.discussionFrequency;
    await setTaskCycle(
      tx,
      current,
      cycle,
      { monthlyMondayOrdinal: body.monthlyMondayOrdinal, fortnightAnchor: body.fortnightAnchor },
      userId
    );
    await syncUpcomingMeetings(tx);
  }, TX_OPTIONS);
  return prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
}

async function officerOrThrow(officerId: string): Promise<boolean> {
  const officer = await prisma.user.findUnique({ where: { id: officerId } });
  return !!officer;
}

export async function listTasks(req: AuthRequest, res: Response): Promise<void> {
  const q = validate(listQuerySchema, {
    status: queryString(req.query.status),
    officerId: queryString(req.query.officerId),
    search: queryString(req.query.search),
    dateFrom: queryString(req.query.dateFrom),
    dateTo: queryString(req.query.dateTo),
    page: queryString(req.query.page),
    limit: queryString(req.query.limit),
  });

  const where: Prisma.TaskWhereInput = { ...activeWhere, ...buildListWhere(q) };

  const page = q.page;
  const limit = q.limit;
  const skip = (page - 1) * limit;

  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
       include: taskInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  res.json({
    tasks: tasks.map(serializeTask),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

const EXPORT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

const EXPORT_EXT: Record<string, string> = { pdf: "pdf", csv: "csv" };

export async function exportTasks(req: AuthRequest, res: Response): Promise<void> {
  const q = validate(exportQuerySchema, {
    format: (queryString(req.query.format) ?? "pdf").toLowerCase(),
    id: queryString(req.query.id),
    ids: queryString(req.query.ids),
    all: queryString(req.query.all),
    status: queryString(req.query.status),
    officerId: queryString(req.query.officerId),
    search: queryString(req.query.search),
    dateFrom: queryString(req.query.dateFrom),
    dateTo: queryString(req.query.dateTo),
  });

  const ids = (q.ids ?? "").split(",").filter(Boolean);

  let where: Prisma.TaskWhereInput;
  if (q.id) {
    where = { id: q.id, deletedAt: null };
  } else if (ids.length > 0) {
    where = { id: { in: ids }, deletedAt: null };
  } else if (q.all === "1") {
    where = { deletedAt: null };
  } else {
    where = { ...activeWhere, ...buildListWhere(q) };
  }

  const tasks = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: {  date: "desc" },
  });

  if (tasks.length === 0) {
    res.status(422).json({ error: "No tasks available to download." });
    return;
  }

  const rows = rowsFromTasks(tasks);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const isSingle = Boolean(q.id);
  const base = isSingle ? "railwork_task" : "railwork_tasks";
  const filename = `${base}_${dateStamp}.${EXPORT_EXT[q.format]}`;
  const generated = `Generated ${new Date().toLocaleString("en-GB")}`;
  const subtitle = `${generated}  •  ${tasks.length} task(s)`;

  let body: Buffer | string;
  switch (q.format) {
    case "csv":
      body = exportToCsv(rows);
      break;
    case "pdf":
    default:
      body = await exportToPdf(rows, {
        title: "RailWork — Task Report",
        subtitle,
      });
      break;
  }

  res.setHeader("Content-Type", EXPORT_MIME[q.format]);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.isBuffer(body) ? body : Buffer.from(body));
}

export async function getTask(req: AuthRequest, res: Response): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: param(req, "id"), deletedAt: null },
    include: taskInclude,
  });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ task: serializeTask(task) });
}

export async function createTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(createSchema, req.body);

  if (body.clientRequestId) {
    const existing = await prisma.task.findUnique({
      where: { clientRequestId: body.clientRequestId },
      include: taskInclude,
    });
    if (existing) {
      res.status(200).json({ task: serializeTask(existing), deduplicated: true });
      return;
    }
  }

  if (!(await officerOrThrow(body.officerId))) {
    res.status(400).json({ error: "Officer not found" });
    return;
  }
  const newAttachments = attachmentInputs(body);

  let task;

try {
  task = await prisma.task.create({
    data: {
      title: body.title,
      description: body.description ?? null,
      date: body.date,
      actionPlan: body.actionPlan ?? null,
      actionPlanTdc: body.actionPlanTdc ?? null,
      dueDate: body.dueDate,
      remarks: body.remarks ?? null,
      officerId: body.officerId,
      
      additionalAssignees: {
      create: body.additionalOfficerIds
      .filter((id) => id !== body.officerId)
      .map((officerId) => ({
       officerId,
      })),
},
      status: normalizeStatus(body.status),
      priority: body.priority ?? null,
      
      clientRequestId: body.clientRequestId ?? null,
    },
    include: taskInclude,
  });
} catch (error) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    body.clientRequestId
  ) {
    const existing = await prisma.task.findUnique({
      where: {
        clientRequestId: body.clientRequestId,
      },
      include: taskInclude,
    });

    if (existing) {
      res.status(200).json({
        task: serializeTask(existing),
        deduplicated: true,
      });
      return;
    }
  }

  throw error;
}
  if (newAttachments.length) {
    await createAttachments(prisma, {
      taskId: task.id,
      officerUpdateId: null,
      userId: req.user?.id ?? null,
      inputs: newAttachments,
    });
    task = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  }
  if (hasScheduleFields(body)) {
    task = await applyScheduleFields(task.id, body, req.user?.id ?? null);
  }

  console.log("Task created:", task.title);
  console.log(
    "Assigned officer:",
    task.officer.designation,
    "Mobile:",
    task.officer.mobileNumber
  );

if (task.officer.mobileNumber) {
  const dueDate = task.dueDate.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
  });

 const message = assignmentSms(task.title, dueDate);
    // "Defective Device no. 124 is received under defected due to Designation issue, Regards, RUNGRL";

  console.log("SMS mobile:", task.officer.mobileNumber);
  console.log("SMS message:", message);

  try {
    const smsResult = await sendSMS(
      task.officer.mobileNumber,
      message
    );

    console.log("Assignment SMS submitted successfully:", smsResult);
  } catch (error) {
    console.error("Assignment SMS failed:", error);
  }
}

  res.status(201).json({ task: serializeTask(task) });
  broadcast("task:created", { id: task.id });
}

export async function updateTask(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(updateSchema, req.body);

  const existing = await prisma.task.findFirst({
    where: { id: param(req, "id"), deletedAt: null },
  });
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (body.officerId && !(await officerOrThrow(body.officerId))) {
    res.status(400).json({ error: "Officer not found" });
    return;
  }

  const data: Prisma.TaskUpdateInput = {};
  if (body.additionalOfficerIds !== undefined) {
  data.additionalAssignees = {
    deleteMany: {},
    create: body.additionalOfficerIds
      .filter((id) => id !== (body.officerId ?? existing.officerId))
      .map((officerId) => ({
        officerId,
      })),
  };
}
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.actionPlan !== undefined) data.actionPlan = body.actionPlan;

  if (body.actionPlanTdc !== undefined)data.actionPlanTdc = body.actionPlanTdc;

  if (body.remarks !== undefined) data.remarks = body.remarks;
  // Attachments are added here and removed through the attachments endpoint.
  const newAttachments = attachmentInputs(body);
  if (body.date !== undefined) data.date = body.date;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate;
  if (body.status !== undefined) data.status = normalizeStatus(body.status);
  if (body.officerId !== undefined) data.officer = { connect: { id: body.officerId } };
  if (body.priority !== undefined) data.priority = body.priority || null;

  let task = await prisma.task.update({
    where: { id: param(req, "id") },
    data,
    include: taskInclude,
  });

  if (newAttachments.length) {
    await createAttachments(prisma, {
      taskId: task.id,
      officerUpdateId: null,
      userId: req.user?.id ?? null,
      inputs: newAttachments,
    });
    task = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  }

  if (hasScheduleFields(body)) {
    task = await applyScheduleFields(task.id, body, req.user?.id ?? null);
  }

  res.json({ task: serializeTask(task) });
  broadcast("task:updated", { id: task.id });
}
export async function createOfficerUpdate(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const taskId = param(req, "id");
  const body = validate(officerUpdateSchema, req.body);
  const newAttachments = attachmentInputs(body);

  // At least one BO field must contain something
  if (
    !body.actionPlan?.trim() &&
    !body.remark?.trim() &&
    newAttachments.length === 0
  ) {
    res.status(400).json({
      error: "Please enter an Action Plan, BO's Remark, or attachment.",
    });
    return;
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null,
    },
    include: {
      additionalAssignees: true,
    },
  });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // ADMIN can administratively add/update information.
  // OFFICER must actually be assigned to the task.
  if (req.user.role !== "ADMIN") {
    const isCoordinator = task.officerId === req.user.id;

    const isAdditionalOfficer = task.additionalAssignees.some(
      (assignment) => assignment.officerId === req.user!.id
    );

    if (!isCoordinator && !isAdditionalOfficer) {
      res.status(403).json({
        error: "You are not assigned to this task.",
      });
      return;
    }
  }

  const userId = req.user.id;
  const update = await prisma.$transaction(async (tx) => {
    const created = await tx.taskOfficerUpdate.create({
      data: {
        taskId,
        officerId: userId,
        actionPlan: body.actionPlan?.trim() || null,
        remark: body.remark?.trim() || null,
      },
      include: { officer: true },
    });
    await createAttachments(tx, { taskId, officerUpdateId: created.id, userId, inputs: newAttachments });
    return created;
  });

  const updatedTask = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    include: taskInclude,
  });

  res.status(201).json({
    update,
    task: updatedTask ? serializeTask(updatedTask) : null,
  });

  broadcast("task:updated", { id: taskId });
}
export async function updateOfficerUpdate(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const taskId = param(req, "id");
  const updateId = param(req, "updateId");

  const body = validate(officerUpdateSchema, req.body);
  const newAttachments = attachmentInputs(body);

  // Make sure this BO update belongs to this task
  const existingUpdate = await prisma.taskOfficerUpdate.findFirst({
    where: {
      id: updateId,
      taskId,
    },
  });

  if (!existingUpdate) {
    res.status(404).json({
      error: "BO update not found",
    });
    return;
  }

  // Update the same record - do not create duplicate
  const update = await prisma.taskOfficerUpdate.update({
    where: {
      id: updateId,
    },
    data: {
      ...(body.actionPlan !== undefined && {
        actionPlan: body.actionPlan?.trim() || null,
      }),

      ...(body.remark !== undefined && {
        remark: body.remark?.trim() || null,
      }),
    },
    include: {
      officer: true,
    },
  });

  if (newAttachments.length) {
    await createAttachments(prisma, {
      taskId,
      officerUpdateId: updateId,
      userId: req.user.id,
      inputs: newAttachments,
    });
  }

  const updatedTask = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    include: taskInclude,
  });

  res.json({
    update,
    task: updatedTask
      ? serializeTask(updatedTask)
      : null,
  });

  broadcast("task:updated", { id: taskId });
}
export async function deleteOfficerUpdate(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const taskId = param(req, "id");
  const updateId = param(req, "updateId");

  const update = await prisma.taskOfficerUpdate.findFirst({
    where: {
      id: updateId,
      taskId,
    },
  });

  if (!update) {
    res.status(404).json({
      error: "BO update not found",
    });
    return;
  }

  const removedAttachments = await prisma.taskAttachment.findMany({ where: { officerUpdateId: updateId } });
  await prisma.taskOfficerUpdate.delete({
    where: {
      id: updateId,
    },
  });
  await cleanUpFiles(removedAttachments);

  const updatedTask = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    include: taskInclude,
  });

  res.json({
    success: true,
    task: updatedTask
      ? serializeTask(updatedTask)
      : null,
  });

  broadcast("task:updated", { id: taskId });
}
export async function updateTaskStatus(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(z.object({ status: statusInput }), req.body);

  const existing = await prisma.task.findFirst({
    where: { id: param(req, "id"), deletedAt: null },
  });
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const task = await prisma.task.update({
    where: { id: param(req, "id") },
    data: { status: normalizeStatus(body.status) },
    include: taskInclude,
  });

  res.json({ task: serializeTask(task) });
  broadcast("task:updated", { id: task.id });
}

export async function softDelete(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { id: param(req, "id"), deletedAt: null },
  });
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await prisma.task.update({
    where: { id: param(req, "id") },
    data: { deletedAt: new Date() },
  });

  res.json({ success: true });
  broadcast("task:deleted", { id: param(req, "id") });
}

export async function recycleBin(_req: AuthRequest, res: Response): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: { not: null } },
    include: taskInclude,
    orderBy: { deletedAt: "desc" },
  });

  res.json({ tasks: tasks.map(serializeTask) });
}

export async function restore(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { id: param(req, "id"), deletedAt: { not: null } },
  });
  if (!existing) {
    res.status(404).json({ error: "Task not found in recycle bin" });
    return;
  }

  const task = await prisma.task.update({
    where: { id: param(req, "id") },
    data: { deletedAt: null },
    include: taskInclude,
  });

  res.json({ task: serializeTask(task) });
  broadcast("task:restored", { id: task.id });
}

export async function hardDelete(req: AuthRequest, res: Response): Promise<void> {
  const existing = await prisma.task.findUnique({ where: { id: param(req, "id") } });
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const removedAttachments = await prisma.taskAttachment.findMany({ where: { taskId: existing.id } });
  await prisma.task.delete({ where: { id: param(req, "id") } });
  await cleanUpFiles(removedAttachments);
  res.json({ success: true });
  broadcast("task:deleted", { id: param(req, "id") });
}

// ---------------------------------------------------------------------------
// Attachments

const addAttachmentsSchema = z.object({
  officerUpdateId: z.string().min(1).optional().nullable(),
  links: z.array(sheetLinkSchema).max(20).optional(),
});

/** Links arrive as a JSON array, or as a JSON string inside a multipart form. */
function parseLinks(body: Record<string, unknown>): unknown {
  const raw = body.links;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new AttachmentError("links must be a JSON array");
    }
  }
  return raw;
}

/**
 * Add files (multipart field "files") and/or Google Sheets links to a task's
 * DRM attachments, or to one BO entry when officerUpdateId is given.
 */
export async function addAttachments(req: AuthRequest, res: Response): Promise<void> {
  const taskId = param(req, "id");
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const body = validate(addAttachmentsSchema, {
    officerUpdateId: (req.body?.officerUpdateId as string | undefined) || null,
    links: parseLinks(req.body ?? {}),
  });
  const links = body.links ?? [];
  if (files.length === 0 && links.length === 0) {
    throw new AttachmentError("Choose at least one file or paste a Google Sheets link.");
  }

  const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) throw new AttachmentError("Task not found", 404);

  if (body.officerUpdateId) {
    const update = await prisma.taskOfficerUpdate.findFirst({ where: { id: body.officerUpdateId, taskId } });
    if (!update) throw new AttachmentError("BO entry not found", 404);
    if (!canManageBo(req.user!, update)) {
      throw new AttachmentError("You can only add attachments to your own BO entry.", 403);
    }
  } else if (!canManageDrm(req.user!)) {
    throw new AttachmentError("Only the DRM office can add DRM attachments.", 403);
  }

  const stored: StoredFile[] = [];
  try {
    for (const file of files) stored.push(await storeFile(file));
    const result = await createAttachments(prisma, {
      taskId,
      officerUpdateId: body.officerUpdateId ?? null,
      userId: req.user!.id,
      files: stored,
      links,
    });
    const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
    res.status(201).json({ task: serializeTask(updated), ...result });
    broadcast("task:updated", { id: taskId });
  } catch (error) {
    // Do not leave uploaded files behind if saving the records failed.
    await Promise.all(stored.map((f) => deleteStoredFile(f.url)));
    throw error;
  }
}

/** Remove one attachment; its stored file is deleted if nothing else uses it. */
export async function removeAttachment(req: AuthRequest, res: Response): Promise<void> {
  const taskId = param(req, "id");
  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: param(req, "attachmentId"), taskId },
    include: { officerUpdate: true },
  });
  if (!attachment) throw new AttachmentError("Attachment not found", 404);

  const allowed = attachment.officerUpdate
    ? canManageBo(req.user!, attachment.officerUpdate)
    : canManageDrm(req.user!);
  if (!allowed) throw new AttachmentError("You cannot remove this attachment.", 403);

  await prisma.taskAttachment.delete({ where: { id: attachment.id } });
  await cleanUpFiles([attachment]);

  const updated = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  res.json({ task: serializeTask(updated) });
  broadcast("task:updated", { id: taskId });
}
