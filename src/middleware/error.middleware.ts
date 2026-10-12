import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { Prisma } from "@prisma/client";

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
      message: err.message,
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
  const errorMessage = err instanceof Error ? err.message : "Unknown error";
  console.error(`[Internal Server Error]: ${errorMessage}`);

  // Never expose stack traces, database details, secrets, or internal error messages
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
