// Integration tests for the meeting agenda / scheduling API against a real
// PostgreSQL database.
//
// By default a throwaway PostgreSQL server is started with embedded-postgres
// and every migration is applied to it from scratch. Set TEST_DATABASE_URL to
// use an existing *empty test* database instead. The tests refuse to run
// against the database in DATABASE_URL.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { addDays, mondayOnOrAfter, todayISO } from "../services/scheduling/dates";
import { monthlySlot } from "../services/scheduling/rules";

const serverRoot = path.resolve(__dirname, "../..");
let pg: { stop: () => Promise<void> } | null = null;
let pgDir: string | null = null;
let server: Server;
let prisma: PrismaClient;
let baseUrl = "";
let adminToken = "";
let officerToken = "";
let officerId = "";

const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const upcoming = mondayOnOrAfter(today);
const nextWeek = addDays(upcoming, 7);
const inTwoWeeks = addDays(upcoming, 14);

async function startDatabase(): Promise<string> {
  if (process.env.TEST_DATABASE_URL) {
    if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not be the application database.");
    }
    return process.env.TEST_DATABASE_URL;
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  pgDir = fs.mkdtempSync(path.join(os.tmpdir(), "railwork-pg-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const instance = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: "railwork_test",
    password: "railwork_test",
    port,
    persistent: false,
    onLog: () => {},
  });
  await instance.initialise();
  await instance.start();
  await instance.createDatabase("railwork_test");
  pg = instance;
  return `postgresql://railwork_test:railwork_test@localhost:${port}/railwork_test`;
}

async function api(
  method: string,
  url: string,
  body?: unknown,
  token = adminToken
): Promise<{ status: number; json: any; headers: Headers; buffer: Buffer }> {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  if ((res.headers.get("content-type") ?? "").includes("json")) json = JSON.parse(buffer.toString("utf8"));
  return { status: res.status, json, headers: res.headers, buffer };
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await api("POST", "/api/tasks", {
    title,
    date: today,
    dueDate: addDays(today, 120),
    officerId,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task as { id: string; nextDiscussionDate: string | null; discussionFrequency: string | null };
}

function agendaTaskIds(agenda: any): string[] {
  return agenda.sections.flatMap((s: any) => s.items.map((i: any) => i.taskId));
}

async function agenda(date: string) {
  const res = await api("GET", `/api/meetings/agenda?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
}

before(async () => {
  const url = await startDatabase();
  execFileSync(process.execPath, [path.join(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url;

  const express = (await import("express")).default;
  const { default: router } = await import("../routes");
  const { errorHandler, notFound } = await import("../middleware/error");
  const { signToken } = await import("../lib/jwt");
  prisma = (await import("../prisma")).prisma;

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(notFound);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const stamp = Date.now();
  const admin = await prisma.user.create({
    data: { name: "Admin", email: `admin-${stamp}@test.local`, password: "x", designation: "DRM", role: "ADMIN" },
  });
  const officer = await prisma.user.create({
    data: { name: "Officer", email: `officer-${stamp}@test.local`, password: "x", designation: "Sr.DEN/CO" },
  });
  officerId = officer.id;
  adminToken = signToken({ userId: admin.id, role: "ADMIN" });
  officerToken = signToken({ userId: officer.id, role: "OFFICER" });
});

after(async () => {
  server?.close();
  await prisma?.$disconnect();
  if (pg) await pg.stop();
  if (pgDir) fs.rmSync(pgDir, { recursive: true, force: true });
});

describe("meeting agenda API", () => {
  const ids: Record<string, string> = {};

  test("new tasks get a first discussion date from their frequency", async () => {
    const weekly = await createTask("Weekly task", { discussionFrequency: "M" });
    const fortnightly = await createTask("Fortnightly task", { discussionFrequency: "F" });
    const monthly = await createTask("Monthly task", { discussionFrequency: "NM" });
    const unscheduled = await createTask("Legacy task");
    const done = await createTask("Completed task", { discussionFrequency: "M", status: "Completed" });
    Object.assign(ids, {
      weekly: weekly.id,
      fortnightly: fortnightly.id,
      monthly: monthly.id,
      unscheduled: unscheduled.id,
      done: done.id,
    });

    assert.equal(weekly.nextDiscussionDate, upcoming);
    assert.equal(fortnightly.nextDiscussionDate, nextWeek);
    assert.equal(monthly.nextDiscussionDate, monthlySlot(today, 1));
    assert.equal(unscheduled.discussionFrequency, null);
    assert.equal(unscheduled.nextDiscussionDate, null);
  });

  test("the agenda contains only tasks that are due, and lists unscheduled ones separately", async () => {
    const view = await agenda(upcoming);
    const onAgenda = agendaTaskIds(view);
    assert.ok(onAgenda.includes(ids.weekly));
    assert.ok(!onAgenda.includes(ids.fortnightly), "fortnightly is not due yet");
    assert.ok(!onAgenda.includes(ids.unscheduled), "no frequency, no agenda");
    assert.ok(!onAgenda.includes(ids.done), "completed tasks never appear");
    assert.ok(view.unscheduled.some((t: any) => t.taskId === ids.unscheduled));
    assert.equal(view.meeting, null, "viewing an agenda does not create a meeting");
  });

  test("saving the agenda twice does not create duplicate records", async () => {
    assert.equal((await api("POST", `/api/meetings/${upcoming}/save`)).status, 200);
    assert.equal((await api("POST", `/api/meetings/${upcoming}/save`)).status, 200);
    const meetings = await prisma.meeting.findMany({ where: { meetingDate: new Date(`${upcoming}T00:00:00Z`) } });
    assert.equal(meetings.length, 1);
    const items = await prisma.meetingAgendaItem.findMany({ where: { meetingId: meetings[0].id, taskId: ids.weekly } });
    assert.equal(items.length, 1);
  });

  test("a task cannot be added to the same meeting twice", async () => {
    const first = await api("POST", `/api/meetings/${upcoming}/items`, { taskId: ids.fortnightly, reason: "Raised by DRM" });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const second = await api("POST", `/api/meetings/${upcoming}/items`, { taskId: ids.fortnightly, reason: "Again" });
    assert.equal(second.status, 409);
    const third = await api("POST", `/api/meetings/${upcoming}/items`, { taskId: ids.weekly, reason: "Already due" });
    assert.equal(third.status, 409);
  });

  test("only an actual discussion moves the schedule, and it can be undone", async () => {
    const url = `/api/meetings/${upcoming}/items/${ids.weekly}/outcome`;
    let res = await api("POST", url, { outcome: "DISCUSSED", decisions: "Proceed with tender" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    let task = await prisma.task.findUniqueOrThrow({ where: { id: ids.weekly } });
    assert.equal(task.lastDiscussedAt?.toISOString().slice(0, 10), upcoming);
    assert.equal(task.nextDiscussionDate?.toISOString().slice(0, 10), nextWeek);

    res = await api("POST", url, { outcome: "NOT_DISCUSSED" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    task = await prisma.task.findUniqueOrThrow({ where: { id: ids.weekly } });
    assert.equal(task.lastDiscussedAt, null, "undo restores the previous schedule");
    assert.equal(task.nextDiscussionDate?.toISOString().slice(0, 10), upcoming);

    const following = await agenda(nextWeek);
    const item = following.sections.flatMap((s: any) => s.items).find((i: any) => i.taskId === ids.weekly);
    assert.ok(item, "a task that was not discussed carries over");
    assert.match(item.reason, /Carried over/);
  });

  test("a deferred task appears on its revised date only", async () => {
    let res = await api("POST", `/api/schedule/tasks/${ids.fortnightly}/defer`, {
      toDate: inTwoWeeks,
      reason: "Meeting overloaded",
      meetingDate: upcoming,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const task = await prisma.task.findUniqueOrThrow({ where: { id: ids.fortnightly } });
    assert.equal(task.discussionFrequency, "F", "frequency is preserved");
    assert.equal(task.scheduleState, "DEFERRED");
    assert.equal(task.originalDiscussionDate?.toISOString().slice(0, 10), nextWeek);
    assert.ok(!agendaTaskIds(await agenda(nextWeek)).includes(ids.fortnightly));
    assert.ok(agendaTaskIds(await agenda(inTwoWeeks)).includes(ids.fortnightly));

    const meetingItem = (await agenda(upcoming)).sections
      .flatMap((s: any) => s.items)
      .find((i: any) => i.taskId === ids.fortnightly);
    assert.equal(meetingItem.outcome, "DEFERRED");
    assert.equal(meetingItem.deferredTo, inTwoWeeks);

    res = await api("POST", `/api/schedule/tasks/${ids.fortnightly}/defer`, {
      toDate: addDays(inTwoWeeks, 1),
      reason: "Not a Monday",
    });
    assert.equal(res.status, 400);
  });

  // On the few days when next month's first Monday is also the upcoming
  // Monday, the monthly task is already due and cannot be brought forward.
  test("an urgent monthly task is brought forward without changing its frequency", {
    skip: monthlySlot(today, 1) === upcoming,
  }, async () => {
    const res = await api("POST", `/api/schedule/tasks/${ids.monthly}/bring-forward`, {
      toDate: upcoming,
      reason: "Signal failure reported in Monday PDF",
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const task = await prisma.task.findUniqueOrThrow({ where: { id: ids.monthly } });
    assert.equal(task.discussionFrequency, "NM");
    assert.equal(task.scheduleState, "BROUGHT_FORWARD");
    const view = await agenda(upcoming);
    const urgent = view.sections.find((s: any) => s.key === "URGENT");
    assert.ok(urgent.items.some((i: any) => i.taskId === ids.monthly && i.inclusion === "BROUGHT_FORWARD"));
  });

  test("a completed task drops off future agendas", async () => {
    assert.equal((await api("POST", `/api/schedule/tasks/${ids.weekly}/complete`, {})).status, 200);
    assert.ok(!agendaTaskIds(await agenda(nextWeek)).includes(ids.weekly));
  });

  test("bulk initialization schedules only unscheduled tasks", async () => {
    const res = await api("POST", "/api/schedule/initialize", {
      taskIds: [ids.unscheduled, ids.monthly],
      discussionFrequency: "F",
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.initialized, 1);
    const legacy = await prisma.task.findUniqueOrThrow({ where: { id: ids.unscheduled } });
    assert.equal(legacy.discussionFrequency, "F");
    assert.ok([upcoming, nextWeek].includes(legacy.nextDiscussionDate!.toISOString().slice(0, 10)));
    const monthly = await prisma.task.findUniqueOrThrow({ where: { id: ids.monthly } });
    assert.equal(monthly.discussionFrequency, "NM", "already-scheduled tasks are untouched");
  });

  test("changing frequency keeps past meeting history", async () => {
    const before = await prisma.meetingAgendaItem.findMany({ where: { taskId: ids.fortnightly } });
    const res = await api("PATCH", `/api/schedule/tasks/${ids.fortnightly}`, {
      discussionFrequency: "M",
      recalculate: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const afterItems = await prisma.meetingAgendaItem.findMany({ where: { taskId: ids.fortnightly } });
    assert.deepEqual(
      afterItems.map((i) => [i.id, i.outcome]),
      before.map((i) => [i.id, i.outcome])
    );
    const task = await prisma.task.findUniqueOrThrow({ where: { id: ids.fortnightly } });
    assert.equal(task.discussionFrequency, "M");
    assert.equal(task.scheduleState, "SCHEDULED");
  });

  test("history records every scheduling change", async () => {
    const res = await api("GET", `/api/schedule/tasks/${ids.fortnightly}/history`);
    assert.equal(res.status, 200);
    const types = res.json.events.map((e: any) => e.type);
    for (const type of ["INITIALIZED", "ADDED_TO_AGENDA", "DEFERRED", "FREQUENCY_CHANGED"]) {
      assert.ok(types.includes(type), `missing ${type} in ${types.join(",")}`);
    }
    assert.ok(res.json.meetings.some((m: any) => m.outcome === "DEFERRED"));
  });

  test("the agenda exports to Excel", async () => {
    await api("POST", `/api/meetings/${upcoming}/status`, { status: "FINALIZED" });
    const res = await api("GET", `/api/meetings/${upcoming}/export?format=xlsx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.equal(res.buffer.subarray(0, 2).toString(), "PK", "xlsx is a zip file");
    assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`monday_agenda_${upcoming}\\.xlsx`));
  });

  test("closing a meeting marks undiscussed items as not discussed", async () => {
    const res = await api("POST", `/api/meetings/${upcoming}/status`, { status: "CLOSED" });
    assert.equal(res.status, 200);
    const pending = await prisma.meetingAgendaItem.count({
      where: { meeting: { meetingDate: new Date(`${upcoming}T00:00:00Z`) }, outcome: "PENDING" },
    });
    assert.equal(pending, 0);
  });

  test("meeting endpoints are admin-only", async () => {
    const res = await api("GET", `/api/meetings/agenda?date=${upcoming}`, undefined, officerToken);
    assert.equal(res.status, 403);
  });

  test("dates that are not Mondays are rejected", async () => {
    const res = await api("GET", `/api/meetings/agenda?date=${addDays(upcoming, 2)}`);
    assert.equal(res.status, 400);
  });
});
