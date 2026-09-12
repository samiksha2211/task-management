"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, formatDate, getStoredUser, type ApiTask } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";

type NotificationData = {
  overdue: ApiTask[];
  dueToday: ApiTask[];
  recent: ApiTask[];
};

type Group = { label: string; tasks: ApiTask[] };

const MAX_SEEN = 500;

function seenKey(): string | null {
  const user = getStoredUser();
  return user ? `railwork_notif_seen_${user.id}` : null;
}

function readSeen(): Set<string> {
  const key = seenKey();
  if (!key) return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  const key = seenKey();
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify([...ids]));
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationData>({
    overdue: [],
    dueToday: [],
    recent: [],
  });
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSeen(readSeen()), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<NotificationData>("/api/dashboard/notifications");
      setData(result);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    const id = setInterval(load, 60000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);

  useRealtime(
    ["task:created", "task:updated", "task:deleted", "task:restored"],
    () => void load()
  );

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const markAsViewed = useCallback(() => {
    setSeen((prev) => {
      const next = new Set(prev);
      for (const task of [...data.overdue, ...data.dueToday]) {
        if (next.size < MAX_SEEN) next.add(task.id);
      }
      writeSeen(next);
      return next;
    });
  }, [data.overdue, data.dueToday]);

  const groups: Group[] = [
    { label: "Overdue", tasks: data.overdue },
    { label: "Due Today", tasks: data.dueToday },
    { label: "Recent", tasks: data.recent },
  ];

  const unreadCount = [...data.overdue, ...data.dueToday].filter(
    (task) => !seen.has(task.id)
  ).length;

  return (
    <div className="notification-wrap" ref={containerRef}>
      <button
        className="notification-btn"
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
          load();
          markAsViewed();
        }}
      >
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-header">Notifications</div>

          {groups.map((group) => (
            <div key={group.label}>
              {group.tasks.length > 0 && (
                <div className="notification-group-label">{group.label}</div>
              )}
              {group.tasks.map((task) => (
                <button
                  key={`${group.label}-${task.id}`}
                  className="notification-item"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/tasks/view?id=${task.id}`);
                  }}
                >
                  <span className="notification-meta">
                    <span className="notification-designation">
                      {task.officer.designation}
                    </span>
                    <span className="notification-date">
                      due {formatDate(task.dueDate)}
                    </span>
                  </span>
                  <span className="notification-title">{task.title}</span>
                </button>
              ))}
            </div>
          ))}

          {groups.every((g) => g.tasks.length === 0) && (
            <div className="notification-empty">No notifications yet.</div>
          )}
        </div>
      )}
    </div>
  );
}