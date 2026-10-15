import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { Prisma } from "@prisma/client";

export const redactSensitiveText = (value: string): string => {
  if (/\b(?:credentials?|database\s+connection|connection\s+string)\b/i.test(value)) {
    return "Sensitive error details redacted";
  }
  return value
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s"'`]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|password|jwt_secret|database_url|token)\b(\s*[:=]\s*|\s+)[^\s,;]+/gi, "$1$2[redacted]");
};

const useSafeErrorDetails = () =>
  process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test";

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // 1. Typed Application Errors (e.g. ConflictError, BadRequestError)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.statusCode >= 500 && useSafeErrorDetails()
        ? "Internal server error"
        : redactSensitiveText(err.message),
    });
    return;
  }

  // 2. Prisma Known Request Errors (fallback if unhandled by service)
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      success: false,
      message: "An account with this email already exists",
    });
    return;
  }

  // 3. Malformed JSON payload from express.json()
  if (err instanceof SyntaxError && "status" in err && err.status === 400) {
    res.status(400).json({
      success: false,
      message: "Invalid JSON payload",
    });
    return;
  }

  // 4. Unexpected server errors: Log safely without credentials/secrets
  const errorMessage = err instanceof Error ? redactSensitiveText(err.message) : "Unknown error";
  console.error(JSON.stringify({
    level: "error",
    event: "unhandled_request_error",
    error: err instanceof Error ? err.name : "UnknownError",
    ...(!useSafeErrorDetails() ? { message: errorMessage } : {}),
  }));

  // Never expose stack traces; production responses and logs omit internal messages.
  res.status(500).json({
    success: false,
    message: useSafeErrorDetails() ? "Internal server error" : errorMessage,
  });
};
