"use client";

import { useEffect, useRef, useState } from "react";
import { DESIGNATIONS } from "@/lib/designations";
import "./MultiDesignationSelect.css";

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
  exclude?: string;
};

export default function MultiDesignationSelect({
  value,
  onChange,
  exclude,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const availableDesignations = DESIGNATIONS.filter(
    (d) =>
      d !== exclude &&
      d.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggleDesignation = (designation: string) => {
    if (value.includes(designation)) {
      onChange(value.filter((d) => d !== designation));
    } else {
      onChange([...value, designation]);
    }
  };

  return (
    <div className="multi-designation-root" ref={rootRef}>
      <button
        type="button"
        className="multi-designation-button"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          {value.length === 0
            ? "Select additional designations"
            : `${value.length} designation${value.length > 1 ? "s" : ""} selected`}
        </span>

        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="multi-designation-dropdown">
          <input
            type="text"
            className="multi-designation-search"
            placeholder="Search designation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="multi-designation-list">
            {availableDesignations.map((designation) => (
              <label
                key={designation}
                className="multi-designation-option"
              >
                <input
                  type="checkbox"
                  checked={value.includes(designation)}
                  onChange={() => toggleDesignation(designation)}
                />

                <span>{designation}</span>
              </label>
            ))}

            {availableDesignations.length === 0 && (
              <div className="multi-designation-empty">
                No designation found
              </div>
            )}
          </div>

          {value.length > 0 && (
            <div className="multi-designation-footer">
              <span>{value.length} selected</span>

              <button
                type="button"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}