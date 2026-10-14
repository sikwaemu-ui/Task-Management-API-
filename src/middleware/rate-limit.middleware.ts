import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { RuntimeConfig } from "../config/env";

const tooManyRequests = {
  success: false,
  message: "Too many requests. Please try again later.",
};

export const createRateLimiters = (config: RuntimeConfig) => {
  const common = {
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    // Keep suites deterministic; limiter behavior itself is tested with test-local stores.
    skip: () => config.nodeEnv === "test",
    handler: (_req: Request, res: Response) => {
      res.status(429).json(tooManyRequests);
    },
  };

  return {
    apiLimiter: rateLimit({
      ...common,
      windowMs: config.apiRateLimitWindowMs,
      limit: config.apiRateLimitMax,
    }),
    authLimiter: rateLimit({
      ...common,
      windowMs: config.authRateLimitWindowMs,
      limit: config.authRateLimitMax,
    }),
  };
};
