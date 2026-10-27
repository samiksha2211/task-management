import fs from "node:fs";
import path from "node:path";
import { del, put } from "@vercel/blob";
import multer from "multer";

// Uploaded files: Vercel Blob in production, ./uploads when no Blob
// credentials are configured (local development).

export const uploadDir = path.join(process.cwd(), "uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// PDF, images, PowerPoint, Excel and Word. Some browsers send Office files as
// application/octet-stream, so the file extension is checked too.
const ALLOWED_UPLOADS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const GENERIC_MIMES = ["application/octet-stream", "", "application/zip", "application/x-zip-compressed"];

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_UPLOADS);

export function uploadContentType(file: Express.Multer.File): string | null {
  const ext = path.extname(file.originalname).toLowerCase();
  const expected = ALLOWED_UPLOADS[ext];
  if (!expected) return null;
  if (Object.values(ALLOWED_UPLOADS).includes(file.mimetype)) return file.mimetype;
  // CSV is reported in several ways depending on the browser and OS.
  if (ext === ".csv" && /csv|excel|text\/plain/.test(file.mimetype)) return expected;
  if (GENERIC_MIMES.includes(file.mimetype)) return expected;
  return null;
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (uploadContentType(file)) {
      cb(null, true);
    } else {
      const error = new Error(
        `"${file.originalname}" is not allowed. Use PDF, Excel, Word, PowerPoint or an image.`
      ) as Error & { status?: number };
      error.status = 400;
      cb(error);
    }
  },
});

export interface StoredFile {
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export async function storeFile(file: Express.Multer.File): Promise<StoredFile> {
  const mimeType = uploadContentType(file) ?? file.mimetype;
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  let url: string;
  if (useBlob()) {
    const blob = await put(`uploads/${filename}`, file.buffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: mimeType,
    });
    url = blob.url;
  } else {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
    url = `/uploads/${filename}`;
  }
  return { url, name: file.originalname, mimeType, sizeBytes: file.size };
}

/** Local path of an /uploads/... URL, or null if it points anywhere else. */
function localUploadPath(url: string): string | null {
  if (!url.startsWith("/uploads/")) return null;
  const resolved = path.resolve(uploadDir, decodeURIComponent(url.slice("/uploads/".length)));
  return resolved.startsWith(uploadDir + path.sep) ? resolved : null;
}

function isOwnBlob(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** True for a URL of a file this application stored (local upload or our Blob store). */
export function isStoredFileUrl(url: string): boolean {
  return localUploadPath(url) !== null || isOwnBlob(url);
}

/**
 * Delete a file this app stored. Links to other sites are never touched.
 * Failures are logged, not thrown: the database record is already gone.
 */
export async function deleteStoredFile(url: string): Promise<void> {
  try {
    const local = localUploadPath(url);
    if (local) {
      if (fs.existsSync(local)) fs.unlinkSync(local);
      return;
    }
    if (isOwnBlob(url) && useBlob()) await del(url);
  } catch (error) {
    console.error("Could not delete stored file", url, error);
  }
}
