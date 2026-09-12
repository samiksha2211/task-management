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
