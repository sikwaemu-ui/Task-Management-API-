import jwt, { SignOptions } from "jsonwebtoken";
import { Role } from "@prisma/client";

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export function getJwtConfig(): JwtConfig {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === "") {
    throw new Error("JWT_SECRET environment variable is missing or empty.");
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || "1d";

  return { secret, expiresIn };
}

export function generateToken(user: { id: number; email: string; role: Role }): string {
  const { secret, expiresIn } = getJwtConfig();

  const payload: JwtTokenPayload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
  };

  const options: SignOptions = {
    expiresIn: expiresIn as SignOptions["expiresIn"],
  };

  return jwt.sign(payload, secret, options);
}

export function verifyToken(token: string): JwtTokenPayload {
  const { secret } = getJwtConfig();
  return jwt.verify(token, secret) as JwtTokenPayload;
}
