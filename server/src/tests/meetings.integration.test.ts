// Integration tests for the review calendar, Monday agenda and PDFs against a
// real PostgreSQL database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, mondayOnOrAfter, nthMondayOfMonth, todayISO } from "../services/scheduling/dates";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const api = (method: string, url: string, body?: unknown, token?: string) => t.api(method, url, body, token);

const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const upcoming = mondayOnOrAfter(today);
const nextWeek = addDays(upcoming, 7);
const inTwoWeeks = addDays(upcoming, 14);
// The 1st Monday of the month after the upcoming Monday.
const [uy, um] = upcoming.split("-").map(Number);
const nextMonthFirst = nthMondayOfMonth(um === 12 ? uy + 1 : uy, um === 12 ? 1 : um + 1, 1);

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await api("POST", "/api/tasks", { title, date: today, dueDate: addDays(today, 60), officerId: t.officerId, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task as {
    id: string;
    taskNumber: number;
    nextDiscussionDate: string | null;
    reviewCode: string | null;
    allocatedMonday: string | null;
  };
}

async function agenda(date: string) {
  const res = await api("GET", `/api/meetings/agenda?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.items as { id: string; reviewCode: string; allocatedMonday: string; scheduledDate: string; status: string }[];
}

const ids = async (date: string) => (await agenda(date)).map((i) => i.id);

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString() === "%PDF-";
}

before(async () => {
  t = await startTestServer();
});

after(async () => {
  await t?.close();
});

describe("review calendar", () => {
  const task: Record<string, string> = {};

  test("tasks get W / FT / M with an allocated Monday", async () => {
    const w = await createTask("Weekly task", { discussionFrequency: "WEEKLY" });
    const ftA = await createTask("Fortnightly A", { discussionFrequency: "FORTNIGHTLY", fortnightAnchor: upcoming });
    const ftB = await createTask("Fortnightly B", { discussionFrequency: "FORTNIGHTLY", fortnightAnchor: nextWeek });
    const m1 = await createTask("Monthly 1st", { discussionFrequency: "MONTHLY", monthlyMondayOrdinal: 1 });
    const m5 = await createTask("Monthly 5th", { discussionFrequency: "MONTHLY", monthlyMondayOrdinal: 5 });
    const done = await createTask("Completed weekly", { discussionFrequency: "WEEKLY", status: "Completed" });
    const none = await createTask("No frequency");
    Object.assign(task, { w: w.id, ftA: ftA.id, ftB: ftB.id, m1: m1.id, m5: m5.id, done: done.id, none: none.id });

    assert.equal(w.reviewCode, "W");
    assert.equal(w.allocatedMonday, "Every Monday");
    assert.equal(w.nextDiscussionDate, upcoming);
    assert.equal(ftA.reviewCode, "FT");
    assert.equal(ftA.nextDiscussionDate, upcoming);
    assert.equal(ftB.nextDiscussionDate, nextWeek);
    assert.match(ftB.allocatedMonday!, /Monday · alternate weeks$/);
    assert.equal(m1.reviewCode, "M");
    assert.equal(m1.allocatedMonday, "1st Monday");
    assert.equal(m5.allocatedMonday, "5th Monday");
    assert.equal(none.reviewCode, null);
  });

  test("each Monday lists exactly the tasks due that day", async () => {
    for (let d = upcoming; d <= addDays(upcoming, 35); d = addDays(d, 7)) {
      const due = await ids(d);
      assert.equal(new Set(due).size, due.length, `no duplicates on ${d}`);
      assert.ok(due.includes(task.w), `weekly on ${d}`);
      assert.ok(!due.includes(task.done) && !due.includes(task.none));
      const weeks = Math.round((Date.parse(d) - Date.parse(upcoming)) / (7 * 864e5));
      assert.equal(due.includes(task.ftA), weeks % 2 === 0, `FT A on ${d}`);
      assert.equal(due.includes(task.ftB), weeks % 2 === 1, `FT B on ${d}`);
      const [y, m] = d.split("-").map(Number);
      assert.equal(due.includes(task.m1), d === nthMondayOfMonth(y, m, 1), `M 1st on ${d}`);
      assert.equal(due.includes(task.m5), d === nthMondayOfMonth(y, m, 5), `M 5th on ${d}`);
    }
  });

  test("viewing and generating PDFs repeatedly stores nothing", async () => {
    const before = await t.prisma.meetingAgendaItem.count();
    for (let i = 0; i < 3; i++) {
      await agenda(upcoming);
      const pdf = await api("GET", `/api/meetings/${upcoming}/export?format=pdf`);
      assert.equal(pdf.status, 200);
      assert.ok(isPdf(pdf.buffer));
      assert.equal((await api("GET", "/api/meetings/register/pdf?cycle=ALL")).status, 200);
    }
    assert.equal(await t.prisma.meetingAgendaItem.count(), before);
    assert.equal(await t.prisma.meeting.count(), 0);
  });

  test("ticking Discussed twice creates one record and does not move the calendar", async () => {
    const url = `/api/meetings/${upcoming}/items/${task.ftA}/outcome`;
    assert.equal((await api("POST", url, { outcome: "DISCUSSED" })).status, 200);
    assert.equal((await api("POST", url, { outcome: "DISCUSSED" })).status, 200);
    assert.equal(await t.prisma.meetingAgendaItem.count({ where: { taskId: task.ftA } }), 1);
    assert.equal(await t.prisma.meeting.count(), 1);
    assert.ok(!(await ids(nextWeek)).includes(task.ftA));
    assert.ok((await ids(inTwoWeeks)).includes(task.ftA));
    assert.equal((await api("POST", url, { outcome: "PENDING" })).status, 200);
    const ft = await t.prisma.task.findUniqueOrThrow({ where: { id: task.ftA } });
    assert.equal(ft.lastDiscussedAt, null);
  });

  test("an undiscussed task does not carry over", async () => {
    const due = await ids(nextWeek);
    assert.ok(!due.includes(task.ftA), "FT A was not ticked on the upcoming Monday, yet it is not on the next one");
  });

  test("reschedule moves one date only", async () => {
    const res = await api("POST", `/api/schedule/tasks/${task.m1}/reschedule`, { toDate: addDays(nextMonthFirst, 7), fromDate: nextMonthFirst });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(!(await ids(nextMonthFirst)).includes(task.m1));
    assert.ok((await ids(addDays(nextMonthFirst, 7))).includes(task.m1));
    const dup = await api("POST", `/api/schedule/tasks/${task.w}/reschedule`, { toDate: nextWeek });
    assert.equal(dup.status, 409, "a weekly task is already on every Monday");
  });

  test("changing W -> FT -> M -> W updates the calendar without duplicates", async () => {
    const id = task.w;
    let res = await api("PATCH", `/api/schedule/tasks/${id}/cycle`, { cycle: "FORTNIGHTLY", fortnightAnchor: nextWeek });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(!(await ids(upcoming)).includes(id));
    assert.ok((await ids(nextWeek)).includes(id));

    res = await api("PATCH", `/api/schedule/tasks/${id}/cycle`, { cycle: "MONTHLY", monthlyMondayOrdinal: 1 });
    assert.equal(res.status, 200);
    assert.ok((await ids(nextMonthFirst)).includes(id));
    assert.ok(!(await ids(addDays(nextMonthFirst, 7))).includes(id));

    res = await api("PATCH", `/api/schedule/tasks/${id}/cycle`, { cycle: "WEEKLY" });
    assert.equal(res.status, 200);
    for (const d of [upcoming, nextWeek, inTwoWeeks]) {
      const due = await ids(d);
      assert.equal(due.filter((x) => x === id).length, 1, `exactly once on ${d}`);
    }
    assert.equal((await api("PATCH", `/api/schedule/tasks/${id}/cycle`, { cycle: "FORTNIGHTLY", fortnightAnchor: addDays(upcoming, 1) })).status, 400);
  });

  test("website agenda and register PDF use the same schedule", async () => {
    const items = await agenda(upcoming);
    const register = await api("GET", "/api/meetings/register");
    for (const item of items) {
      assert.equal(item.scheduledDate, upcoming);
      const reg = register.json.tasks.find((x: { id: string }) => x.id === item.id);
      assert.equal(reg.reviewCode, item.reviewCode);
    }
    const tasksPage = await api("GET", "/api/tasks?limit=100");
    const m5 = tasksPage.json.tasks.find((x: { id: string }) => x.id === task.m5);
    const regM5 = register.json.tasks.find((x: { id: string }) => x.id === task.m5);
    assert.equal(m5.nextDiscussionDate, regM5.nextDiscussionDate, "Tasks page and Monday Meeting agree");
    assert.equal(m5.allocatedMonday, regM5.allocatedMonday);
  });

  test("bulk assign, registers per frequency, exports", async () => {
    const res = await api("POST", "/api/schedule/cycle", { taskIds: [task.none], cycle: "MONTHLY", monthlyMondayOrdinal: 2 });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.updated, 1);
    for (const cycle of ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ALL"]) {
      for (const status of ["all", "pending_overdue"]) {
        const pdf = await api("GET", `/api/meetings/register/pdf?cycle=${cycle}&status=${status}`);
        assert.equal(pdf.status, 200, `${cycle} ${status}`);
        assert.ok(isPdf(pdf.buffer));
      }
    }
    const xlsx = await api("GET", `/api/meetings/${upcoming}/export?format=xlsx`);
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), "PK");
    assert.equal((await api("GET", "/api/tasks/export?format=pdf&all=1")).status, 200, "the Task Report PDF still works");
  });

  test("admin only, Mondays only", async () => {
    assert.equal((await api("GET", "/api/meetings/register", undefined, t.officerToken)).status, 403);
    assert.equal((await api("GET", `/api/meetings/agenda?date=${addDays(upcoming, 2)}`)).status, 400);
  });
});
