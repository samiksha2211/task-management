"use client";

import { useEffect, useRef, useState } from "react";
import { DESIGNATIONS } from "@/lib/designations";
import "./DesignationAutocomplete.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
};

export default function DesignationAutocomplete({
  value,
  onChange,
  id,
  placeholder = "Type to search designation",
}: Props) {
  const [query, setQuery] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  if (prevValue !== value) {
    setPrevValue(value);
    setQuery(value);
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const term = query.trim().toLowerCase();
  const suggestions = term
    ? DESIGNATIONS.filter((d) => d.toLowerCase().includes(term))
    : DESIGNATIONS;

  const handleInput = (text: string) => {
    setQuery(text);
    setOpen(true);
    setHighlight(-1);
    onChange(text);
  };

  const select = (designation: string) => {
    setQuery(designation);
    setOpen(false);
    setHighlight(-1);
    onChange(designation);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown") {
        setOpen(true);
        setHighlight(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (highlight >= 0 && suggestions[highlight]) {
        e.preventDefault();
        select(suggestions[highlight]);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div className="da-root" ref={rootRef}>
      <input
        id={id}
        type="text"
        className="da-input"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && suggestions.length > 0 && (
        <ul className="da-list" role="listbox">
          {suggestions.map((d, i) => (
            <li
              key={d}
              role="option"
              aria-selected={i === highlight}
              className={`da-item ${i === highlight ? "da-item-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                select(d);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}