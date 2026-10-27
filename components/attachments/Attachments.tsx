"use client";

import { useRef, useState } from "react";
import {
  FaFileAlt,
  FaFileExcel,
  FaFileImage,
  FaFilePdf,
  FaFilePowerpoint,
  FaFileWord,
  FaLink,
  FaPaperclip,
  FaTable,
  FaTimes,
} from "react-icons/fa";
import { fileUrl, type ApiAttachment } from "@/lib/api";
import {
  ACCEPTED_FILES,
  ACCEPTED_LABEL,
  MAX_FILES_PER_UPLOAD,
  attachmentIcon,
  fileProblem,
  isGoogleSheetsUrl,
  type AttachmentIcon,
  type PendingAttachments,
  type PendingLink,
} from "@/lib/attachments";
import "./attachments.css";

const ICONS: Record<AttachmentIcon, React.ReactNode> = {
  pdf: <FaFilePdf className="att-icon att-pdf" aria-hidden="true" />,
  excel: <FaFileExcel className="att-icon att-excel" aria-hidden="true" />,
  word: <FaFileWord className="att-icon att-word" aria-hidden="true" />,
  powerpoint: <FaFilePowerpoint className="att-icon att-ppt" aria-hidden="true" />,
  image: <FaFileImage className="att-icon att-image" aria-hidden="true" />,
  sheet: <FaTable className="att-icon att-sheet" aria-hidden="true" />,
  file: <FaFileAlt className="att-icon" aria-hidden="true" />,
};

/** Saved attachments, each with an open link and (optionally) a remove button. */
export function AttachmentList({
  attachments,
  onRemove,
  compact,
  emptyText,
}: {
  attachments: ApiAttachment[];
  onRemove?: (attachment: ApiAttachment) => void;
  compact?: boolean;
  emptyText?: string;
}) {
  if (attachments.length === 0) {
    return emptyText ? <span className="att-empty">{emptyText}</span> : null;
  }
  return (
    <ul className={`att-list ${compact ? "is-compact" : ""}`}>
      {attachments.map((a) => (
        <li key={a.id} className="att-item">
          {ICONS[attachmentIcon(a)]}
          <a
            className="att-name"
            href={a.kind === "LINK" ? a.url : fileUrl(a.url)}
            target="_blank"
            rel="noopener noreferrer"
            title={a.kind === "LINK" ? `Open Google Sheet: ${a.name}` : `Open ${a.name}`}
          >
            {a.name}
          </a>
          {onRemove && (
            <button
              type="button"
              className="att-remove"
              aria-label={`Remove ${a.name}`}
              title={`Remove ${a.name}`}
              onClick={() => onRemove(a)}
            >
              <FaTimes aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Add files" and "Add Google Sheets link" controls. */
function AddControls({
  busy,
  onFiles,
  onLink,
}: {
  busy?: boolean;
  onFiles: (files: File[]) => void;
  onLink: (link: PendingLink) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const chooseFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (files.length === 0) return;
    if (files.length > MAX_FILES_PER_UPLOAD) {
      setError(`Choose up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
      return;
    }
    const problem = files.map(fileProblem).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onFiles(files);
  };

  const addLink = () => {
    if (!isGoogleSheetsUrl(url)) {
      setError("Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/...).");
      return;
    }
    setError(null);
    onLink({ url: url.trim(), name: name.trim() || "Google Sheet" });
    setUrl("");
    setName("");
    setLinkOpen(false);
  };

  return (
    <div className="att-add">
      <div className="att-add-buttons">
        <button type="button" className="att-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          <FaPaperclip aria-hidden="true" /> Add files
        </button>
        <button type="button" className="att-btn" disabled={busy} onClick={() => setLinkOpen((v) => !v)}>
          <FaLink aria-hidden="true" /> Add Google Sheets link
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_FILES}
          onChange={(e) => chooseFiles(e.target.files)}
        />
      </div>
      {linkOpen && (
        <div className="att-link-row">
          <input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            aria-label="Google Sheets link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <input
            type="text"
            placeholder="Name (optional)"
            aria-label="Link name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" className="att-btn is-primary" disabled={busy || !url.trim()} onClick={addLink}>
            Add link
          </button>
        </div>
      )}
      <span className="att-hint">{ACCEPTED_LABEL}. Google Sheets links open the sheet.</span>
      {error && <span className="att-error">{error}</span>}
    </div>
  );
}

/**
 * Attachments of a saved DRM or BO entry: list plus add/remove, each change
 * saved straight away.
 */
export function AttachmentManager({
  attachments,
  canEdit,
  onAdd,
  onRemove,
  compact,
}: {
  attachments: ApiAttachment[];
  canEdit: boolean;
  onAdd: (pending: PendingAttachments) => Promise<void>;
  onRemove: (attachment: ApiAttachment) => Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const remove = (a: ApiAttachment) => {
    if (!window.confirm(`Remove "${a.name}"?${a.kind === "FILE" ? " The uploaded file will be deleted." : ""}`)) return;
    void run(() => onRemove(a));
  };

  return (
    <div className="att-manager">
      <AttachmentList
        attachments={attachments}
        onRemove={canEdit && !busy ? remove : undefined}
        compact={compact}
        emptyText="No attachments"
      />
      {canEdit && (
        <AddControls
          busy={busy}
          onFiles={(files) => run(() => onAdd({ files, links: [] }))}
          onLink={(link) => run(() => onAdd({ files: [], links: [link] }))}
        />
      )}
      {busy && <span className="att-hint">Saving...</span>}
    </div>
  );
}

/** Attachments chosen for an entry that is not saved yet (sent when it is saved). */
export function PendingAttachmentsField({
  value,
  onChange,
}: {
  value: PendingAttachments;
  onChange: (value: PendingAttachments) => void;
}) {
  const items = [
    ...value.files.map((f, i) => ({ key: `f${i}`, kind: "FILE" as const, name: f.name, remove: () => onChange({ ...value, files: value.files.filter((_, j) => j !== i) }) })),
    ...value.links.map((l, i) => ({ key: `l${i}`, kind: "LINK" as const, name: l.name, remove: () => onChange({ ...value, links: value.links.filter((_, j) => j !== i) }) })),
  ];
  return (
    <div className="att-manager">
      {items.length > 0 && (
        <ul className="att-list">
          {items.map((item) => (
            <li key={item.key} className="att-item">
              {ICONS[attachmentIcon({ kind: item.kind, name: item.name })]}
              <span className="att-name">{item.name}</span>
              <button type="button" className="att-remove" aria-label={`Remove ${item.name}`} onClick={item.remove}>
                <FaTimes aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddControls
        onFiles={(files) => onChange({ ...value, files: [...value.files, ...files] })}
        onLink={(link) =>
          value.links.some((l) => l.url === link.url) ? undefined : onChange({ ...value, links: [...value.links, link] })
        }
      />
    </div>
  );
}
