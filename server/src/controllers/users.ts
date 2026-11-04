import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import { z } from "zod";
import { publicUser } from "./auth";
import { param } from "../lib/http";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";
import { TX_OPTIONS } from "../services/scheduling/repository";

const createSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  password: z.string().min(6),
  mobileNumber: z.string().trim().min(10).max(15).optional().nullable(),
  designation: z.string().min(1),
  role: z.enum(["ADMIN", "OFFICER"]).default("OFFICER"),
  department: z.string().trim().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    designation: z.string().min(1).optional(),
    mobileNumber: z.string().trim().min(10).max(15).optional().nullable(),
    role: z.enum(["ADMIN", "OFFICER"]).optional(),
    department: z.string().trim().max(100).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .partial();

export async function listUsers(_req: AuthRequest, res: Response): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { designation: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  res.json({
    users: users.map((u) => ({
      ...publicUser(u),
      taskCount: u._count.tasks,
    })),
  });
}

/**
 * Every designation in use, for the directory all BOs can see. Designations
 * only: no names, e-mail addresses or mobile numbers.
 */
export async function listDesignations(_req: AuthRequest, res: Response): Promise<void> {
  const users = await prisma.user.findMany({
    select: { designation: true },
    distinct: ["designation"],
    orderBy: { designation: "asc" },
  });
  res.json({ designations: users.map((u) => u.designation) });
}

// ---------------------------------------------------------------------------
// BO logins (DRM only). One login per designation: tasks are assigned to the
// account for a designation, so its login is set on that same account.

/** Accounts created automatically when a task is assigned; nobody can log in to them. */
const PLACEHOLDER_EMAIL = /@railwork\.local$/i;

/** Groups such as "All BOs", and the DRM's own designation, have no BO login. */
function hasNoBoLogin(designation: string): boolean {
  return /^all\b/i.test(designation) || designation.toLowerCase() === "drm";
}

type LoginAccount = {
  id: string;
  email: string;
  designation: string;
  mobileNumber: string | null;
  _count: { tasks: number; additionalTaskAssignments: number };
};

const accountSelect = {
  id: true,
  email: true,
  designation: true,
  mobileNumber: true,
  _count: { select: { tasks: true, additionalTaskAssignments: true } },
} as const;

const workOf = (a: LoginAccount) => a._count.tasks + a._count.additionalTaskAssignments;

/** The account that holds a designation's work: most tasks, then a real e-mail. */
function primaryAccount<T extends LoginAccount>(accounts: T[]): T {
  return [...accounts].sort(
    (a, b) => workOf(b) - workOf(a) || Number(PLACEHOLDER_EMAIL.test(a.email)) - Number(PLACEHOLDER_EMAIL.test(b.email))
  )[0];
}

function loginRow(accounts: LoginAccount[]) {
  const primary = primaryAccount(accounts);
  const ready = !PLACEHOLDER_EMAIL.test(primary.email);
  return {
    designation: primary.designation,
    email: ready ? primary.email : null,
    /** An e-mail on another account for this designation, offered when setting up. */
    suggestedEmail: accounts.find((a) => !PLACEHOLDER_EMAIL.test(a.email))?.email ?? null,
    ready: ready && accounts.length === 1,
    tasks: accounts.reduce((sum, a) => sum + workOf(a), 0),
  };
}

export async function listLogins(_req: AuthRequest, res: Response): Promise<void> {
  const users = await prisma.user.findMany({ where: { role: "OFFICER" }, select: accountSelect });
  const groups = new Map<string, LoginAccount[]>();
  for (const user of users) {
    if (hasNoBoLogin(user.designation.trim())) continue;
    const key = user.designation.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), user]);
  }
  res.json({ logins: [...groups.values()].map(loginRow) });
}

const setLoginSchema = z.object({
  designation: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

/** Move everything from a duplicate account to the designation's main account, then remove it. */
async function mergeAccount(tx: Prisma.TransactionClient, fromId: string, toId: string): Promise<void> {
  await tx.task.updateMany({ where: { officerId: fromId }, data: { officerId: toId } });
  await tx.taskAdditionalAssignee.deleteMany({
    where: {
      officerId: fromId,
      OR: [{ task: { officerId: toId } }, { task: { additionalAssignees: { some: { officerId: toId } } } }],
    },
  });
  await tx.taskAdditionalAssignee.updateMany({ where: { officerId: fromId }, data: { officerId: toId } });
  await tx.taskAdditionalAssignee.deleteMany({ where: { officerId: toId, task: { officerId: toId } } });
  await tx.taskOfficerUpdate.updateMany({ where: { officerId: fromId }, data: { officerId: toId } });
  await tx.taskAttachment.updateMany({ where: { uploadedById: fromId }, data: { uploadedById: toId } });
  await tx.taskScheduleEvent.updateMany({ where: { userId: fromId }, data: { userId: toId } });
  await tx.user.delete({ where: { id: fromId } });
}

/**
 * Give a designation its login: the e-mail and password are set on the account
 * that already holds its tasks and updates, so the BO sees them straight away.
 */
export async function setLogin(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(setLoginSchema, req.body);
  const designation = body.designation;
  const email = body.email?.toLowerCase();

  if (hasNoBoLogin(designation)) {
    res.status(400).json({ error: `${designation} cannot have a BO login.` });
    return;
  }
  if (email && PLACEHOLDER_EMAIL.test(email)) {
    res.status(400).json({ error: "Please enter the officer's real e-mail address." });
    return;
  }
  if (!email && !body.password) {
    res.status(400).json({ error: "Enter an e-mail address or a new password." });
    return;
  }

  const accounts = await prisma.user.findMany({
    where: { role: "OFFICER", designation: { equals: designation, mode: "insensitive" } },
    select: accountSelect,
  });
  const primary = accounts.length ? primaryAccount(accounts) : null;
  const settingUp = !primary || PLACEHOLDER_EMAIL.test(primary.email);

  if (settingUp && (!email || !body.password)) {
    res.status(400).json({ error: "A new login needs both an e-mail address and a starting password." });
    return;
  }

  const holder = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (holder && !accounts.some((a) => a.id === holder.id)) {
    res.status(409).json({ error: `This e-mail address is already used by ${holder.designation}.` });
    return;
  }

  const password = body.password ? await bcrypt.hash(body.password, 10) : undefined;

  await prisma.$transaction(async (tx) => {
    if (!primary) {
      await tx.user.create({
        data: { name: designation, email: email!, password: password!, designation, role: "OFFICER" },
      });
      return;
    }
    const duplicates = accounts.filter((a) => a.id !== primary.id);
    for (const duplicate of duplicates) await mergeAccount(tx, duplicate.id, primary.id);
    await tx.user.update({
      where: { id: primary.id },
      data: {
        ...(email && { email }),
        ...(password && { password, resetToken: null, resetTokenExpires: null }),
        mobileNumber: primary.mobileNumber ?? duplicates.find((d) => d.mobileNumber)?.mobileNumber ?? null,
      },
    });
  }, TX_OPTIONS);

  const updated = await prisma.user.findMany({
    where: { role: "OFFICER", designation: { equals: designation, mode: "insensitive" } },
    select: accountSelect,
  });
  res.json({ login: loginRow(updated) });
  broadcast("user:updated", {});
}

export async function getUser(req: AuthRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: param(req, "id") } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: publicUser(user) });
}

export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(createSchema, req.body);
  const email = body.email.toLowerCase().trim();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  
    let user;

try {
  user = await prisma.user.create({
    data: {
      name: body.name || body.designation,
      email,
      password: await bcrypt.hash(crypto.randomUUID(), 10),
      designation: body.designation,
      role: "OFFICER",
    },
  });
} catch (error) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const existingUser = await prisma.user.findFirst({
      where: {
        designation: {
          equals: body.designation,
          mode: "insensitive",
        },
      },
    });

    if (existingUser) {
      res.json({ user: publicUser(existingUser) });
      return;
    }
  }

  throw error;
}

  res.status(201).json({ user: publicUser(user) });
  broadcast("user:updated", { id: user.id });
}

export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(updateSchema, req.body);
  const id = param(req, "id");
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const data: {
    name?: string;
    email?: string;
    password?: string;
    designation?: string;
    mobileNumber?: string | null;
    role?: "ADMIN" | "OFFICER";
    department?: string | null;
    isActive?: boolean;
  } = {
    ...body,
    department: body.department === undefined ? undefined : (body.department?.trim() || null),
    mobileNumber: body.mobileNumber === undefined ? undefined : (body.mobileNumber?.trim() || null),
  };

  if (body.email) {
    data.email = body.email.toLowerCase().trim();
  }
  if (body.password) {
    data.password = await bcrypt.hash(body.password, 10);
  }

  const user = await prisma.user.update({ where: { id }, data });
  res.json({ user: publicUser(user) });
  broadcast("user:updated", { id: user.id });
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function ensureUserByDesignation(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const body = validate(
    z.object({ designation: z.string().min(1).max(100) }),
    req.body
  );

  const designation = body.designation.trim();

  const existing = await prisma.user.findFirst({
    where: {
      designation: {
        equals: designation,
        mode: "insensitive",
      },
    },
  });

  if (existing) {
    res.json({ user: publicUser(existing) });
    return;
  }

  const slug = slugify(designation) || "officer";
  let email = `${slug}@railwork.local`;
  let counter = 1;

  while (await prisma.user.findUnique({ where: { email } })) {
    email = `${slug}${counter}@railwork.local`;
    counter += 1;
  }

  const user = await prisma.user.create({
    data: {
      name:body.designation,
      email,
      password: await bcrypt.hash(crypto.randomUUID(), 10),
      designation: body.designation,
      role: "OFFICER",
    },
  });

  res.status(201).json({
    user: publicUser(user),
    created: true,
  });

  broadcast("user:updated", { id: user.id });
}

export async function deleteUser(req: AuthRequest, res: Response): Promise<void> {
  const id = param(req, "id");
  if (req.user?.id === id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  try {
    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
    broadcast("user:deleted", { id });
  } catch {
    res.status(409).json({ error: "Cannot delete a user with assigned tasks" });
  }
}
