// Integration tests for DRM and BO attachments (files and Google Sheets
// links) against a real PostgreSQL database and local file storage.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { uploadDir } from "../lib/storage";
import { startTestServer, type TestServer } from "./testServer";

let t: TestServer;
const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0";
const SHEET_2 = "https://docs.google.com/spreadsheets/d/2ZyXwVuTsRqPoNmLkJiHgFeDcBa/edit";
const createdFiles = new Set<string>();

function form(files: { name: string; type: string; body?: string }[], fields: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const file of files) f.append("files", new Blob([file.body ?? `content of ${file.name}`], { type: file.type }), file.name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Att = { id: string; kind: "FILE" | "LINK"; url: string; name: string };

function localPath(url: string): string {
  return path.join(uploadDir, url.replace(/^\/uploads\//, ""));
}

function track(attachments: Att[]): void {
  for (const a of attachments) if (a.kind === "FILE") createdFiles.add(a.url);
}

async function getTask(id: string) {
  const res = await t.api("GET", `/api/tasks/${id}`);
  assert.equal(res.status, 200);
  return res.json.task as {
    attachments: Att[];
    attachmentUrl: string | null;
    officerUpdates: { id: string; attachments: Att[] }[];
  };
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await t.api("POST", "/api/tasks", {
    title,
    date: "2026-10-01",
    dueDate: "2026-12-31",
    officerId: t.officerId,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.task as { id: string; attachments: Att[]; attachmentUrl: string | null };
}

before(async () => {
  t = await startTestServer();
});

after(async () => {
  for (const url of createdFiles) {
    const p = localPath(url);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  await t?.close();
});

describe("DRM and BO attachments", () => {
  let taskId = "";
  let boUpdateId = "";

  test("DRM: several files and a Google Sheets link in one request", async () => {
    taskId = (await createTask("Attachment task")).id;
    const res = await t.upload(
      `/api/tasks/${taskId}/attachments`,
      form(
        [
          { name: "report.pdf", type: "application/pdf" },
          { name: "budget.xlsx", type: XLSX },
        ],
        { links: JSON.stringify([{ url: SHEET, name: "Progress sheet" }]) }
      )
    );
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.added, 3);
    const atts: Att[] = res.json.task.attachments;
    track(atts);
    assert.deepEqual(atts.map((a) => a.name), ["report.pdf", "budget.xlsx", "Progress sheet"]);
    assert.equal(atts[2].kind, "LINK");
    assert.equal(atts[2].url, SHEET);
    for (const a of atts.filter((x) => x.kind === "FILE")) assert.ok(fs.existsSync(localPath(a.url)), `${a.name} stored`);
    assert.equal(res.json.task.attachmentUrl, atts[0].url, "legacy field mirrors the first attachment");
  });

  test("the same link is not added twice to one entry", async () => {
    const res = await t.api("POST", `/api/tasks/${taskId}/attachments`, { links: [{ url: SHEET }] });
    assert.equal(res.status, 201);
    assert.equal(res.json.added, 0);
    assert.equal(res.json.skipped, 1);
    assert.equal((await getTask(taskId)).attachments.length, 3);
  });

  test("validation: links must be Google Sheets, files must be an allowed type, something must be sent", async () => {
    assert.equal((await t.api("POST", `/api/tasks/${taskId}/attachments`, { links: [{ url: "https://example.com/x" }] })).status, 400);
    assert.equal((await t.api("POST", `/api/tasks/${taskId}/attachments`, { links: [{ url: "http://docs.google.com/spreadsheets/d/abc" }] })).status, 400);
    const exe = await t.upload(`/api/tasks/${taskId}/attachments`, form([{ name: "virus.exe", type: "application/x-msdownload" }]));
    assert.equal(exe.status, 400);
    assert.match(exe.json.error, /not allowed/);
    assert.equal((await t.api("POST", `/api/tasks/${taskId}/attachments`, {})).status, 400);
    const big = await t.upload(`/api/tasks/${taskId}/attachments`, form([{ name: "big.pdf", type: "application/pdf", body: "x".repeat(10 * 1024 * 1024 + 1) }]));
    assert.equal(big.status, 400);
    assert.match(big.json.error, /10 MB/);
    assert.equal((await getTask(taskId)).attachments.length, 3, "nothing was added");
  });

  test("BO: an officer adds a link with a new entry, then a Word file", async () => {
    const created = await t.api(
      "POST",
      `/api/tasks/${taskId}/officer-updates`,
      { remark: "Estimate attached", attachments: [{ kind: "LINK", url: SHEET_2, name: "Estimate" }] },
      t.officerToken
    );
    assert.equal(created.status, 201, JSON.stringify(created.json));
    boUpdateId = created.json.update.id;

    const res = await t.upload(
      `/api/tasks/${taskId}/attachments`,
      form([{ name: "letter.docx", type: DOCX }], { officerUpdateId: boUpdateId }),
      t.officerToken
    );
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const task = await getTask(taskId);
    const bo = task.officerUpdates.find((u) => u.id === boUpdateId)!;
    track(bo.attachments);
    assert.deepEqual(bo.attachments.map((a) => a.name), ["Estimate", "letter.docx"]);
    assert.equal(task.attachments.length, 3, "DRM attachments are separate");
  });

  test("permissions: officers cannot touch DRM attachments or other officers' entries", async () => {
    const drm = (await getTask(taskId)).attachments[0];
    assert.equal((await t.api("POST", `/api/tasks/${taskId}/attachments`, { links: [{ url: SHEET_2 }] }, t.officerToken)).status, 403);
    assert.equal((await t.api("DELETE", `/api/tasks/${taskId}/attachments/${drm.id}`, undefined, t.officerToken)).status, 403);
    const boAtt = (await getTask(taskId)).officerUpdates[0].attachments[0];
    assert.equal(
      (await t.api("POST", `/api/tasks/${taskId}/attachments`, { officerUpdateId: boUpdateId, links: [{ url: SHEET }] }, t.otherOfficerToken)).status,
      403
    );
    assert.equal((await t.api("DELETE", `/api/tasks/${taskId}/attachments/${boAtt.id}`, undefined, t.otherOfficerToken)).status, 403);
    assert.equal((await t.api("DELETE", `/api/tasks/someone-else/attachments/${boAtt.id}`)).status, 404, "attachment must belong to the task");
  });

  test("removing one attachment keeps the others and deletes only its file", async () => {
    const before = await getTask(taskId);
    const [pdf, xlsx, link] = before.attachments;
    const res = await t.api("DELETE", `/api/tasks/${taskId}/attachments/${pdf.id}`);
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(localPath(pdf.url)), "removed file is deleted from storage");
    assert.ok(fs.existsSync(localPath(xlsx.url)), "other files are kept");

    const after = await getTask(taskId);
    assert.deepEqual(after.attachments.map((a) => a.id), [xlsx.id, link.id]);
    assert.equal(after.officerUpdates[0].attachments.length, 2, "BO attachments untouched");

    const linkRemoved = await t.api("DELETE", `/api/tasks/${taskId}/attachments/${link.id}`);
    assert.equal(linkRemoved.status, 200);
    assert.deepEqual((await getTask(taskId)).attachments.map((a) => a.id), [xlsx.id]);
  });

  test("a file shared by two entries is kept until the last one is removed", async () => {
    const xlsx = (await getTask(taskId)).attachments[0];
    const other = await createTask("Shares a file", {
      attachments: [{ kind: "FILE", url: xlsx.url, name: "budget copy.xlsx" }],
    });
    assert.equal(other.attachments.length, 1);
    await t.api("DELETE", `/api/tasks/${taskId}/attachments/${xlsx.id}`);
    assert.ok(fs.existsSync(localPath(xlsx.url)), "still used by the other task");
    await t.api("DELETE", `/api/tasks/${other.id}/attachments/${other.attachments[0].id}`);
    assert.ok(!fs.existsSync(localPath(xlsx.url)), "deleted after the last reference");
  });

  test("files must have been uploaded through the app", async () => {
    const res = await t.api("POST", "/api/tasks", {
      title: "Bad",
      date: "2026-10-01",
      dueDate: "2026-12-31",
      officerId: t.officerId,
      attachments: [{ kind: "FILE", url: "https://evil.example.com/x.pdf", name: "x.pdf" }],
    });
    assert.equal(res.status, 400);
  });

  test("the old single-attachment fields still work and become attachments", async () => {
    const up = await t.upload("/api/tasks/upload", (() => {
      const f = new FormData();
      f.append("file", new Blob(["legacy"], { type: "application/pdf" }), "legacy.pdf");
      return f;
    })());
    assert.equal(up.status, 200, JSON.stringify(up.json));
    createdFiles.add(up.json.attachmentUrl);
    const task = await createTask("Legacy client", up.json);
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, "legacy.pdf");
    assert.equal(task.attachmentUrl, up.json.attachmentUrl);
  });

  test("deleting a BO entry deletes its files", async () => {
    const bo = (await getTask(taskId)).officerUpdates[0];
    const docx = bo.attachments.find((a) => a.kind === "FILE")!;
    assert.ok(fs.existsSync(localPath(docx.url)));
    const res = await t.api("DELETE", `/api/tasks/${taskId}/officer-updates/${boUpdateId}`);
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(localPath(docx.url)));
    assert.equal(await t.prisma.taskAttachment.count({ where: { officerUpdateId: boUpdateId } }), 0);
  });

  test("task PDF and CSV exports still work with attachments", async () => {
    const res = await t.api("GET", `/api/tasks/export?format=pdf&id=${taskId}`);
    assert.equal(res.status, 200);
    assert.equal(res.buffer.subarray(0, 5).toString(), "%PDF-");
  });

  test("the migration copies old single attachments exactly once", async () => {
    const legacy = await t.prisma.task.create({
      data: {
        title: "Pre-migration task",
        date: new Date("2026-09-01"),
        dueDate: new Date("2026-12-31"),
        officerId: t.officerId,
        attachmentUrl: "/uploads/old-file.pdf",
        attachmentName: "old-file.pdf",
        attachmentType: "application/pdf",
      },
    });
    const sql = fs.readFileSync(
      path.join(__dirname, "../../prisma/migrations/20261027120000_add_task_attachments/migration.sql"),
      "utf8"
    );
    const backfill = sql.slice(sql.indexOf("INSERT INTO")).split(/;\s*/).filter((s) => s.trim().startsWith("INSERT"));
    assert.equal(backfill.length, 2);
    for (let run = 0; run < 2; run++) for (const stmt of backfill) await t.prisma.$executeRawUnsafe(stmt);
    const rows = await t.prisma.taskAttachment.findMany({ where: { taskId: legacy.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "old-file.pdf");
    assert.equal(rows[0].officerUpdateId, null);
  });
});
