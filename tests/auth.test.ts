process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-min-32-characters-taskflow";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../src/server";
import prisma from "../src/db/prisma";
import { registerSchema, loginSchema } from "../src/schemas/auth.schema";
import { Prisma, Role } from "@prisma/client";

describe("Auth Feature End-to-End Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe("User Registration Feature", () => {
    describe("Schema Validation Unit Tests", () => {
      it("normalizes email to lowercase and trims surrounding whitespace", () => {
        const parsed = registerSchema.safeParse({
          email: "   User.Account@Domain.COM   ",
          password: "ValidPassword123!",
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
          assert.equal(parsed.data.email, "user.account@domain.com");
        }
      });

      it("rejects invalid email formats", () => {
        const parsed = registerSchema.safeParse({
          email: "not-an-email",
          password: "ValidPassword123!",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          const emailIssue = parsed.error.issues.find((i) => i.path.includes("email"));
          assert.ok(emailIssue, "Expected an error on email field");
        }
      });

      it("rejects missing email", () => {
        const parsed = registerSchema.safeParse({
          password: "ValidPassword123!",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          const emailIssue = parsed.error.issues.find((i) => i.path.includes("email"));
          assert.ok(emailIssue);
        }
      });

      it("rejects missing password", () => {
        const parsed = registerSchema.safeParse({
          email: "user@example.com",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          const passwordIssue = parsed.error.issues.find((i) => i.path.includes("password"));
          assert.ok(passwordIssue);
        }
      });

      it("rejects password shorter than 8 characters", () => {
        const parsed = registerSchema.safeParse({
          email: "user@example.com",
          password: "Short12",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          const passwordIssue = parsed.error.issues.find((i) => i.path.includes("password"));
          assert.ok(passwordIssue);
        }
      });

      it("rejects password exceeding 72 UTF-8 bytes to protect bcrypt limits", () => {
        const longAscii = registerSchema.safeParse({
          email: "user@example.com",
          password: "a".repeat(73),
        });
        assert.equal(longAscii.success, false);

        const multiByteLong = registerSchema.safeParse({
          email: "user@example.com",
          password: "🔐".repeat(19),
        });
        assert.equal(multiByteLong.success, false);
      });

      it("rejects unexpected fields such as client-supplied role", () => {
        const parsed = registerSchema.safeParse({
          email: "user@example.com",
          password: "ValidPassword123!",
          role: "ADMIN",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.code === "unrecognized_keys"));
        }
      });
    });

    describe("Registration API Endpoints & Integration Tests", () => {
      it("preserves GET /api/health", async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task Managing API is running");
      });

      it("returns 400 when registering with an invalid email", async () => {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "invalid-email-format",
            password: "ValidPassword123!",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, "Validation failed");
        assert.ok(Array.isArray(body.errors));
      });

      it("returns 400 when registering with missing password", async () => {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, "Validation failed");
      });

      it("returns 400 when password is under 8 characters", async () => {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
            password: "short",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
      });

      it("returns 400 when password exceeds 72 UTF-8 bytes", async () => {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
            password: "a".repeat(73),
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
      });

      it("returns 400 when supplying role: ADMIN to prevent privilege escalation", async () => {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "hacker@example.com",
            password: "SecurePassword123!",
            role: "ADMIN",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
      });

      it("registers user successfully with HTTP 201, default USER role, and no password exposed", async () => {
        const originalFindUnique = prisma.user.findUnique;
        const originalCreate = prisma.user.create;

        const mockUser = {
          id: 42,
          email: "newuser@example.com",
          role: "USER" as Role,
          createdAt: new Date("2026-10-12T10:00:00.000Z"),
        };

        try {
          prisma.user.findUnique = (async () => null) as any;
          prisma.user.create = (async (args: any) => {
            assert.notEqual(args.data.password, "SecurePass123!");
            assert.equal(args.data.password.length, 60);
            assert.equal(args.data.role, undefined);
            return mockUser;
          }) as any;

          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "  NewUser@Example.COM  ",
              password: "SecurePass123!",
            }),
          });

          const body = await res.json();

          assert.equal(res.status, 201);
          assert.equal(body.success, true);
          assert.equal(body.message, "Account created successfully");
          assert.ok(body.data);
          assert.ok(body.data.user);
          assert.equal(body.data.user.id, 42);
          assert.equal(body.data.user.email, "newuser@example.com");
          assert.equal(body.data.user.role, "USER");

          assert.equal(body.data.user.password, undefined);
          assert.equal(body.data.user.passwordHash, undefined);
          assert.equal(JSON.stringify(body).includes("SecurePass123!"), false);
        } finally {
          prisma.user.findUnique = originalFindUnique;
          prisma.user.create = originalCreate;
        }
      });

      it("returns HTTP 409 when duplicate email is detected via pre-check", async () => {
        const originalFindUnique = prisma.user.findUnique;

        try {
          prisma.user.findUnique = (async () => ({ id: 1 })) as any;

          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "existing@example.com",
              password: "SecurePass123!",
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 409);
          assert.equal(body.success, false);
          assert.equal(body.message, "An account with this email already exists");
        } finally {
          prisma.user.findUnique = originalFindUnique;
        }
      });

      it("returns HTTP 409 when duplicate email causes Prisma P2002 unique constraint violation on concurrent insert", async () => {
        const originalFindUnique = prisma.user.findUnique;
        const originalCreate = prisma.user.create;

        try {
          prisma.user.findUnique = (async () => null) as any;
          prisma.user.create = (async () => {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", {
              code: "P2002",
              clientVersion: "7.10.0",
            });
          }) as any;

          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "racecondition@example.com",
              password: "SecurePass123!",
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 409);
          assert.equal(body.success, false);
          assert.equal(body.message, "An account with this email already exists");
        } finally {
          prisma.user.findUnique = originalFindUnique;
          prisma.user.create = originalCreate;
        }
      });

      it("returns safe HTTP 500 without exposing internal details or stack trace on unexpected errors", async () => {
        const originalFindUnique = prisma.user.findUnique;

        try {
          prisma.user.findUnique = (async () => {
            throw new Error("Sensitive database connection credentials failure: secret_123");
          }) as any;

          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "error@example.com",
              password: "SecurePass123!",
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 500);
          assert.equal(body.success, false);
          assert.equal(body.message, "Internal server error");

          assert.equal(JSON.stringify(body).includes("secret_123"), false);
          assert.equal(JSON.stringify(body).includes("stack"), false);
        } finally {
          prisma.user.findUnique = originalFindUnique;
        }
      });
    });
  });

  describe("User Login Feature", () => {
    describe("Login Schema Validation Unit Tests", () => {
      it("normalizes login email to lowercase and trims whitespace", () => {
        const parsed = loginSchema.safeParse({
          email: "   Member.Login@Domain.COM   ",
          password: "MyPassword123!",
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
          assert.equal(parsed.data.email, "member.login@domain.com");
          assert.equal(parsed.data.password, "MyPassword123!");
        }
      });

      it("rejects invalid login email format", () => {
        const parsed = loginSchema.safeParse({
          email: "invalid-login-email",
          password: "MyPassword123!",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.path.includes("email")));
        }
      });

      it("rejects missing email on login", () => {
        const parsed = loginSchema.safeParse({
          password: "MyPassword123!",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.path.includes("email")));
        }
      });

      it("rejects missing password on login", () => {
        const parsed = loginSchema.safeParse({
          email: "user@example.com",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.path.includes("password")));
        }
      });

      it("rejects empty password on login", () => {
        const parsed = loginSchema.safeParse({
          email: "user@example.com",
          password: "",
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.path.includes("password")));
        }
      });

      it("rejects oversized password on login to protect bcrypt limits", () => {
        const parsed = loginSchema.safeParse({
          email: "user@example.com",
          password: "a".repeat(73),
        });

        assert.equal(parsed.success, false);
      });

      it("rejects unexpected fields in login request body", () => {
        const parsed = loginSchema.safeParse({
          email: "user@example.com",
          password: "MyPassword123!",
          role: "ADMIN",
          extra: true,
        });

        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((i) => i.code === "unrecognized_keys"));
        }
      });
    });

    describe("Login API Endpoints & Integration Tests", () => {
      it("logs in user successfully with HTTP 200, valid JWT Bearer token, and safe public user object", async () => {
        const originalFindUnique = prisma.user.findUnique;
        const validPassword = "SecurePassword123!";
        const passwordHash = await bcrypt.hash(validPassword, 10);

        try {
          prisma.user.findUnique = (async (args: any) => {
            assert.equal(args.where.email, "validuser@example.com");
            return {
              id: 99,
              email: "validuser@example.com",
              password: passwordHash,
              role: "USER" as Role,
            };
          }) as any;

          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "  ValidUser@Example.COM  ",
              password: validPassword,
            }),
          });

          const body = await res.json();

          assert.equal(res.status, 200);
          assert.equal(body.success, true);
          assert.equal(body.message, "Login successful");
          assert.ok(body.data);
          assert.equal(body.data.tokenType, "Bearer");
          assert.ok(typeof body.data.token === "string" && body.data.token.length > 0);

          // Verify safe user object
          assert.deepEqual(body.data.user, {
            id: 99,
            email: "validuser@example.com",
            role: "USER",
          });

          // Verify password and hash are not present in response
          assert.equal(body.data.user.password, undefined);
          assert.equal(body.data.user.passwordHash, undefined);
          assert.equal(JSON.stringify(body).includes(passwordHash), false);

          // Verify token claims
          const decoded = jwt.decode(body.data.token) as any;
          assert.ok(decoded);
          assert.equal(decoded.sub, "99");
          assert.equal(decoded.email, "validuser@example.com");
          assert.equal(decoded.role, "USER");
          assert.ok(typeof decoded.exp === "number");
          assert.ok(typeof decoded.iat === "number");
          assert.equal(decoded.password, undefined);
          assert.equal(decoded.passwordHash, undefined);
        } finally {
          prisma.user.findUnique = originalFindUnique;
        }
      });

      it("returns generic HTTP 401 when email is unknown without disclosing account existence", async () => {
        const originalFindUnique = prisma.user.findUnique;

        try {
          prisma.user.findUnique = (async () => null) as any;

          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "nonexistent@example.com",
              password: "SomePassword123!",
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 401);
          assert.equal(body.success, false);
          assert.equal(body.message, "Invalid email or password");
        } finally {
          prisma.user.findUnique = originalFindUnique;
        }
      });

      it("returns identical generic HTTP 401 when password is incorrect", async () => {
        const originalFindUnique = prisma.user.findUnique;
        const realPassword = "CorrectPassword123!";
        const passwordHash = await bcrypt.hash(realPassword, 10);

        try {
          prisma.user.findUnique = (async () => ({
            id: 12,
            email: "user@example.com",
            password: passwordHash,
            role: "USER" as Role,
          })) as any;

          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "user@example.com",
              password: "WrongPassword999!",
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 401);
          assert.equal(body.success, false);
          assert.equal(body.message, "Invalid email or password");
        } finally {
          prisma.user.findUnique = originalFindUnique;
        }
      });

      it("returns HTTP 400 when login email is malformed", async () => {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "not-an-email",
            password: "SomePassword123!",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, "Validation failed");
        assert.ok(Array.isArray(body.errors));
      });

      it("returns HTTP 400 when login password is missing", async () => {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, "Validation failed");
      });

      it("returns HTTP 400 when login payload contains unrecognized fields", async () => {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
            password: "SomePassword123!",
            role: "ADMIN",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.message, "Validation failed");
      });

      it("returns safe HTTP 500 without disclosing internals when JWT_SECRET configuration is missing", async () => {
        const originalFindUnique = prisma.user.findUnique;
        const originalSecret = process.env.JWT_SECRET;
        const validPassword = "SecurePassword123!";
        const passwordHash = await bcrypt.hash(validPassword, 10);

        try {
          delete process.env.JWT_SECRET;

          prisma.user.findUnique = (async () => ({
            id: 88,
            email: "user@example.com",
            password: passwordHash,
            role: "USER" as Role,
          })) as any;

          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "user@example.com",
              password: validPassword,
            }),
          });

          const body = await res.json();
          assert.equal(res.status, 500);
          assert.equal(body.success, false);
          assert.equal(body.message, "Internal server error");

          // Ensure secret and stack trace are never exposed to the client
          assert.equal(JSON.stringify(body).includes("JWT_SECRET"), false);
          assert.equal(JSON.stringify(body).includes("stack"), false);
        } finally {
          process.env.JWT_SECRET = originalSecret;
          prisma.user.findUnique = originalFindUnique;
        }
      });
    });
  });
});
