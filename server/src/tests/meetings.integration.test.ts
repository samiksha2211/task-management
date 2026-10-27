// Integration tests for the cycle registers, PDFs and Monday agenda against a
// real PostgreSQL database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, mondayOnOrAfter, todayISO } from "../services/scheduling/dates";
import { monthlySlot } from "../services/scheduling/rules";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const api = (method: string, url: string, body?: unknown, token?: string) => t.api(method, url, body, token);

const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const upcoming = mondayOnOrAfter(today);
const nextWeek = addDays(upcoming, 7);
const inTwoWeeks = addDays(upcoming, 14);
// In the week before the first Monday of a month, monthly tasks are due at the next meeting.
const monthlyIsNext = monthlySlot(today, 1) === upcoming;

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await api("POST", "/api/tasks", { title, date: today, dueDate: addDays(today, 60), officerId: t.officerId, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task as { id: string; taskNumber: number; nextDiscussionDate: string | null };
}

async function agendaIds(date: string): Promise<string[]> {
  const res = await api("GET", `/api/meetings/agenda?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.items.map((i: { id: string }) => i.id);
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString() === "%PDF-";
}

before(async () => {
  t = await startTestServer();
});

after(async () => {
  await t?.close();
});

describe("discussion cycles", () => {
  const ids: Record<string, string> = {};

  test("tasks get readable IDs and a first date from their cycle", async () => {
    const weekly = await createTask("Weekly task", { discussionFrequency: "WEEKLY" });
    const fortnightly = await createTask("Fortnightly task", { discussionFrequency: "FORTNIGHTLY" });
    // Already past its deadline: still goes to next month, not this week.
    const monthly = await createTask("Monthly overdue task", {
      discussionFrequency: "MONTHLY",
      dueDate: addDays(today, -30),
    });
    const done = await createTask("Completed monthly task", { discussionFrequency: "MONTHLY", status: "Completed" });
    const unassigned = await createTask("Unassigned task");
    Object.assign(ids, { weekly: weekly.id, fortnightly: fortnightly.id, monthly: monthly.id, done: done.id, unassigned: unassigned.id });

    assert.ok(weekly.taskNumber > 0 && fortnightly.taskNumber === weekly.taskNumber + 1);
    assert.equal(weekly.nextDiscussionDate, upcoming);
    assert.equal(fortnightly.nextDiscussionDate, upcoming);
    assert.equal(monthly.nextDiscussionDate, monthlySlot(today, 1));
    assert.equal(unassigned.nextDiscussionDate, null);
  });

  test("the register lists every task with its status, and counts per cycle", async () => {
    const res = await api("GET", "/api/meetings/register");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.counts, { WEEKLY: 1, FORTNIGHTLY: 1, MONTHLY: 2, UNASSIGNED: 1 });
    const monthly = res.json.tasks.filter((t: { cycle: string }) => t.cycle === "MONTHLY");
    assert.deepEqual(monthly.map((t: { status: string }) => t.status).sort(), ["Completed", "Overdue"]);
  });

  test("each cycle downloads as a PDF with all statuses", async () => {
    for (const cycle of ["WEEKLY", "FORTNIGHTLY", "MONTHLY"]) {
      const res = await api("GET", `/api/meetings/register/pdf?cycle=${cycle}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      assert.ok(isPdf(res.buffer));
      assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`monday_meeting_${cycle.toLowerCase()}_`));
    }
    for (const status of ["completed", "pending_overdue"]) {
      const filtered = await api("GET", `/api/meetings/register/pdf?cycle=MONTHLY&status=${status}`);
      assert.equal(filtered.status, 200);
      assert.ok(isPdf(filtered.buffer));
    }
    const combined = await api("GET", "/api/meetings/register/pdf?cycle=ALL&status=pending_overdue");
    assert.equal(combined.status, 200);
    assert.ok(isPdf(combined.buffer));
    assert.match(combined.headers.get("content-disposition") ?? "", /monday_meeting_all_pending_overdue_/);
    assert.equal((await api("GET", "/api/meetings/register/pdf?cycle=DAILY")).status, 400);
  });

  test("the agenda has only due tasks, each once; monthly only on its Monday", async () => {
    const onAgenda = await agendaIds(upcoming);
    const expected = [ids.weekly, ids.fortnightly, ...(monthlyIsNext ? [ids.monthly] : [])];
    assert.deepEqual(onAgenda.sort(), expected.sort());
    assert.equal(new Set(onAgenda).size, onAgenda.length, "no duplicates");
  });

  test("marking discussed moves only that task, persists, and can be undone", async () => {
    const url = `/api/meetings/${upcoming}/items/${ids.fortnightly}/outcome`;
    assert.equal((await api("POST", url, { outcome: "DISCUSSED" })).status, 200);
    assert.equal((await api("POST", url, { outcome: "DISCUSSED" })).status, 200, "repeat is harmless");
    let task = await t.prisma.task.findUniqueOrThrow({ where: { id: ids.fortnightly } });
    assert.equal(task.nextDiscussionDate?.toISOString().slice(0, 10), inTwoWeeks);
    assert.ok(!(await agendaIds(nextWeek)).includes(ids.fortnightly), "fortnightly skips the next Monday");
    assert.ok((await agendaIds(inTwoWeeks)).includes(ids.fortnightly));

    const items = await t.prisma.meetingAgendaItem.count({ where: { taskId: ids.fortnightly } });
    assert.equal(items, 1, "no duplicate agenda record");

    assert.equal((await api("POST", url, { outcome: "PENDING" })).status, 200);
    task = await t.prisma.task.findUniqueOrThrow({ where: { id: ids.fortnightly } });
    assert.equal(task.nextDiscussionDate?.toISOString().slice(0, 10), upcoming);
    assert.equal(task.lastDiscussedAt, null);
  });

  test("reschedule moves a monthly task without changing its cycle", async () => {
    const target = monthlyIsNext ? nextWeek : upcoming;
    const res = await api("POST", `/api/schedule/tasks/${ids.monthly}/reschedule`, { toDate: target, reason: "Urgent" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const task = await t.prisma.task.findUniqueOrThrow({ where: { id: ids.monthly } });
    assert.equal(task.discussionFrequency, "MONTHLY");
    assert.ok((await agendaIds(target)).includes(ids.monthly));
    if (monthlyIsNext) assert.ok(!(await agendaIds(upcoming)).includes(ids.monthly), "moved off its old date");
    const bad = await api("POST", `/api/schedule/tasks/${ids.monthly}/reschedule`, { toDate: addDays(upcoming, 1) });
    assert.equal(bad.status, 400);
  });

  test("changing a cycle persists and recalculates; bulk assign works", async () => {
    let res = await api("PATCH", `/api/schedule/tasks/${ids.weekly}/cycle`, { cycle: "MONTHLY" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const weekly = await t.prisma.task.findUniqueOrThrow({ where: { id: ids.weekly } });
    assert.equal(weekly.discussionFrequency, "MONTHLY");
    assert.equal(weekly.nextDiscussionDate?.toISOString().slice(0, 10), monthlySlot(today, 1));
    assert.equal((await agendaIds(upcoming)).includes(ids.weekly), monthlyIsNext);

    res = await api("POST", "/api/schedule/cycle", { taskIds: [ids.unassigned, ids.weekly], cycle: "WEEKLY" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.updated, 2);
    const register = await api("GET", "/api/meetings/register");
    assert.equal(register.json.counts.UNASSIGNED, 0);
  });

  test("history records the changes", async () => {
    const res = await api("GET", `/api/schedule/tasks/${ids.fortnightly}/history`);
    assert.equal(res.status, 200);
    const types = res.json.events.map((e: { type: string }) => e.type);
    for (const t of ["INITIALIZED", "DISCUSSED", "DISCUSSION_UNDONE"]) assert.ok(types.includes(t), types.join(","));
  });

  test("agenda exports as PDF and Excel", async () => {
    const pdf = await api("GET", `/api/meetings/${upcoming}/export?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(isPdf(pdf.buffer));
    const xlsx = await api("GET", `/api/meetings/${upcoming}/export?format=xlsx`);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), "PK");
  });

  test("admin only, Mondays only", async () => {
    assert.equal((await api("GET", "/api/meetings/register", undefined, t.officerToken)).status, 403);
    assert.equal((await api("GET", `/api/meetings/agenda?date=${addDays(upcoming, 2)}`)).status, 400);
  });
});
