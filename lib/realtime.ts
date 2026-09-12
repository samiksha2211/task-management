"use client";

import { useEffect, useRef } from "react";
import { getToken } from "./api";

export type RealtimeEvent = {
  event: string;
  data: Record<string, unknown>;
};

type Listener = (ev: RealtimeEvent) => void;

const listeners = new Set<Listener>();
let controller: AbortController | null = null;
let started = false;
let retryMs = 2000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function emit(ev: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(ev);
    } catch {
      // keep other listeners alive
    }
  }
}

function scheduleRetry(): void {
  if (!started) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void connect(), retryMs);
  retryMs = Math.min(retryMs * 2, 30000);
}

async function connect(): Promise<void> {
  if (!started) return;
  const token = getToken();
  if (!token) return;

  controller = new AbortController();
  try {
    const res = await fetch("/api/events", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return;
    }

    retryMs = 2000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!raw.startsWith(":")) parseBlock(raw);
      }
    }
  } catch {
    // aborted or network error
  } finally {
    controller = null;
    if (started) scheduleRetry();
  }
}

function parseBlock(raw: string): void {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  const payload = dataLines.join("\n");
  if (!payload) return;

  try {
    emit({ event, data: JSON.parse(payload) });
  } catch {
    emit({ event, data: { raw: payload } });
  }
}

export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    void connect();
  }
  return () => {
    listeners.delete(listener);
    // Keep the stream alive across client-side navigations so the
    // long-lived connection is not aborted and recreated through the
    // dev server proxy on every route change (which wedges navigation).
    // Only tear it down once the user is no longer authenticated.
    if (listeners.size === 0 && !getToken()) {
      started = false;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    }
  };
}

export function disconnectRealtime(): void {
  started = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryMs = 2000;
  controller?.abort();
  controller = null;
}

export function useRealtime(events: string[], onEvent: () => void): void {
  const callbackRef = useRef(onEvent);

  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  const key = events.join(",");

  useEffect(() => {
    const unsubscribe = subscribeRealtime((ev) => {
      if (events.includes(ev.event)) callbackRef.current();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
