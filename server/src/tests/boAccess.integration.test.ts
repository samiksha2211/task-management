// View / edit / administrative access for Branch Officers, against a real
// PostgreSQL database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, todayISO } from "../services/scheduling/dates";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");
const SHEET = "https://docs.google.com/spreadsheets/d/abc123";
let thirdToken: string;

/** officer = coordinator, otherOfficer = also assigned, third BO = not assigned. */
let taskId: string;
let updateId: string;
const task = () => `/api/tasks/${taskId}`;

before(async () => {
  t = await startTestServer();
  const { signToken } = await import("../lib/jwt");
  const third = await t.prisma.user.create({
    data: { name: "Third", email: `third-${Date.now()}@test.local`, password: "secret-hash", designation: "Sr.DCM/Chg" },
  });
  thirdToken = signToken({ userId: third.id, role: "OFFICER" });
  const res = await t.api("POST", "/api/tasks", {
    title: "Shared task",
    description: "Original description",
    remarks: "DRM remark",
    date: today,
    dueDate: addDays(today, 30),
    officerId: t.officerId,
    additionalOfficerIds: [t.otherOfficerId],
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  taskId = res.json.task.id;
});

after(async () => {
  await t?.close();
});

describe("tasks assigned to a group", () => {
  const groupTask = async (designation: string, additional?: string) => {
    const ensure = async (d: string) => (await t.api("POST", "/api/users/ensure-by-designation", { designation: d })).json.user.id;
    const res = await t.api("POST", "/api/tasks", {
      title: `For ${designation}`,
      date: today,
      dueDate: addDays(today, 30),
      officerId: await ensure(designation),
      additionalOfficerIds: additional ? [await ensure(additional)] : [],
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return `/api/tasks/${res.json.task.id}`;
  };
  const respond = (url: string, token: string) => t.api("POST", `${url}/officer-updates`, { remark: "Done from my side" }, token);

  for (const group of ["All BOs", "All Concerned BOs"]) {
    test(`every BO can respond on a task for ${group}`, async () => {
      const url = await groupTask(group);
      for (const token of [t.officerToken, t.otherOfficerToken, thirdToken]) {
        assert.equal((await respond(url, token)).status, 201);
      }
      const updates = (await t.api("GET", url)).json.task.officerUpdates;
      assert.equal(updates.length, 3, "each BO keeps their own entry");
    });
  }

  test("a group counts when it is an additional officer too", async () => {
    const url = await groupTask("Sr.DFM", "All Concerned BOs");
    assert.equal((await respond(url, thirdToken)).status, 201);
  });

  test("All Sr.DENs and All Sr.DSTEs are limited to their own officers", async () => {
    const dens = await groupTask("All Sr.DENs");
    assert.equal((await respond(dens, t.officerToken)).status, 201, "Sr.DEN/CO");
    assert.equal((await respond(dens, t.otherOfficerToken)).status, 403, "Sr.DEE/G");
    const dstes = await groupTask("All Sr.DSTEs");
    assert.equal((await respond(dstes, t.officerToken)).status, 403, "Sr.DEN/CO");
  });

  test("a BO edits only their own entry, and cannot close the task for everyone", async () => {
    const url = await groupTask("All BOs");
    const mine = (await respond(url, t.officerToken)).json.update.id;
    assert.equal((await t.api("PUT", `${url}/officer-updates/${mine}`, { remark: "Revised" }, t.officerToken)).status, 200);
    assert.equal((await t.api("PUT", `${url}/officer-updates/${mine}`, { remark: "Hacked" }, thirdToken)).status, 403);
    assert.equal((await t.api("PATCH", `${url}/status`, { status: "Completed" }, t.officerToken)).status, 403);
    assert.equal((await t.api("PATCH", `${url}/status`, { status: "Completed" })).status, 200, "the DRM can");
  });
});

describe("view access: every BO sees everything", () => {
  test("a BO who is not assigned sees the task, its officers and other BOs' updates", async () => {
    const created = await t.api(
      "POST",
      `${task()}/officer-updates`,
      { actionPlan: "Plan", actionPlanDate: addDays(today, 7), remark: "Remark", attachments: [{ kind: "LINK", url: SHEET, name: "Sheet" }] },
      t.officerToken
    );
    assert.equal(created.status, 201, JSON.stringify(created.json));
    updateId = created.json.update.id;

    const list = await t.api("GET", "/api/tasks?limit=100", undefined, thirdToken);
    assert.ok(list.json.tasks.some((x: { id: string }) => x.id === taskId));
    const one = await t.api("GET", task(), undefined, thirdToken);
    assert.equal(one.status, 200);
    assert.equal(one.json.task.officer.designation, "Sr.DEN/CO");
    assert.equal(one.json.task.additionalAssignees[0].designation, "Sr.DEE/G");
    assert.equal(one.json.task.reviewCode, "W");
    const update = one.json.task.officerUpdates[0];
    assert.equal(update.actionPlan, "Plan");
    assert.equal(update.actionPlanDate, addDays(today, 7));
    assert.equal(update.remark, "Remark");
    assert.equal(update.attachments[0].url, SHEET);
  });

  test("every BO can list all designations, and nothing else about officers", async () => {
    const res = await t.api("GET", "/api/users/designations", undefined, thirdToken);
    assert.equal(res.status, 200);
    assert.ok(res.json.designations.includes("Sr.DEN/CO"));
    assert.ok(res.json.designations.includes("Sr.DCM/Chg"));
    assert.deepEqual(Object.keys(res.json), ["designations"]);
    assert.ok(!JSON.stringify(res.json).includes("@test.local"));
    assert.equal((await t.api("GET", "/api/users", undefined, thirdToken)).status, 403, "the user list stays DRM only");
  });

  test("responses never carry an officer's password", async () => {
    const res = await t.api("POST", `${task()}/officer-updates`, { remark: "Second" }, t.otherOfficerToken);
    assert.equal(res.status, 201);
    assert.ok(!JSON.stringify(res.json).includes('"password"'));
    assert.ok(!JSON.stringify((await t.api("GET", task(), undefined, thirdToken)).json).includes('"password"'));
  });
});

describe("edit access: only assigned BOs, only their own updates", () => {
  test("a BO who is not assigned cannot submit an update or change the status", async () => {
    assert.equal((await t.api("POST", `${task()}/officer-updates`, { remark: "No" }, thirdToken)).status, 403);
    assert.equal((await t.api("PATCH", `${task()}/status`, { status: "Completed" }, thirdToken)).status, 403);
    assert.equal((await t.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status, "PENDING");
  });

  test("each assigned BO can update their own entry", async () => {
    const res = await t.api(
      "PUT",
      `${task()}/officer-updates/${updateId}`,
      { remark: "Revised", actionPlanDate: addDays(today, 10) },
      t.officerToken
    );
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const update = res.json.task.officerUpdates.find((u: { id: string }) => u.id === updateId);
    assert.equal(update.remark, "Revised");
    assert.equal(update.actionPlan, "Plan", "fields not sent are kept");
    assert.equal(update.actionPlanDate, addDays(today, 10));
    assert.ok(!JSON.stringify(res.json).includes('"password"'));
    assert.equal((await t.api("PATCH", `${task()}/status`, { status: "Running" }, t.otherOfficerToken)).status, 200);
  });

  test("a BO cannot edit, delete or change attachments on another BO's entry", async () => {
    const url = `${task()}/officer-updates/${updateId}`;
    for (const token of [t.otherOfficerToken, thirdToken]) {
      assert.equal((await t.api("PUT", url, { remark: "Hacked" }, token)).status, 403);
      assert.equal((await t.api("DELETE", url, undefined, token)).status, 403);
      assert.equal((await t.api("POST", `${task()}/attachments`, { officerUpdateId: updateId, links: [{ url: SHEET }] }, token)).status, 403);
    }
    const kept = await t.prisma.taskOfficerUpdate.findUniqueOrThrow({ where: { id: updateId }, include: { attachments: true } });
    assert.equal(kept.remark, "Revised");
    const att = kept.attachments[0];
    assert.equal((await t.api("DELETE", `${task()}/attachments/${att.id}`, undefined, t.otherOfficerToken)).status, 403);
  });

  test("a BO removed from a task can no longer change their old entry", async () => {
    const created = await t.api("POST", "/api/tasks", {
      title: "Reassigned task",
      date: today,
      dueDate: addDays(today, 30),
      officerId: t.officerId,
      additionalOfficerIds: [t.otherOfficerId],
    });
    const id = created.json.task.id;
    const up = await t.api("POST", `/api/tasks/${id}/officer-updates`, { remark: "Mine" }, t.otherOfficerToken);
    assert.equal((await t.api("PUT", `/api/tasks/${id}`, { additionalOfficerIds: [] })).status, 200);
    assert.equal((await t.api("PUT", `/api/tasks/${id}/officer-updates/${up.json.update.id}`, { remark: "Late" }, t.otherOfficerToken)).status, 403);
  });
});

describe("administrative access: DRM only", () => {
  test("BOs cannot change DRM-controlled fields, even on their own task", async () => {
    const token = t.officerToken;
    assert.equal((await t.api("PUT", task(), { remarks: "Changed", description: "Changed" }, token)).status, 403);
    assert.equal((await t.api("PATCH", `/api/schedule/tasks/${taskId}/cycle`, { cycle: "F1" }, token)).status, 403);
    assert.equal((await t.api("POST", `/api/schedule/tasks/${taskId}/reschedule`, { toDate: "2030-01-07" }, token)).status, 403);
    assert.equal((await t.api("POST", `/api/schedule/tasks/${taskId}/important`, { important: true }, token)).status, 403);
    assert.equal((await t.api("DELETE", task(), undefined, token)).status, 403);
    assert.equal((await t.api("POST", `${task()}/attachments`, { links: [{ url: SHEET }] }, token)).status, 403);
    assert.equal((await t.api("DELETE", `${task()}/officer-updates/${updateId}`, undefined, token)).status, 403, "BO entries are removed by the DRM only");
    const row = await t.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(row.remarks, "DRM remark");
    assert.equal(row.description, "Original description");
    assert.equal(row.discussionFrequency, "WEEKLY");
  });

  test("the DRM keeps full control", async () => {
    assert.equal((await t.api("PUT", `${task()}/officer-updates/${updateId}`, { remark: "DRM corrected" })).status, 200);
    assert.equal((await t.api("PATCH", `${task()}/status`, { status: "Pending" })).status, 200);
    assert.equal((await t.api("DELETE", `${task()}/officer-updates/${updateId}`)).status, 200);
  });
});
