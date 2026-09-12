import type { Response } from "express";

type Client = { id: number; res: Response };

const clients = new Map<number, Client>();
let nextId = 1;

export function addSseClient(res: Response): () => void {
  const id = nextId++;
  clients.set(id, { id, res });
  res.on("close", () => clients.delete(id));
  res.on("error", () => clients.delete(id));
  res.write(": connected\n\n");
  return () => clients.delete(id);
}

export function broadcast(event: string, data?: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const client of clients.values()) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client.id);
    }
  }
}

setInterval(() => {
  for (const client of clients.values()) {
    try {
      client.res.write(": ping\n\n");
    } catch {
      clients.delete(client.id);
    }
  }
}, 25000).unref();
