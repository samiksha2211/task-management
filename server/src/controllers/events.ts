import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { addSseClient } from "../lib/sse";

export function streamEvents(req: AuthRequest, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  addSseClient(res);
}
