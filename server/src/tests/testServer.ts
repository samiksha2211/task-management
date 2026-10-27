// Shared setup for integration tests: a throwaway PostgreSQL database with all
// migrations applied, the API mounted on a random port, and an admin and an
// officer to call it as.
//
// By default embedded-postgres starts a temporary server. Set
// TEST_DATABASE_URL to use an existing *empty test* database instead. Never
// runs against DATABASE_URL.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

const serverRoot = path.resolve(__dirname, "../..");

export interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  headers: Headers;
  buffer: Buffer;
}

export interface TestServer {
  prisma: PrismaClient;
  baseUrl: string;
  adminToken: string;
  officerToken: string;
  otherOfficerToken: string;
  adminId: string;
  officerId: string;
  otherOfficerId: string;
  api: (method: string, url: string, body?: unknown, token?: string) => Promise<ApiResult>;
  upload: (url: string, form: FormData, token?: string) => Promise<ApiResult>;
  close: () => Promise<void>;
}

async function startDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.TEST_DATABASE_URL) {
    if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not be the application database.");
    }
    return { url: process.env.TEST_DATABASE_URL, stop: async () => {} };
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "railwork-pg-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "railwork_test",
    password: "railwork_test",
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("railwork_test");
  return {
    url: `postgresql://railwork_test:railwork_test@localhost:${port}/railwork_test`,
    stop: async () => {
      await pg.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function toResult(res: Response): Promise<ApiResult> {
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  if ((res.headers.get("content-type") ?? "").includes("json")) json = JSON.parse(buffer.toString("utf8"));
  return { status: res.status, json, headers: res.headers, buffer };
}

export async function startTestServer(): Promise<TestServer> {
  const db = await startDatabase();
  execFileSync(process.execPath, [path.join(serverRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: db.url },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = db.url;
  // Files go to ./uploads, never to the production Blob store.
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;

  const express = (await import("express")).default;
  const { default: router } = await import("../routes");
  const { errorHandler, notFound } = await import("../middleware/error");
  const { signToken } = await import("../lib/jwt");
  const { prisma } = await import("../prisma");

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(notFound);
  app.use(errorHandler);
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const admin = await prisma.user.create({
    data: { name: "Admin", email: `admin-${stamp}@test.local`, password: "x", designation: "DRM", role: "ADMIN" },
  });
  const officer = await prisma.user.create({
    data: { name: "Officer", email: `officer-${stamp}@test.local`, password: "x", designation: "Sr.DEN/CO" },
  });
  const other = await prisma.user.create({
    data: { name: "Other", email: `other-${stamp}@test.local`, password: "x", designation: "Sr.DEE/G" },
  });
  const adminToken = signToken({ userId: admin.id, role: "ADMIN" });

  const api = async (method: string, url: string, body?: unknown, token = adminToken) =>
    toResult(
      await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    );

  const upload = async (url: string, form: FormData, token = adminToken) =>
    toResult(await fetch(`${baseUrl}${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }));

  return {
    prisma,
    baseUrl,
    adminToken,
    officerToken: signToken({ userId: officer.id, role: "OFFICER" }),
    otherOfficerToken: signToken({ userId: other.id, role: "OFFICER" }),
    adminId: admin.id,
    officerId: officer.id,
    otherOfficerId: other.id,
    api,
    upload,
    close: async () => {
      server.close();
      await prisma.$disconnect();
      await db.stop();
    },
  };
}

export { assert };
