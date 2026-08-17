import type { NextFunction, Request, Response } from "express";

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

export function errorHandler(
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: err.message || "Internal server error" });
}
