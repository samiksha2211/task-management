// Monday Discussion Agenda: one-time review frequencies (Next Monday / Next
// Month / Flexible Date), "important", the Running status, the 12-column
// agenda and its PDF, against a real PostgreSQL database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, mondayOnOrAfter, todayISO } from "../services/scheduling/dates";
import { nextMonthMondays } from "../services/scheduling/rules";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const upcoming = mondayOnOrAfter(today);
const later = addDays(upcoming, 21);
const nextMonth = nextMonthMondays(today);

interface AgendaItem {
  id: string;
  serial: number;
  date: string;
  title: string;
  frequency: string;
  status: string;
  important: boolean;
  officer: string;
  otherOfficers: string[];
  actionPlan: string | null;
  dueDate: string;
  drmRemark: string | null;
  drmFiles: { url: string }[];
  latestBo: { remark: string | null; files: { url: string }[] } | null;
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await t.api("POST", "/api/tasks", {
    title,
    date: today,
    dueDate: addDays(today, 60),
    officerId: t.officerId,
    discussionFrequency: null,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task as { id: string; status: string; reviewCode: string | null; allocatedMondayDate: string | null };
}

async function agenda(date: string): Promise<AgendaItem[]> {
  const res = await t.api("GET", `/api/meetings/agenda?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.items;
}
const ids = async (date: string) => (await agenda(date)).map((i) => i.id);

before(async () => {
  t = await startTestServer();
});

after(async () => {
  await t?.close();
});

describe("one-time review frequencies", () => {
  test("1. Next Monday: on the coming Monday only", async () => {
    const task = await createTask("Next Monday task", { discussionFrequency: "NEXT_MONDAY" });
    assert.equal(task.allocatedMondayDate, upcoming);
    assert.ok((await ids(upcoming)).includes(task.id));
    assert.ok(!(await ids(addDays(upcoming, 7))).includes(task.id));
  });

  test("2. Next Month: the DRM picks one of next month's Mondays", async () => {
    const pick = nextMonth[1];
    const task = await createTask("Next Month task", { discussionFrequency: "NEXT_MONTH", allocatedMonday: pick });
    assert.equal(task.allocatedMondayDate, pick);
    assert.ok((await ids(pick)).includes(task.id));
    assert.ok(!(await ids(nextMonth[0])).includes(task.id));
    const bad = await t.api("POST", "/api/tasks", {
      title: "Bad", date: today, dueDate: today, officerId: t.officerId,
      discussionFrequency: "NEXT_MONTH", allocatedMonday: upcoming,
    });
    assert.ok(bad.status >= 400, "a Monday outside next month is rejected");
  });

  test("3. Flexible Date, and the Allocated Monday can be changed (reschedule)", async () => {
    const task = await createTask("Flexible task", { discussionFrequency: "FLEXIBLE", allocatedMonday: later });
    assert.ok((await ids(later)).includes(task.id));
    const moved = await t.api("POST", `/api/schedule/tasks/${task.id}/reschedule`, { toDate: addDays(later, 7) });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.ok(!(await ids(later)).includes(task.id));
    assert.ok((await ids(addDays(later, 7))).includes(task.id));
    const row = await t.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.discussionFrequency, "FLEXIBLE", "the frequency stays");
  });

  test("4. existing W / FT / M tasks are unchanged", async () => {
    const w = await createTask("Weekly task", { discussionFrequency: "WEEKLY" });
    assert.equal(w.reviewCode, "W");
    assert.equal(w.allocatedMondayDate, null);
    for (const d of [upcoming, addDays(upcoming, 7), later]) assert.ok((await ids(d)).includes(w.id));
  });
});

describe("important", () => {
  test("5. marking important puts the task on the coming Monday and highlights it", async () => {
    const task = await createTask("Urgent bridge inspection", { discussionFrequency: "FLEXIBLE", allocatedMonday: later });
    const res = await t.api("POST", `/api/schedule/tasks/${task.id}/important`, { important: true });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const item = (await agenda(upcoming)).find((i) => i.id === task.id);
    assert.ok(item, "on the coming Monday");
    assert.equal(item.important, true);
    assert.ok(!(await ids(later)).includes(task.id), "moved, not duplicated");

    const none = await createTask("Not scheduled yet");
    await t.api("POST", `/api/schedule/tasks/${none.id}/important`, { important: true });
    assert.ok((await ids(upcoming)).includes(none.id), "a task without a frequency becomes Next Monday");

    await t.api("POST", `/api/schedule/tasks/${task.id}/important`, { important: false });
    assert.equal((await agenda(upcoming)).find((i) => i.id === task.id)?.important, false);
    assert.equal((await t.api("POST", `/api/schedule/tasks/${task.id}/important`, {}, t.officerToken)).status, 403);
  });
});

describe("Running status", () => {
  test("6. a Running task past its execution date is not Overdue", async () => {
    const task = await createTask("Track renewal", { status: "Running", dueDate: addDays(today, -10), discussionFrequency: "WEEKLY" });
    assert.equal(task.status, "Running");
    const pendingLate = await createTask("Pending late", { dueDate: addDays(today, -10) });
    assert.equal(pendingLate.status, "Overdue", "the existing Overdue rule is unchanged");

    const list = async (status: string) =>
      ((await t.api("GET", `/api/tasks?status=${status}&limit=200`)).json.tasks as { id: string }[]).map((x) => x.id);
    assert.ok((await list("running")).includes(task.id));
    assert.ok(!(await list("overdue")).includes(task.id));
    assert.ok(!(await list("pending")).includes(task.id));
    assert.ok((await list("overdue")).includes(pendingLate.id));

    const change = await t.api("PATCH", `/api/tasks/${pendingLate.id}/status`, { status: "Running" });
    assert.equal(change.status, 200, JSON.stringify(change.json));
    assert.equal(change.json.task?.status ?? "Running", "Running");
    assert.equal((await agenda(upcoming)).find((i) => i.id === task.id)?.status, "Running", "Running tasks stay on the agenda");
    const stats = await t.api("GET", "/api/dashboard/stats");
    assert.ok(stats.json.running >= 2);
  });
});

describe("12-column agenda", () => {
  test("7. only tasks allocated to the selected Monday, newest date first, S.N. renumbered", async () => {
    const old = await createTask("Older task", { date: addDays(today, -30), discussionFrequency: "FLEXIBLE", allocatedMonday: addDays(later, 14) });
    const recent = await createTask("Recent task", { date: addDays(today, -1), discussionFrequency: "FLEXIBLE", allocatedMonday: addDays(later, 14) });
    const items = await agenda(addDays(later, 14));
    const onlyOneTime = items.filter((i) => i.frequency !== "W (Weekly)");
    assert.deepEqual(onlyOneTime.map((i) => i.id), [recent.id, old.id]);
    assert.deepEqual(items.map((i) => i.serial), items.map((_, i) => i + 1));
    const dates = items.map((i) => i.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test("8. latest DRM remark and BO remark with their files", async () => {
    const task = await createTask("Remarks task", {
      discussionFrequency: "NEXT_MONDAY",
      remarks: "DRM: expedite",
      actionPlan: "Plan A",
    });
    await t.prisma.taskAttachment.create({ data: { taskId: task.id, kind: "LINK", url: "https://docs.google.com/spreadsheets/d/drm", name: "DRM sheet" } });
    const first = await t.prisma.taskOfficerUpdate.create({ data: { taskId: task.id, officerId: t.officerId, remark: "Old BO remark", createdAt: new Date(Date.now() - 864e5) } });
    const latest = await t.prisma.taskOfficerUpdate.create({ data: { taskId: task.id, officerId: t.officerId, remark: "Latest BO remark" } });
    await t.prisma.taskAttachment.create({ data: { taskId: task.id, officerUpdateId: latest.id, kind: "LINK", url: "https://docs.google.com/spreadsheets/d/bo", name: "BO sheet" } });
    await t.prisma.taskAttachment.create({ data: { taskId: task.id, officerUpdateId: first.id, kind: "LINK", url: "https://example.com/old", name: "old" } });

    const item = (await agenda(upcoming)).find((i) => i.id === task.id)!;
    assert.equal(item.drmRemark, "DRM: expedite");
    assert.deepEqual(item.drmFiles.map((f) => f.url), ["https://docs.google.com/spreadsheets/d/drm"]);
    assert.equal(item.latestBo?.remark, "Latest BO remark");
    assert.deepEqual(item.latestBo?.files.map((f) => f.url), ["https://docs.google.com/spreadsheets/d/bo"]);
    assert.equal(item.actionPlan, "Plan A");
    assert.ok(item.officer && Array.isArray(item.otherOfficers) && item.dueDate);
  });

  test("9. Monday Discussion Agenda PDF: generated read-only, landscape, only that Monday's tasks", async () => {
    const before = await t.prisma.meetingAgendaItem.count();
    const pdf = await t.api("GET", `/api/meetings/${upcoming}/export?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.buffer.toString("latin1"), /MediaBox \[0 0 841\.89 595\.28\]/, "A4 landscape");
    assert.equal(await t.prisma.meetingAgendaItem.count(), before);
    assert.equal((await t.api("GET", `/api/meetings/${addDays(upcoming, 1)}/export?format=pdf`)).status, 400, "Mondays only");
  });

  test("10. existing Task Report PDF filters still work", async () => {
    for (const status of ["", "pending", "overdue", "completed", "running"]) {
      const res = await t.api("GET", `/api/tasks/export?format=pdf&all=1${status ? `&status=${status}` : ""}`);
      assert.equal(res.status, 200, status);
      assert.equal(res.buffer.subarray(0, 5).toString(), "%PDF-");
    }
    for (const cycle of ["WEEKLY", "ALL"]) {
      assert.equal((await t.api("GET", `/api/meetings/register/pdf?cycle=${cycle}&status=pending_overdue`)).status, 200);
    }
  });
});
