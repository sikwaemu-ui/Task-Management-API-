import { performance } from "node:perf_hooks";
import { Request, Response, NextFunction } from "express";

export interface RequestLogEntry {
  event: "http_request";
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export const createRequestLogger = (
  write: (entry: RequestLogEntry) => void = (entry) => console.log(JSON.stringify(entry))
) => (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = performance.now();
  const path = req.path;
  res.once("finish", () => {
    write({
      event: "http_request",
      method: req.method,
      // Deliberately omit query strings, headers, and bodies.
      path,
      status: res.statusCode,
      durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
    });
  });
  next();
};

export default createRequestLogger();
