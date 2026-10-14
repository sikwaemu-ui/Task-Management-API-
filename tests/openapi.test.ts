process.env.NODE_ENV = "test";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/server";

describe("Swagger and OpenAPI documentation", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
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

  it("serves the interactive Swagger UI", async () => {
    const response = await fetch(`${baseUrl}/api-docs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /id="swagger-ui"/);
  });

  it("serves an OpenAPI 3 document with JWT auth and the actual routes", async () => {
    const response = await fetch(`${baseUrl}/api-docs.json`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);

    const document = await response.json() as {
      openapi: string;
      paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>;
      components: { securitySchemes: Record<string, { type: string; scheme: string; bearerFormat: string }> };
    };

    assert.match(document.openapi, /^3\./);
    assert.deepEqual(document.components.securitySchemes.bearerAuth, {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Paste the JWT returned by POST /api/auth/login. Do not include the word Bearer.",
    });

    for (const path of [
      "/api/health",
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/me",
      "/api/tasks",
      "/api/tasks/{id}",
      "/api/teams",
      "/api/teams/{id}",
      "/api/teams/{id}/members",
      "/api/teams/{id}/members/{userId}",
    ]) {
      assert.ok(document.paths[path], `Expected ${path} in OpenAPI paths`);
    }

    assert.equal(document.paths["/api/health"].get.security, undefined);
    assert.equal(document.paths["/api/auth/register"].post.security, undefined);
    assert.equal(document.paths["/api/auth/login"].post.security, undefined);
    const publicOperations = new Set([
      "GET /api/health",
      "POST /api/auth/register",
      "POST /api/auth/login",
    ]);
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (method === "parameters") continue;
        const key = `${method.toUpperCase()} ${path}`;
        if (publicOperations.has(key)) {
          assert.equal(operation.security, undefined, `${key} should be public`);
        } else {
          assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${key} should require JWT`);
        }
      }
    }
  });
});
