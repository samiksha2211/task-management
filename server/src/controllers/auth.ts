import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import type { Response } from "express";
import { z } from "zod";
import { signToken } from "../lib/jwt";
import { broadcast } from "../lib/sse";
import { validate } from "../lib/validate";
import type { AuthRequest, AuthUser } from "../middleware/auth";
import { prisma } from "../prisma";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email(),
  password: z.string().min(6),
  designation: z.string().min(1).max(100),
});

const emailSchema = z.object({
  email: z.string().email(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().max(2_500_000).nullable().optional(),
});

export function publicUser(user: {
  id: string;
  name: string;
  email: string;
  designation: string;
  role: string;
  avatar: string | null;
  department?: string | null;
  isActive?: boolean;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    designation: user.designation,
    role: user.role,
    avatar: user.avatar,
    department: user.department ?? null,
    isActive: user.isActive ?? true,
  };
}

export async function login(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(loginSchema, req.body);
  const email = body.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const ok = await bcrypt.compare(body.password, user.password);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.json({ token, user: publicUser(user) });
}

export async function register(req: AuthRequest, res: Response): Promise<void> {
  const body = validate(registerSchema, req.body);
  const email = body.email.toLowerCase().trim();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: body.name?.trim() || body.designation.trim(),
      email,
      password: await bcrypt.hash(body.password, 10),
      designation: body.designation.trim(),
      role: "OFFICER",
    },
  });

  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: publicUser(user) });
  broadcast("user:updated", { id: user.id });
}

export function me(req: AuthRequest, res: Response): void {
  const user = req.user as AuthUser;
  res.json({ user: publicUser(user) });
}

export async function updateMe(req: AuthRequest, res: Response): Promise<void> {
  const user = req.user as AuthUser;
  const body = validate(updateMeSchema, req.body);

  const data: { name?: string; avatar?: string | null } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.avatar !== undefined) data.avatar = body.avatar;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
  });

  res.json({ user: publicUser(updated) });
  broadcast("user:updated", { id: updated.id });
}

export async function changePassword(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const user = req.user as AuthUser;
  const body = validate(changePasswordSchema, req.body);

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const ok = await bcrypt.compare(body.currentPassword, dbUser.password);
  if (!ok) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const hashed = await bcrypt.hash(body.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  res.json({ message: "Password updated successfully" });
}

export async function forgotPassword(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const body = validate(emailSchema, req.body);
  const email = body.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(404).json({ error: "No account found with that email" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: token, resetTokenExpires: expires },
  });

  res.json({
    message: "Reset link generated",
    resetToken: token,
    resetLink: `/reset-password?token=${token}`,
  });
}

export async function resetPassword(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const body = validate(resetPasswordSchema, req.body);

  const user = await prisma.user.findFirst({
    where: { resetToken: body.token },
  });
  if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
    res.status(400).json({ error: "Reset token is invalid or has expired" });
    return;
  }

  const hashed = await bcrypt.hash(body.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, resetToken: null, resetTokenExpires: null },
  });

  res.json({ message: "Password reset successfully. You can now sign in." });
}
