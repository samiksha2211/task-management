import { apiFetch, type ApiAttachment, type ApiTask } from "./api";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
export const ACCEPTED_FILES = ".pdf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp";
export const ACCEPTED_LABEL = "PDF, Excel, Word, PowerPoint or image, up to 10 MB each";

export interface PendingLink {
  url: string;
  name: string;
}

/** Attachments chosen for an entry that has not been saved yet. */
export interface PendingAttachments {
  files: File[];
  links: PendingLink[];
}

export const EMPTY_PENDING: PendingAttachments = { files: [], links: [] };

export function hasPending(p: PendingAttachments): boolean {
  return p.files.length > 0 || p.links.length > 0;
}

const GOOGLE_SHEETS = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/;

export function isGoogleSheetsUrl(url: string): boolean {
  return GOOGLE_SHEETS.test(url.trim());
}

export function fileProblem(file: File): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!ACCEPTED_FILES.split(",").includes(ext)) return `"${file.name}" is not a supported file type.`;
  if (file.size > MAX_FILE_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return null;
}

export type AttachmentIcon = "pdf" | "excel" | "word" | "powerpoint" | "image" | "sheet" | "file";

export function attachmentIcon(a: { kind: "FILE" | "LINK"; name: string; mimeType?: string | null }): AttachmentIcon {
  if (a.kind === "LINK") return "sheet";
  const name = a.name.toLowerCase();
  const mime = a.mimeType ?? "";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (/\.(xlsx?|csv)$/.test(name) || /spreadsheet|excel|csv/.test(mime)) return "excel";
  if (/\.docx?$/.test(name) || /word/.test(mime)) return "word";
  if (/\.pptx?$/.test(name) || /presentation|powerpoint/.test(mime)) return "powerpoint";
  if (/\.(jpe?g|png|webp)$/.test(name) || mime.startsWith("image/")) return "image";
  return "file";
}

/** Add files and/or Google Sheets links to a saved DRM (no officerUpdateId) or BO entry. */
export async function addAttachments(
  taskId: string,
  pending: PendingAttachments,
  officerUpdateId?: string
): Promise<ApiTask> {
  const form = new FormData();
  for (const file of pending.files) form.append("files", file);
  if (pending.links.length) form.append("links", JSON.stringify(pending.links));
  if (officerUpdateId) form.append("officerUpdateId", officerUpdateId);
  const result = await apiFetch<{ task: ApiTask }>(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    body: form,
  });
  return result.task;
}

export async function removeAttachment(taskId: string, attachmentId: string): Promise<ApiTask> {
  const result = await apiFetch<{ task: ApiTask }>(`/api/tasks/${taskId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
  return result.task;
}

export type AttachmentPayload =
  | { kind: "FILE"; url: string; name: string; mimeType: string | null }
  | { kind: "LINK"; url: string; name: string };

/**
 * For entries that are about to be created: upload the chosen files and
 * return them, with the links, in the shape the create endpoints accept.
 */
export async function uploadPending(
  pending: PendingAttachments,
  uploadPath = "/api/tasks/upload"
): Promise<AttachmentPayload[]> {
  const payload: AttachmentPayload[] = [];
  for (const file of pending.files) {
    const form = new FormData();
    form.append("file", file);
    const uploaded = await apiFetch<{ attachmentUrl: string; attachmentName: string; attachmentType: string }>(
      uploadPath,
      { method: "POST", body: form }
    );
    payload.push({ kind: "FILE", url: uploaded.attachmentUrl, name: uploaded.attachmentName, mimeType: uploaded.attachmentType });
  }
  for (const link of pending.links) payload.push({ kind: "LINK", url: link.url, name: link.name });
  return payload;
}

export function drmAttachments(task: Pick<ApiTask, "attachments">): ApiAttachment[] {
  return task.attachments ?? [];
}
