// DRM and BO attachments: validation, permissions, creation and safe removal.

import type { Prisma, TaskAttachment, TaskOfficerUpdate } from "@prisma/client";
import { z } from "zod";
import { deleteStoredFile, isStoredFileUrl, type StoredFile } from "../lib/storage";
import type { AuthUser } from "../middleware/auth";
import { prisma } from "../prisma";

export class AttachmentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const GOOGLE_SHEETS = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/;

/** A Google Sheets link: https://docs.google.com/spreadsheets/d/... */
export const sheetLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => GOOGLE_SHEETS.test(v), "Please paste a Google Sheets link (https://docs.google.com/spreadsheets/d/...)"),
  name: z.string().trim().max(200).optional(),
});

/** An attachment sent with a new task or BO entry (files uploaded first). */
export const attachmentInputSchema = z.union([
  z.object({
    kind: z.literal("FILE"),
    url: z.string().refine(isStoredFileUrl, "File must be uploaded through this application"),
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().max(200).optional().nullable(),
    sizeBytes: z.number().int().nonnegative().optional().nullable(),
  }),
  z.object({ kind: z.literal("LINK") }).merge(sheetLinkSchema),
]);

export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export function linkName(url: string, name?: string): string {
  return name?.trim() || "Google Sheet";
}

export function canManageDrm(user: AuthUser): boolean {
  return user.role === "ADMIN";
}

export function canManageBo(user: AuthUser, update: Pick<TaskOfficerUpdate, "officerId">): boolean {
  return user.role === "ADMIN" || update.officerId === user.id;
}

/** Rows for one entry; links already attached to that entry are skipped. */
export async function createAttachments(
  tx: Prisma.TransactionClient,
  params: {
    taskId: string;
    officerUpdateId: string | null;
    userId: string | null;
    files?: StoredFile[];
    links?: { url: string; name?: string }[];
    inputs?: AttachmentInput[];
  }
): Promise<{ added: number; skipped: number }> {
  const { taskId, officerUpdateId, userId } = params;
  const existing = await tx.taskAttachment.findMany({
    where: { taskId, officerUpdateId },
    select: { url: true },
  });
  const seen = new Set(existing.map((a) => a.url));

  const rows: Prisma.TaskAttachmentCreateManyInput[] = [];
  let skipped = 0;
  const add = (row: Omit<Prisma.TaskAttachmentCreateManyInput, "taskId" | "officerUpdateId" | "uploadedById">) => {
    if (seen.has(row.url)) {
      skipped += 1;
      return;
    }
    seen.add(row.url);
    rows.push({ ...row, taskId, officerUpdateId, uploadedById: userId });
  };

  for (const f of params.files ?? []) {
    add({ kind: "FILE", url: f.url, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes });
  }
  for (const l of params.links ?? []) {
    add({ kind: "LINK", url: l.url, name: linkName(l.url, l.name), mimeType: null });
  }
  for (const a of params.inputs ?? []) {
    if (a.kind === "FILE") {
      add({ kind: "FILE", url: a.url, name: a.name, mimeType: a.mimeType ?? null, sizeBytes: a.sizeBytes ?? null });
    } else {
      add({ kind: "LINK", url: a.url, name: linkName(a.url, a.name), mimeType: null });
    }
  }

  if (rows.length) await tx.taskAttachment.createMany({ data: rows });
  return { added: rows.length, skipped };
}

/**
 * After attachment rows are deleted, delete the stored files that nothing
 * references any more. Shared files and Google Sheets links are left alone.
 */
export async function cleanUpFiles(removed: Pick<TaskAttachment, "kind" | "url">[]): Promise<void> {
  const urls = [...new Set(removed.filter((a) => a.kind === "FILE").map((a) => a.url))];
  for (const url of urls) {
    const stillUsed = await prisma.taskAttachment.count({ where: { url } });
    if (stillUsed > 0) continue;
    // Old single-attachment columns may still hold the same URL; clear them so
    // nothing points at a deleted file.
    await prisma.task.updateMany({
      where: { attachmentUrl: url },
      data: { attachmentUrl: null, attachmentName: null, attachmentType: null },
    });
    await prisma.taskOfficerUpdate.updateMany({
      where: { attachmentUrl: url },
      data: { attachmentUrl: null, attachmentName: null, attachmentType: null },
    });
    await deleteStoredFile(url);
  }
}
