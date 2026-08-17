"use client";

import { useEffect, useRef, useState } from "react";
import { FaChevronDown, FaDownload } from "react-icons/fa";
import type { DownloadFormat } from "@/lib/download";

const FORMATS: { value: DownloadFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "csv", label: "CSV" },
];

export default function DownloadMenu({
  label,
  disabled = false,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect: (format: DownloadFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="download-menu" ref={ref}>
      <button
        type="button"
        className="download-menu-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FaDownload />
        <span>{label}</span>
        <FaChevronDown className="download-caret" />
      </button>

      {open && (
        <div className="download-dropdown" role="menu">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="menuitem"
              className="download-option"
              onClick={() => {
                setOpen(false);
                onSelect(f.value);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
