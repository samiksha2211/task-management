// New tasks default to W, finalized agendas are frozen, 60-word limits, and
// the meeting PDF, against a real PostgreSQL database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, mondayOnOrAfter, todayISO } from "../services/scheduling/dates";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const upcoming = mondayOnOrAfter(addDays(today, 1)); // a future Monday, even if today is Monday
const following = addDays(upcoming, 7);

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await t.api("POST", "/api/tasks", {
    title,
    date: today,
    dueDate: addDays(today, 60),
    officerId: t.officerId,
    ...extra,
  });
  return res;
}

async function agendaIds(date: string): Promise<string[]> {
  const res = await t.api("GET", `/api/meetings/agenda?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.items.map((i: { id: string }) => i.id);
}

before(async () => {
  t = await startTestServer();
});

after(async () => {
  await t?.close();
});

describe("new tasks", () => {
  test("are weekly (W) by default and on the next Monday's agenda", async () => {
    const res = await createTask("New task without a frequency");
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.task.reviewCode, "W");
    assert.ok((await agendaIds(upcoming)).includes(res.json.task.id));
  });

  test("keep an explicitly chosen frequency, or none", async () => {
    const m = await createTask("Monthly task", { discussionFrequency: "MONTHLY", monthlyMondayOrdinal: 2 });
    assert.equal(m.json.task.reviewCode, "M");
    const none = await createTask("No frequency", { discussionFrequency: null });
    assert.equal(none.json.task.reviewCode, null);
  });

  test("saving the same new task twice does not duplicate it", async () => {
    const clientRequestId = "6f0e8a2e-4c7b-4b52-9d40-2c1f0a6f3b11";
    const a = await createTask("Offline task", { clientRequestId });
    const b = await createTask("Offline task", { clientRequestId });
    assert.equal(a.json.task.id, b.json.task.id);
    assert.equal(b.json.deduplicated, true);
    assert.equal((await agendaIds(upcoming)).filter((id) => id === a.json.task.id).length, 1);
  });

  test("editing other fields never changes an existing task's frequency", async () => {
    const ft = await createTask("Fortnightly task", { discussionFrequency: "FORTNIGHTLY", fortnightAnchor: following });
    const res = await t.api("PUT", `/api/tasks/${ft.json.task.id}`, { title: "Fortnightly task (renamed)", remarks: "Updated" });
    assert.equal(res.status, 200);
    assert.equal(res.json.task.reviewCode, "FT");
    assert.equal(res.json.task.fortnightAnchor, following);
  });
});

describe("finalized agenda", () => {
  test("is frozen: a task created afterwards goes to the following Monday", async () => {
    const before = await agendaIds(upcoming);
    const fin = await t.api("POST", `/api/meetings/${upcoming}/finalize`);
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    assert.equal(fin.json.finalized, true);
    assert.deepEqual(fin.json.items.map((i: { id: string }) => i.id).sort(), [...before].sort());

    const late = await createTask("Created after finalizing");
    assert.ok(!(await agendaIds(upcoming)).includes(late.json.task.id), "not added to the finalized agenda");
    assert.ok((await agendaIds(following)).includes(late.json.task.id), "on the following Monday");
  });

  test("finalizing again and generating the PDF repeatedly create no extra records", async () => {
    const count = await t.prisma.meetingAgendaItem.count();
    assert.equal((await t.api("POST", `/api/meetings/${upcoming}/finalize`)).status, 200);
    for (let i = 0; i < 3; i++) {
      const pdf = await t.api("GET", `/api/meetings/${upcoming}/export?format=pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
    }
    assert.equal(await t.prisma.meetingAgendaItem.count(), count);
    assert.equal(await t.prisma.meeting.count(), 1);
  });

  test("website agenda and PDF list the same tasks", async () => {
    const ids = await agendaIds(upcoming);
    const meeting = await t.prisma.meeting.findFirstOrThrow({ include: { items: true } });
    assert.deepEqual(meeting.items.map((i) => i.taskId).sort(), [...ids].sort());
  });

  test("reopening follows the calendar again", async () => {
    const late = await t.prisma.task.findFirstOrThrow({ where: { title: "Created after finalizing" } });
    const res = await t.api("POST", `/api/meetings/${upcoming}/reopen`);
    assert.equal(res.status, 200);
    assert.equal(res.json.finalized, false);
    assert.ok((await agendaIds(upcoming)).includes(late.id));
  });
});

describe("60-word limits", () => {
  test("Action Plan: 60 words saved, 61 rejected, text never shortened", async () => {
    const ok = await createTask("Plan at limit", { actionPlan: words(60) });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.task.actionPlan, words(60));
    const tooLong = await createTask("Plan too long", { actionPlan: words(61) });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.json.error, /at most 60 words/);
    const edit = await t.api("PUT", `/api/tasks/${ok.json.task.id}`, { actionPlan: words(61) });
    assert.equal(edit.status, 400);
  });

  test("BO Remark and BO Action Plan: same limit when adding and editing", async () => {
    const task = (await createTask("BO limits")).json.task;
    const url = `/api/tasks/${task.id}/officer-updates`;
    assert.equal((await t.api("POST", url, { remark: words(61) }, t.officerToken)).status, 400);
    assert.equal((await t.api("POST", url, { actionPlan: words(61) }, t.officerToken)).status, 400);
    const ok = await t.api("POST", url, { remark: words(60), actionPlan: words(60) }, t.officerToken);
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const edit = await t.api("PUT", `${url}/${ok.json.update.id}`, { remark: words(61) });
    assert.equal(edit.status, 400);
    const kept = await t.prisma.taskOfficerUpdate.findUniqueOrThrow({ where: { id: ok.json.update.id } });
    assert.equal(kept.remark, words(60), "the rejected edit changed nothing");
  });

  test("words are counted across spaces and line breaks", async () => {
    const text = `${words(30)}\n\n   ${words(30)}  `;
    assert.equal((await createTask("Spacing", { actionPlan: text })).status, 201);
  });
});

describe("meeting PDF with long text", () => {
  test("60-word remarks and plans, and older very long text, render without errors", async () => {
    const task = (await createTask("Long text task", { actionPlan: words(60) })).json.task;
    await t.prisma.taskOfficerUpdate.create({
      data: { taskId: task.id, officerId: t.officerId, remark: words(400) }, // older text, longer than a page
    });
    const pdf = await t.api("GET", `/api/meetings/${upcoming}/export?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
    const pages = (pdf.buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    assert.ok(pages >= 2, `long row continues on another page (${pages} pages)`);
  });
});
