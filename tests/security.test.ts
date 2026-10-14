process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "https://frontend.example.test";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import express, { Request, Response } from "express";
import { createRateLimiters } from "../src/middleware/rate-limit.middleware";
import { createRequestLogger, RequestLogEntry } from "../src/middleware/request-logger.middleware";
import { errorHandler, redactSensitiveText } from "../src/middleware/error.middleware";
import { createGracefulShutdown } from "../src/server-lifecycle";

describe("production security and reliability controls", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const { default: app } = await import("../src/server");
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("sets baseline security headers without a Swagger-breaking CSP or CORP", async () => {
    const response = await fetch(`${baseUrl}/api-docs`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("content-security-policy"), null);
    assert.equal(response.headers.get("cross-origin-resource-policy"), null);
  });

  it("allows configured browser origins and rejects other browser origins", async () => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://frontend.example.test" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://frontend.example.test");

    const rejected = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://attacker.example.test" },
    });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), {
      success: false,
      message: "Origin is not allowed by CORS",
    });
  });

  it("returns a consistent 429 after the stricter auth limiter budget is exhausted", async () => {
    const { validateEnvironment } = await import("../src/config/env");
    const config = validateEnvironment({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:password@localhost:5432/taskflow",
      JWT_SECRET: "this-is-a-test-secret-with-at-least-32-characters",
      AUTH_RATE_LIMIT_MAX: "2",
      AUTH_RATE_LIMIT_WINDOW_MS: "60000",
      API_RATE_LIMIT_MAX: "4",
      CORS_ORIGINS: "https://frontend.example.test",
    });
    const { authLimiter, apiLimiter } = createRateLimiters(config);
    const limiterApp = express();

    // Match the production middleware order: the exact health route completes
    // before the general /api limiter; all following API routes remain limited.
    limiterApp.get("/api/health", (_req, res) => res.json({ success: true }));
    limiterApp.use("/api", apiLimiter);
    limiterApp.post("/api/auth/login", authLimiter, (_req, res) => res.json({ success: true }));
    limiterApp.post("/api/auth/register", authLimiter, (_req, res) => res.json({ success: true }));
    limiterApp.get("/api/tasks", (_req, res) => res.json({ success: true }));
    const limiterServer = http.createServer(limiterApp);
    await new Promise<void>((resolve) => limiterServer.listen(0, "127.0.0.1", resolve));
    const address = limiterServer.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}`;

    try {
      assert.equal((await fetch(`${url}/api/auth/login`, { method: "POST" })).status, 200);
      assert.equal((await fetch(`${url}/api/auth/register`, { method: "POST" })).status, 200);
      const limited = await fetch(`${url}/api/auth/login`, { method: "POST" });
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), {
        success: false,
        message: "Too many requests. Please try again later.",
      });
      assert.ok(limited.headers.has("ratelimit"));

      assert.equal((await fetch(`${url}/api/tasks`)).status, 200);
      const apiLimited = await fetch(`${url}/api/tasks`);
      assert.equal(apiLimited.status, 429);
      assert.deepEqual(await apiLimited.json(), {
        success: false,
        message: "Too many requests. Please try again later.",
      });

      const healthAfterQuota = await fetch(`${url}/api/health`);
      assert.equal(healthAfterQuota.status, 200);
      assert.deepEqual(await healthAfterQuota.json(), { success: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        limiterServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("validates production configuration and reports names without secret values", () => {
    return import("../src/config/env").then(({ validateEnvironment }) => {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: "production" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.match(error.message, /JWT_SECRET/);
        return true;
      }
    );

    const privateValue = "dont-print-this-database-password";
    assert.throws(
      () => validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: `postgresql://user:${privateValue}@localhost:5432/taskflow`,
        JWT_SECRET: "too-short",
        JWT_EXPIRES_IN: "forever",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /JWT_SECRET/);
        assert.match(error.message, /JWT_EXPIRES_IN/);
        assert.equal(error.message.includes(privateValue), false);
        return true;
      }
    );
    });
  });

  it("returns safe production errors and omits internal messages from logs", async () => {
    const errorApp = express();
    errorApp.get("/failure", (_req, _res, next) => {
      next(new Error("DATABASE_URL=postgresql://user:secret@db.invalid/app Bearer abc.def.ghi"));
    });
    errorApp.use(errorHandler);
    const errorServer = http.createServer(errorApp);
    await new Promise<void>((resolve) => errorServer.listen(0, "127.0.0.1", resolve));
    const address = errorServer.address();
    assert.ok(address && typeof address === "object");
    const previousMode = process.env.NODE_ENV;
    const previousError = console.error;
    const errorLogs: string[] = [];
    process.env.NODE_ENV = "production";
    console.error = (message?: unknown) => errorLogs.push(String(message));

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/failure`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        success: false,
        message: "Internal server error",
      });
      assert.equal(errorLogs.length, 1);
      assert.equal(errorLogs[0].includes("secret"), false);
      assert.equal(errorLogs[0].includes("abc.def.ghi"), false);
    } finally {
      process.env.NODE_ENV = previousMode;
      console.error = previousError;
      await new Promise<void>((resolve, reject) => {
        errorServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("logs request metadata without query strings, headers, or bodies", () => {
    const entries: RequestLogEntry[] = [];
    const response = new EventEmitter() as Response;
    response.statusCode = 201;
    const request = {
      method: "POST",
      path: "/api/auth/login",
      url: "/api/auth/login?access_token=query-secret",
      headers: { authorization: "Bearer header-secret" },
      body: { password: "body-secret" },
    } as unknown as Request;
    let nextCalled = false;

    createRequestLogger((entry) => entries.push(entry))(request, response, () => {
      nextCalled = true;
    });
    response.emit("finish");

    assert.equal(nextCalled, true);
    assert.equal(entries.length, 1);
    assert.deepEqual(Object.keys(entries[0]).sort(), ["durationMs", "event", "method", "path", "status"]);
    assert.equal(JSON.stringify(entries).includes("secret"), false);
    assert.equal(entries[0].status, 201);
    assert.equal(
      redactSensitiveText("Sensitive database connection credentials failure: secret_123").includes("secret_123"),
      false
    );
  });

  it("disconnects once when shutdown is triggered more than once", async () => {
    let closeCalls = 0;
    let disconnectCalls = 0;
    const fakeServer = {
      close(callback?: (error?: Error) => void) {
        closeCalls += 1;
        callback?.();
        return this;
      },
      closeAllConnections() {},
    } as unknown as http.Server;
    const shutdown = createGracefulShutdown({
      server: fakeServer,
      disconnect: async () => { disconnectCalls += 1; },
      timeoutMs: 100,
      write: () => undefined,
    });

    const [first, second] = await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(closeCalls, 1);
    assert.equal(disconnectCalls, 1);
  });

  it("bounds a stalled HTTP shutdown and still disconnects the database", async () => {
    let forcedCloses = 0;
    let disconnectCalls = 0;
    const fakeServer = {
      close() { return this; },
      closeAllConnections() { forcedCloses += 1; },
    } as unknown as http.Server;
    const shutdown = createGracefulShutdown({
      server: fakeServer,
      disconnect: async () => { disconnectCalls += 1; },
      timeoutMs: 10,
      write: () => undefined,
    });

    assert.equal(await shutdown("SIGTERM"), false);
    assert.equal(forcedCloses, 1);
    assert.equal(disconnectCalls, 1);
  });
});
