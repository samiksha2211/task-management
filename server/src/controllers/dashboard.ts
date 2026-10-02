import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { serializeTask, todayUTCStart, tomorrowUTCStart } from "../lib/serialize";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../prisma";

const activeWhere: Prisma.TaskWhereInput = { deletedAt: null };
const taskInclude = {
  officer: true,

  additionalAssignees: {
    include: {
      officer: true,
    },
  },

  officerUpdates: {
    include: {
      officer: true,
    },
    orderBy: {
      createdAt: "desc" as const,
    },
  },
} satisfies Prisma.TaskInclude;
export async function stats(_req: AuthRequest, res: Response): Promise<void> {
  const today = todayUTCStart();
  const tomorrow = tomorrowUTCStart();

  const [total, completed, pending, overdue, dueToday, recentTasks] = await Promise.all([
    prisma.task.count({ where: activeWhere }),
    prisma.task.count({ where: { ...activeWhere, status: "COMPLETED" } }),
    prisma.task.count({
      where: { ...activeWhere, status: "PENDING", dueDate: { gte: today } },
    }),
    prisma.task.count({
      where: { ...activeWhere, status: "PENDING", dueDate: { lt: today } },
    }),
    prisma.task.findMany({
      where: {
        ...activeWhere,
        status: "PENDING",
        dueDate: { gte: today, lt: tomorrow },
      },
      include: taskInclude,
      orderBy: { dueDate: "asc" },
    }),
    prisma.task.findMany({
      where: activeWhere,
      include: taskInclude,
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  res.json({
    total,
    completed,
    pending,
    overdue,
    dueToday: dueToday.map(serializeTask),
    recentTasks: recentTasks.map(serializeTask),
  });
}

export async function taskStatus(_req: AuthRequest, res: Response): Promise<void> {
  const today = todayUTCStart();

  const [completed, pending, overdue] = await Promise.all([
    prisma.task.count({ where: { ...activeWhere, status: "COMPLETED" } }),
    prisma.task.count({
      where: { ...activeWhere, status: "PENDING", dueDate: { gte: today } },
    }),
    prisma.task.count({
      where: { ...activeWhere, status: "PENDING", dueDate: { lt: today } },
    }),
  ]);

  res.json({
    labels: ["Completed", "Pending", "Overdue"],
    data: [completed, pending, overdue],
  });
}

export async function weekly(_req: AuthRequest, res: Response): Promise<void> {
  const days: { date: Date }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = todayUTCStart();
    d.setUTCDate(d.getUTCDate() - i);
    days.push({ date: d });
  }

  const counts = await Promise.all(
    days.map(async ({ date }) => {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 1);
      return prisma.task.count({
        where: { deletedAt: null, createdAt: { gte: date, lt: next } },
      });
    })
  );

  res.json({
    labels: days.map((d) => d.date.toISOString().slice(5, 10)),
    data: counts,
  });
}

export async function notifications(req: AuthRequest, res: Response): Promise<void> {
  const today = todayUTCStart();
  const tomorrow = tomorrowUTCStart();

  const [overdue, dueToday, recent] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...activeWhere,
        status: "PENDING",
        dueDate: { lt: today },
      },
      include: taskInclude,
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: {
        ...activeWhere,
        status: "PENDING",
        dueDate: { gte: today, lt: tomorrow },
      },
      include: taskInclude,
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: activeWhere,
      include: taskInclude,
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  res.json({
    overdue: overdue.map(serializeTask),
    dueToday: dueToday.map(serializeTask),
    recent: recent.map(serializeTask),
  });
}
