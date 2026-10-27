import type { NextFunction, Request, Response } from "express";

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

export function errorHandler(
  err: Error & { status?: number; code?: unknown },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err.name === "MulterError") {
    const code = (err as Error & { code?: string }).code;
    const message =
      code === "LIMIT_FILE_SIZE"
        ? "Each file must be 10 MB or smaller."
        : code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE"
          ? "Too many files: attach up to 10 at a time."
          : err.message;
    res.status(400).json({ error: message });
    return;
  }
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: err.message || "Internal server error",
    ...(status < 500 && typeof err.code === "string" && { code: err.code }),
  });
}
