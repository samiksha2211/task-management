"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NotificationBell from "@/components/NotificationBell";

export default function TopSearchBar({
  children,
}: {
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const search = () => {
    const q = query.trim();
    router.push(q ? `/tasks?search=${encodeURIComponent(q)}` : "/tasks");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  };

  return (
    <div className="top-right">
      <input
        type="text"
        placeholder="Search tasks..."
        className="search-box"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <button className="notification-btn" aria-label="Search" onClick={search}>
        🔍
      </button>

      <NotificationBell />

      {children}
    </div>
  );
}
