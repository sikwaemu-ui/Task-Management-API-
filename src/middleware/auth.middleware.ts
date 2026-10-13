import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { UnauthorizedError } from "../utils/errors";
import { verifyToken } from "../utils/jwt";

export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || typeof authHeader !== "string") {
      throw new UnauthorizedError("Authentication required");
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      throw new UnauthorizedError("Invalid or unsupported authorization header format");
    }

    const token = parts[1];
    if (!token || token.trim() === "") {
      throw new UnauthorizedError("Authentication token is required");
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      if (
        err instanceof jwt.JsonWebTokenError ||
        err instanceof jwt.TokenExpiredError ||
        err instanceof jwt.NotBeforeError
      ) {
        throw new UnauthorizedError("Invalid or expired token");
      }
      // Re-throw unexpected internal errors (e.g. missing JWT_SECRET) to be handled as HTTP 500
      throw err;
    }

    // Validate required claims
    const userId = Number(payload.sub);
    if (
      !payload.sub ||
      typeof payload.sub !== "string" ||
      !Number.isInteger(userId) ||
      userId <= 0
    ) {
      throw new UnauthorizedError("Invalid token subject claim");
    }

    if (!payload.email || typeof payload.email !== "string") {
      throw new UnauthorizedError("Invalid token email claim");
    }

    if (!payload.role || !Object.values(Role).includes(payload.role)) {
      throw new UnauthorizedError("Invalid token role claim");
    }

    // Attach minimal verified user identity to request
    req.user = {
      id: userId,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};
