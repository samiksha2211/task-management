// DRM-managed BO logins and closed registration, against a real PostgreSQL
// database (see testServer.ts).

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { addDays, todayISO } from "../services/scheduling/dates";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const today = todayISO(process.env.MEETING_TIME_ZONE || "Asia/Kolkata");

async function ensure(designation: string): Promise<string> {
  const res = await t.api("POST", "/api/users/ensure-by-designation", { designation });
  return res.json.user.id;
}

async function assignTask(title: string, officerId: string, additionalOfficerIds: string[] = []): Promise<string> {
  const res = await t.api("POST", "/api/tasks", { title, date: today, dueDate: addDays(today, 30), officerId, additionalOfficerIds });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task.id;
}

async function login(email: string, password: string) {
  return t.api("POST", "/api/auth/login", { email, password }, "");
}

const row = async (designation: string) =>
  (await t.api("GET", "/api/users/logins")).json.logins.find((l: { designation: string }) => l.designation === designation);

before(async () => {
  t = await startTestServer();
});

after(async () => {
  await t?.close();
});

describe("BO logins", () => {
  test("setting a login gives the BO the tasks already assigned to that designation", async () => {
    const id = await ensure("Sr.DOM/Co");
    const taskId = await assignTask("Yard remodelling", id);
    assert.equal((await row("Sr.DOM/Co")).ready, false, "an automatic account is not a login");
    assert.equal((await login("sr-dom-co@railwork.local", "anything")).status, 401);

    const set = await t.api("PUT", "/api/users/logins", { designation: "Sr.DOM/Co", email: "Dom.Co@Example.com", password: "start-pass-1" });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.login.ready, true);
    assert.equal(set.json.login.tasks, 1);
    assert.ok(!JSON.stringify(set.json).includes("start-pass-1"));

    const session = await login("dom.co@example.com", "start-pass-1");
    assert.equal(session.status, 200);
    assert.equal(session.json.user.id, id, "same account, not a new one");
    assert.equal(session.json.user.role, "OFFICER");
    const update = await t.api("POST", `/api/tasks/${taskId}/officer-updates`, { remark: "On it" }, session.json.token);
    assert.equal(update.status, 201, "the BO can respond on their own task");
  });

  test("a new login needs both e-mail and password; a later change can send either", async () => {
    await ensure("Sr.DFM");
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM", email: "dfm@example.com" })).status, 400);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM", password: "secret12" })).status, 400);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM", email: "dfm@example.com", password: "secret12" })).status, 200);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM", password: "secret34" })).status, 200);
    assert.equal((await login("dfm@example.com", "secret12")).status, 401, "the old password stops working");
    assert.equal((await login("dfm@example.com", "secret34")).status, 200);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM", email: "dfm2@example.com" })).status, 200);
    assert.equal((await login("dfm2@example.com", "secret34")).status, 200);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DFM" })).status, 400);
  });

  test("a designation with no account yet gets one, and later tasks go to it", async () => {
    const set = await t.api("PUT", "/api/users/logins", { designation: "Sr.DMM", email: "dmm@example.com", password: "secret12" });
    assert.equal(set.status, 200);
    const session = await login("dmm@example.com", "secret12");
    assert.equal(await ensure("Sr.DMM"), session.json.user.id);
  });

  test("an e-mail used by another officer or the DRM is refused", async () => {
    await t.api("PUT", "/api/users/logins", { designation: "Sr.DSO", email: "dso@example.com", password: "secret12" });
    const other = await t.api("PUT", "/api/users/logins", { designation: "Sr.DSC", email: "dso@example.com", password: "secret12" });
    assert.equal(other.status, 409);
    assert.match(other.json.error, /already used by Sr\.DSO/);
    const admin = await t.prisma.user.findUniqueOrThrow({ where: { id: t.adminId } });
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DSC", email: admin.email, password: "secret12" })).status, 409);
    assert.equal((await t.prisma.user.findUniqueOrThrow({ where: { id: t.adminId } })).password, admin.password, "the DRM is untouched");
  });

  test("groups, the DRM and made-up e-mails are refused", async () => {
    for (const designation of ["All BOs", "All Sr.DENs", "DRM"]) {
      assert.equal((await t.api("PUT", "/api/users/logins", { designation, email: "x@example.com", password: "secret12" })).status, 400, designation);
    }
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DPO", email: "x@railwork.local", password: "secret12" })).status, 400);
    const adminRow = await row("DRM");
    assert.equal(adminRow, undefined);
  });

  test("a duplicate account is merged: nothing is lost and the same e-mail can be reused", async () => {
    const holder = await ensure("Sr.DCM/Chg");
    const helper = await ensure("Sr.DEE/TRD");
    const coordinated = await assignTask("Parcel office", holder);
    const assisted = await assignTask("Traction work", helper, [holder]);
    // The kind of separate account the old Register page created.
    const duplicate = await t.prisma.user.create({
      data: { name: "Registered", email: "dcm@example.com", password: "old-hash", designation: "sr.dcm/chg", mobileNumber: "9000000001" },
    });
    const dupTask = await assignTask("Booking counter", duplicate.id);
    const both = await assignTask("Both on one task", holder, [duplicate.id]);
    const dupUpdate = await t.api("POST", `/api/tasks/${coordinated}/officer-updates`, { remark: "From the DRM" });
    await t.prisma.taskOfficerUpdate.update({ where: { id: dupUpdate.json.update.id }, data: { officerId: duplicate.id } });

    const before = await row("Sr.DCM/Chg");
    assert.equal(before.ready, false);
    assert.equal(before.suggestedEmail, "dcm@example.com");

    const set = await t.api("PUT", "/api/users/logins", { designation: "Sr.DCM/Chg", email: "dcm@example.com", password: "secret12" });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.login.ready, true);
    assert.equal(set.json.login.tasks, 4);

    assert.equal(await t.prisma.user.findUnique({ where: { id: duplicate.id } }), null);
    const session = await login("dcm@example.com", "secret12");
    assert.equal(session.json.user.id, holder);
    const kept = await t.prisma.user.findUniqueOrThrow({ where: { id: holder } });
    assert.equal(kept.mobileNumber, "9000000001");
    assert.equal((await t.prisma.task.findUniqueOrThrow({ where: { id: dupTask } })).officerId, holder);
    const assignees = await t.prisma.taskAdditionalAssignee.findMany({ where: { taskId: { in: [assisted, both] } } });
    assert.deepEqual(assignees.map((a) => [a.taskId, a.officerId]), [[assisted, holder]]);
    assert.equal((await t.prisma.taskOfficerUpdate.findUniqueOrThrow({ where: { id: dupUpdate.json.update.id } })).officerId, holder);
  });

  test("only the DRM can see or change logins, and the list has no passwords", async () => {
    assert.equal((await t.api("GET", "/api/users/logins", undefined, t.officerToken)).status, 403);
    assert.equal((await t.api("PUT", "/api/users/logins", { designation: "Sr.DEN/CO", password: "hacked12" }, t.officerToken)).status, 403);
    const list = await t.api("GET", "/api/users/logins");
    assert.ok(!JSON.stringify(list.json).toLowerCase().includes("password"));
  });
});

describe("registration", () => {
  test("is closed", async () => {
    const res = await t.api("POST", "/api/auth/register", { email: "new@example.com", password: "secret12", designation: "Sr.DEN/I" }, "");
    assert.equal(res.status, 404);
    assert.equal(await t.prisma.user.findUnique({ where: { email: "new@example.com" } }), null);
  });
});
