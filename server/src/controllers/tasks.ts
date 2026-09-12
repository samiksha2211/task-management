import { sendSMS } from "../services/sms";
import { assignmentSms } from "../services/smsTemplates";
import type { TaskStatus } from "@prisma/client";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { param, queryString } from "../lib/http";
import { serializeTask, todayUTCStart } from "../lib/serialize";
import {
  exportToCsv,
  exportToPdf,
  rowsFromTasks,
} from "../lib/export";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";

const statusInput = z.enum(["Pending", "Completed", "pending", "completed"]);

function normalizeStatus(value: z.infer<typeof statusInput>): TaskStatus {
  return value.toLowerCase() === "completed" ? "COMPLETED" : "PENDING";
}

const taskFields = {
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  date: z.coerce.date(),
  dueDate: z.coerce.date(),
  remarks: z.string().optional().nullable(),
  officerId: z.string().min(1),
  status: statusInput.default("Pending"),
  priority: z.string().trim().max(30).optional().nullable(),

  attachmentUrl: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),
};

const createSchema = z.object({
  ...taskFields,
  clientRequestId: z.string().uuid().optional(),
});
const updateSchema = z.object(taskFields).partial();
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
      include: { officer: true },
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
    include: { officer: true },
    orderBy: { createdAt: "desc" },
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
    include: { officer: true },
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
      include: { officer: true },
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

  let task;

try {
  task = await prisma.task.create({
    data: {
      title: body.title,
      description: body.description ?? null,
      date: body.date,
      dueDate: body.dueDate,
      remarks: body.remarks ?? null,
      officerId: body.officerId,
      status: normalizeStatus(body.status),
      priority: body.priority ?? null,
      
      attachmentUrl: body.attachmentUrl ?? null,
      attachmentName: body.attachmentName ?? null,
      attachmentType: body.attachmentType ?? null,
      clientRequestId: body.clientRequestId ?? null,
    },
    include: { officer: true },
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
      include: {
        officer: true,
      },
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
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.remarks !== undefined) data.remarks = body.remarks;
  if (body.date !== undefined) data.date = body.date;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate;
  if (body.status !== undefined) data.status = normalizeStatus(body.status);
  if (body.officerId !== undefined) data.officer = { connect: { id: body.officerId } };
  if (body.priority !== undefined) data.priority = body.priority || null;

  const task = await prisma.task.update({
    where: { id: param(req, "id") },
    data,
    include: { officer: true },
  });

  res.json({ task: serializeTask(task) });
  broadcast("task:updated", { id: task.id });
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
    include: { officer: true },
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
    include: { officer: true },
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
    include: { officer: true },
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

  await prisma.task.delete({ where: { id: param(req, "id") } });
  res.json({ success: true });
  broadcast("task:deleted", { id: param(req, "id") });
}
