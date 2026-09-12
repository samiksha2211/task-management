import { getToken } from "./api";

export type DownloadFormat = "pdf" | "csv";

export interface DownloadParams {
  format: DownloadFormat;
  /** Download a single task. Mutually exclusive with `ids`. */
  id?: string;
  /** Download exactly these tasks (the currently displayed filtered set). */
  ids?: string[];
}

export function downloadUrl(params: DownloadParams): string {
  const q = new URLSearchParams();
  q.set("format", params.format);
  if (params.id) q.set("id", params.id);
  if (params.ids?.length) q.set("ids", params.ids.join(","));
  return `/api/tasks/export?${q.toString()}`;
}

function defaultName(params: DownloadParams): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = params.id ? "railwork_task" : "railwork_tasks";
  return `${base}_${stamp}.${params.format}`;
}

export async function downloadTasks(params: DownloadParams): Promise<void> {
  const token = getToken();
  const res = await fetch(downloadUrl(params), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    let message = "Failed to generate download";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] || defaultName(params);

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
