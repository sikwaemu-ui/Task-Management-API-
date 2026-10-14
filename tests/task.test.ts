process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-min-32-characters-taskflow";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../src/server";
import prisma from "../src/db/prisma";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  taskIdParamSchema,
} from "../src/schemas/task.schema";
import { TaskStatus, TaskPriority, Role } from "@prisma/client";

describe("Personal Task Management Feature Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  const testSecret = process.env.JWT_SECRET || "test-jwt-secret-key-min-32-characters-taskflow";

  const createAuthToken = (
    userId: number = 1,
    email: string = "user1@example.com",
    role: Role = Role.USER
  ) => {
    return jwt.sign(
      { sub: String(userId), email, role },
      testSecret,
      { expiresIn: "1h" }
    );
  };

  const user1Token = createAuthToken(1, "user1@example.com");
  const user2Token = createAuthToken(2, "user2@example.com");

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

  // ==========================================
  // 1. Zod Schema Unit Tests
  // ==========================================
  describe("Task Zod Schemas Unit Tests", () => {
    describe("createTaskSchema", () => {
      it("validates and trims valid minimal title with default status and priority", () => {
        const result = createTaskSchema.safeParse({
          title: "   My new task   ",
        });

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.title, "My new task");
          assert.equal(result.data.status, TaskStatus.TODO);
          assert.equal(result.data.priority, TaskPriority.MEDIUM);
          assert.equal(result.data.description, undefined);
          assert.equal(result.data.dueDate, undefined);
        }
      });

      it("validates full valid payload with ISO due date", () => {
        const isoDate = "2026-12-31T23:59:59.000Z";
        const result = createTaskSchema.safeParse({
          title: "Complete milestone",
          description: "Detailed description here",
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.HIGH,
          dueDate: isoDate,
        });

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.title, "Complete milestone");
          assert.equal(result.data.description, "Detailed description here");
          assert.equal(result.data.status, TaskStatus.IN_PROGRESS);
          assert.equal(result.data.priority, TaskPriority.HIGH);
          assert.equal(result.data.dueDate, isoDate);
        }
      });

      it("rejects empty title or whitespace-only title", () => {
        const emptyResult = createTaskSchema.safeParse({ title: "" });
        assert.equal(emptyResult.success, false);

        const wsResult = createTaskSchema.safeParse({ title: "    " });
        assert.equal(wsResult.success, false);
      });

      it("rejects title exceeding 255 characters", () => {
        const longTitle = "a".repeat(256);
        const result = createTaskSchema.safeParse({ title: longTitle });
        assert.equal(result.success, false);
      });

      it("rejects invalid status enum value", () => {
        const result = createTaskSchema.safeParse({
          title: "Task",
          status: "INVALID_STATUS",
        });
        assert.equal(result.success, false);
      });

      it("rejects invalid priority enum value", () => {
        const result = createTaskSchema.safeParse({
          title: "Task",
          priority: "URGENT",
        });
        assert.equal(result.success, false);
      });

      it("rejects invalid dueDate format", () => {
        const result = createTaskSchema.safeParse({
          title: "Task",
          dueDate: "tomorrow afternoon",
        });
        assert.equal(result.success, false);
      });

      it("rejects unknown extra fields (strict schema prevents client injection)", () => {
        const result = createTaskSchema.safeParse({
          title: "Task",
          userId: 999,
          teamId: 456,
        });
        assert.equal(result.success, false);
      });
    });

    describe("updateTaskSchema", () => {
      it("validates partial fields update", () => {
        const result = updateTaskSchema.safeParse({
          status: TaskStatus.COMPLETED,
        });
        assert.equal(result.success, true);
      });

      it("rejects empty update object", () => {
        const result = updateTaskSchema.safeParse({});
        assert.equal(result.success, false);
      });

      it("rejects invalid fields or unknown properties", () => {
        const result = updateTaskSchema.safeParse({
          userId: 123,
        });
        assert.equal(result.success, false);
      });
    });

    describe("taskQuerySchema", () => {
      it("applies sensible defaults for pagination and sorting", () => {
        const result = taskQuerySchema.safeParse({});
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.page, 1);
          assert.equal(result.data.limit, 10);
          assert.equal(result.data.sortBy, "createdAt");
          assert.equal(result.data.sortOrder, "desc");
        }
      });

      it("coerces string page and limit to numbers", () => {
        const result = taskQuerySchema.safeParse({
          page: "3",
          limit: "25",
        });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.page, 3);
          assert.equal(result.data.limit, 25);
        }
      });

      it("rejects page < 1 and limit > 100", () => {
        const result1 = taskQuerySchema.safeParse({ page: 0 });
        assert.equal(result1.success, false);

        const result2 = taskQuerySchema.safeParse({ limit: 101 });
        assert.equal(result2.success, false);
      });

      it("rejects unlisted sortBy and invalid sortOrder", () => {
        const result1 = taskQuerySchema.safeParse({ sortBy: "password" });
        assert.equal(result1.success, false);

        const result2 = taskQuerySchema.safeParse({ sortOrder: "random" });
        assert.equal(result2.success, false);
      });
    });

    describe("taskIdParamSchema", () => {
      it("coerces and validates positive integer route parameter", () => {
        const result = taskIdParamSchema.safeParse({ id: "42" });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.id, 42);
        }
      });

      it("rejects negative numbers, zero, and non-numeric strings", () => {
        assert.equal(taskIdParamSchema.safeParse({ id: "0" }).success, false);
        assert.equal(taskIdParamSchema.safeParse({ id: "-5" }).success, false);
        assert.equal(taskIdParamSchema.safeParse({ id: "abc" }).success, false);
      });
    });
  });

  // ==========================================
  // 2. Authentication Protection on Endpoints
  // ==========================================
  describe("Authentication Requirements on all /api/tasks endpoints", () => {
    it("POST /api/tasks returns HTTP 401 when no token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test" }),
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("GET /api/tasks returns HTTP 401 when no token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/tasks`);
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("GET /api/tasks/:id returns HTTP 401 when no token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/1`);
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("PATCH /api/tasks/:id returns HTTP 401 when no token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("DELETE /api/tasks/:id returns HTTP 401 when no token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/1`, {
        method: "DELETE",
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("returns HTTP 401 for an invalid or forged token", async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        headers: { Authorization: "Bearer forged-or-invalid-token" },
      });
      const body = await res.json();
      assert.equal(res.status, 401);
      assert.equal(body.success, false);
      assert.equal(body.message, "Invalid or expired token");
    });
  });

  // ==========================================
  // 3. POST /api/tasks (Create Task)
  // ==========================================
  describe("POST /api/tasks — Create Personal Task", () => {
    it("creates a personal task and assigns ownership to authenticated user", async () => {
      const originalCreate = prisma.task.create;
      let capturedCreateArgs: any = null;

      try {
        prisma.task.create = (async (args: any) => {
          capturedCreateArgs = args;
          return {
            id: 101,
            title: args.data.title,
            description: args.data.description,
            status: args.data.status,
            priority: args.data.priority,
            dueDate: args.data.dueDate,
            userId: args.data.userId,
            teamId: args.data.teamId,
            createdAt: new Date("2026-10-13T10:00:00.000Z"),
            updatedAt: new Date("2026-10-13T10:00:00.000Z"),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user1Token}`,
          },
          body: JSON.stringify({
            title: "Write integration tests",
            description: "Coverage for all endpoints",
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            dueDate: "2026-10-20T18:00:00.000Z",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task created successfully");
        assert.ok(body.data.task);
        assert.equal(body.data.task.id, 101);
        assert.equal(body.data.task.title, "Write integration tests");
        assert.equal(body.data.task.userId, 1);
        assert.equal(body.data.task.teamId, null);

        // Verify database invocation forced ownership and null teamId
        assert.equal(capturedCreateArgs.data.userId, 1);
        assert.equal(capturedCreateArgs.data.teamId, null);
      } finally {
        prisma.task.create = originalCreate;
      }
    });

    it("applies default status TODO, priority MEDIUM, null description and dueDate", async () => {
      const originalCreate = prisma.task.create;

      try {
        prisma.task.create = (async (args: any) => {
          return {
            id: 102,
            title: args.data.title,
            description: args.data.description,
            status: args.data.status,
            priority: args.data.priority,
            dueDate: args.data.dueDate,
            userId: args.data.userId,
            teamId: args.data.teamId,
            createdAt: new Date("2026-10-13T10:00:00.000Z"),
            updatedAt: new Date("2026-10-13T10:00:00.000Z"),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user1Token}`,
          },
          body: JSON.stringify({
            title: "Minimal Task",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.data.task.status, TaskStatus.TODO);
        assert.equal(body.data.task.priority, TaskPriority.MEDIUM);
        assert.equal(body.data.task.description, null);
        assert.equal(body.data.task.dueDate, null);
      } finally {
        prisma.task.create = originalCreate;
      }
    });

    it("rejects creation with empty title (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user1Token}`,
        },
        body: JSON.stringify({
          title: "   ",
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
      assert.equal(body.message, "Validation failed");
      assert.ok(Array.isArray(body.errors));
    });

    it("rejects client attempt to inject userId or teamId in request body (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user1Token}`,
        },
        body: JSON.stringify({
          title: "Injected Task",
          userId: 999,
          teamId: 888,
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
    });
  });

  // ==========================================
  // 4. GET /api/tasks (List Tasks with Filter/Sort/Pagination)
  // ==========================================
  describe("GET /api/tasks — List User's Tasks", () => {
    it("returns paginated tasks for authenticated user with default query parameters", async () => {
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedFindManyArgs: any = null;
      let capturedCountArgs: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedFindManyArgs = args;
          return [
            {
              id: 1,
              title: "User 1 Task 1",
              description: null,
              status: TaskStatus.TODO,
              priority: TaskPriority.MEDIUM,
              dueDate: null,
              userId: 1,
              teamId: null,
              createdAt: new Date("2026-10-13T10:00:00.000Z"),
              updatedAt: new Date("2026-10-13T10:00:00.000Z"),
            },
          ];
        }) as any;

        prisma.task.count = (async (args: any) => {
          capturedCountArgs = args;
          return 1;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Tasks retrieved successfully");
        assert.equal(body.data.tasks.length, 1);
        assert.equal(body.data.pagination.page, 1);
        assert.equal(body.data.pagination.limit, 10);
        assert.equal(body.data.pagination.total, 1);
        assert.equal(body.data.pagination.totalPages, 1);

        // Verify strictly queried by userId: 1
        assert.equal(capturedFindManyArgs.where.userId, 1);
        assert.equal(capturedCountArgs.where.userId, 1);
        assert.equal(capturedFindManyArgs.skip, 0);
        assert.equal(capturedFindManyArgs.take, 10);
      } finally {
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("applies status and priority filters correctly", async () => {
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedWhere: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedWhere = args.where;
          return [];
        }) as any;
        prisma.task.count = (async () => 0) as any;

        const res = await fetch(
          `${baseUrl}/api/tasks?status=IN_PROGRESS&priority=HIGH`,
          {
            headers: { Authorization: `Bearer ${user1Token}` },
          }
        );

        assert.equal(res.status, 200);
        assert.equal(capturedWhere.userId, 1);
        assert.equal(capturedWhere.status, TaskStatus.IN_PROGRESS);
        assert.equal(capturedWhere.priority, TaskPriority.HIGH);
      } finally {
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("applies search filter across title and description", async () => {
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedWhere: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedWhere = args.where;
          return [];
        }) as any;
        prisma.task.count = (async () => 0) as any;

        const res = await fetch(`${baseUrl}/api/tasks?search=deploy`, {
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        assert.equal(res.status, 200);
        assert.ok(capturedWhere.OR);
        assert.deepEqual(capturedWhere.OR, [
          { title: { contains: "deploy", mode: "insensitive" } },
          { description: { contains: "deploy", mode: "insensitive" } },
        ]);
      } finally {
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("applies custom pagination and sorting", async () => {
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedArgs: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedArgs = args;
          return [];
        }) as any;
        prisma.task.count = (async () => 45) as any;

        const res = await fetch(
          `${baseUrl}/api/tasks?page=2&limit=20&sortBy=dueDate&sortOrder=asc`,
          {
            headers: { Authorization: `Bearer ${user1Token}` },
          }
        );

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(capturedArgs.skip, 20);
        assert.equal(capturedArgs.take, 20);
        assert.deepEqual(capturedArgs.orderBy, [
          { dueDate: "asc" },
          { id: "asc" },
        ]);
        assert.equal(body.data.pagination.page, 2);
        assert.equal(body.data.pagination.limit, 20);
        assert.equal(body.data.pagination.total, 45);
        assert.equal(body.data.pagination.totalPages, 3);
      } finally {
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("rejects invalid query parameters (HTTP 400)", async () => {
      const res1 = await fetch(`${baseUrl}/api/tasks?page=0`, {
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/tasks?limit=105`, {
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      assert.equal(res2.status, 400);

      const res3 = await fetch(`${baseUrl}/api/tasks?sortBy=nonexistent`, {
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      assert.equal(res3.status, 400);

      const res4 = await fetch(`${baseUrl}/api/tasks?sortOrder=upwards`, {
        headers: { Authorization: `Bearer ${user1Token}` },
      });
      assert.equal(res4.status, 400);
    });
  });

  // ==========================================
  // 5. GET /api/tasks/:id (Retrieve Single Task)
  // ==========================================
  describe("GET /api/tasks/:id — Retrieve Single Task", () => {
    it("returns task when owned by authenticated user", async () => {
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 10 && args.where.userId === 1) {
            return {
              id: 10,
              title: "User 1 Owned Task",
              description: "Secret user notes",
              status: TaskStatus.TODO,
              priority: TaskPriority.LOW,
              dueDate: null,
              userId: 1,
              teamId: null,
              createdAt: new Date("2026-10-13T10:00:00.000Z"),
              updatedAt: new Date("2026-10-13T10:00:00.000Z"),
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/10`, {
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task retrieved successfully");
        assert.equal(body.data.task.id, 10);
        assert.equal(body.data.task.userId, 1);
      } finally {
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 404 when task does not exist", async () => {
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async () => null) as any;

        const res = await fetch(`${baseUrl}/api/tasks/99999`, {
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Task not found");
      } finally {
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 404 when task belongs to another user (prevents ownership enumeration)", async () => {
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async (args: any) => {
          // Task 10 belongs to user 1. User 2 asks for task 10:
          if (args.where.id === 10 && args.where.userId === 1) {
            return { id: 10, userId: 1 };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/10`, {
          headers: { Authorization: `Bearer ${user2Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Task not found");
      } finally {
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 400 for invalid task id parameter", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/invalid-id`, {
        headers: { Authorization: `Bearer ${user1Token}` },
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
      assert.equal(body.message, "Validation failed");
    });
  });

  // ==========================================
  // 6. PATCH /api/tasks/:id (Update Task)
  // ==========================================
  describe("PATCH /api/tasks/:id — Partially Update Task", () => {
    it("updates task fields atomically for owned task", async () => {
      const originalUpdateMany = prisma.task.updateMany;
      const originalFindFirst = prisma.task.findFirst;
      let capturedWhere: any = null;

      try {
        prisma.task.updateMany = (async (args: any) => {
          capturedWhere = args.where;
          if (args.where.id === 5 && args.where.userId === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        }) as any;

        prisma.task.findFirst = (async () => {
          return {
            id: 5,
            title: "Updated Title",
            description: "Updated Description",
            status: TaskStatus.COMPLETED,
            priority: TaskPriority.HIGH,
            dueDate: new Date("2026-11-01T00:00:00.000Z"),
            userId: 1,
            teamId: null,
            createdAt: new Date("2026-10-13T10:00:00.000Z"),
            updatedAt: new Date("2026-10-13T11:00:00.000Z"),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/5`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user1Token}`,
          },
          body: JSON.stringify({
            title: "Updated Title",
            status: TaskStatus.COMPLETED,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task updated successfully");
        assert.equal(body.data.task.status, TaskStatus.COMPLETED);

        // Direct DB atomic ownership verification
        assert.equal(capturedWhere.id, 5);
        assert.equal(capturedWhere.userId, 1);
      } finally {
        prisma.task.updateMany = originalUpdateMany;
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 404 when another user attempts to update a task", async () => {
      const originalUpdateMany = prisma.task.updateMany;

      try {
        prisma.task.updateMany = (async (args: any) => {
          // Task 5 belongs to user 1, so updateMany with userId: 2 yields count 0
          if (args.where.id === 5 && args.where.userId === 2) {
            return { count: 0 };
          }
          return { count: 1 };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/5`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user2Token}`,
          },
          body: JSON.stringify({
            title: "Hacked Title",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Task not found");
      } finally {
        prisma.task.updateMany = originalUpdateMany;
      }
    });

    it("rejects empty update request body (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/5`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user1Token}`,
        },
        body: JSON.stringify({}),
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
      assert.equal(body.message, "Validation failed");
    });

    it("rejects invalid status value on update (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/5`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user1Token}`,
        },
        body: JSON.stringify({
          status: "NOT_A_VALID_STATUS",
        }),
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
    });
  });

  // ==========================================
  // 7. DELETE /api/tasks/:id (Delete Task)
  // ==========================================
  describe("DELETE /api/tasks/:id — Delete Task", () => {
    it("deletes owned task atomically and returns HTTP 200", async () => {
      const originalDeleteMany = prisma.task.deleteMany;
      let capturedWhere: any = null;

      try {
        prisma.task.deleteMany = (async (args: any) => {
          capturedWhere = args.where;
          if (args.where.id === 8 && args.where.userId === 1) {
            return { count: 1 };
          }
          return { count: 0 };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/8`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task deleted successfully");

        // Verify DB atomic query enforced id and userId
        assert.equal(capturedWhere.id, 8);
        assert.equal(capturedWhere.userId, 1);
      } finally {
        prisma.task.deleteMany = originalDeleteMany;
      }
    });

    it("returns HTTP 404 when task does not exist", async () => {
      const originalDeleteMany = prisma.task.deleteMany;

      try {
        prisma.task.deleteMany = (async () => ({ count: 0 })) as any;

        const res = await fetch(`${baseUrl}/api/tasks/999`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${user1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Task not found");
      } finally {
        prisma.task.deleteMany = originalDeleteMany;
      }
    });

    it("returns HTTP 404 when another user attempts to delete a task", async () => {
      const originalDeleteMany = prisma.task.deleteMany;

      try {
        prisma.task.deleteMany = (async (args: any) => {
          // Task 8 belongs to user 1, user 2 has count 0
          if (args.where.id === 8 && args.where.userId === 2) {
            return { count: 0 };
          }
          return { count: 1 };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/8`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${user2Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Task not found");
      } finally {
        prisma.task.deleteMany = originalDeleteMany;
      }
    });

    it("returns HTTP 400 for invalid task ID parameter", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/-1`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user1Token}` },
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
    });
  });
});
