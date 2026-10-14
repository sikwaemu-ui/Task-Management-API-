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
} from "../src/schemas/task.schema";
import { TaskStatus, TaskPriority, TeamRole, Role } from "@prisma/client";

describe("Collaborative Team Task Management Feature Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  const testSecret = process.env.JWT_SECRET || "test-jwt-secret-key-min-32-characters-taskflow";

  const createAuthToken = (
    userId: number,
    email: string,
    role: Role = Role.USER
  ) => {
    return jwt.sign(
      { sub: String(userId), email, role },
      testSecret,
      { expiresIn: "1h" }
    );
  };

  const ownerToken = createAuthToken(1, "teamowner@example.com");
  const adminToken = createAuthToken(2, "teamadmin@example.com");
  const member1Token = createAuthToken(3, "member1@example.com");
  const member2Token = createAuthToken(4, "member2@example.com");
  const outsiderToken = createAuthToken(5, "outsider@example.com");

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

  // Helper for mock team memberships on Team 10
  const mockTeamMemberships: Record<number, TeamRole> = {
    1: TeamRole.OWNER,
    2: TeamRole.ADMIN,
    3: TeamRole.MEMBER,
    4: TeamRole.MEMBER,
    // 5 is outsider (not in Team 10)
  };

  const setupMockTeamMember = () => {
    const originalFindUnique = prisma.teamMember.findUnique;
    prisma.teamMember.findUnique = (async (args: any) => {
      const { userId, teamId } = args.where.userId_teamId || {};
      if (teamId === 10 && mockTeamMemberships[userId]) {
        return {
          id: 100 + userId,
          userId,
          teamId: 10,
          role: mockTeamMemberships[userId],
          createdAt: new Date(),
        };
      }
      return null;
    }) as any;
    return () => {
      prisma.teamMember.findUnique = originalFindUnique;
    };
  };

  // ==========================================
  // 1. Schema Validation for Team Tasks
  // ==========================================
  describe("Team Task Zod Schemas Validation", () => {
    it("accepts valid positive integer teamId in createTaskSchema", () => {
      const result = createTaskSchema.safeParse({
        title: "Sprint Planning",
        teamId: 10,
      });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.teamId, 10);
      }
    });

    it("accepts null or omitted teamId for personal tasks", () => {
      const res1 = createTaskSchema.safeParse({ title: "Task 1", teamId: null });
      assert.equal(res1.success, true);
      const res2 = createTaskSchema.safeParse({ title: "Task 2" });
      assert.equal(res2.success, true);
    });

    it("rejects non-positive teamId in createTaskSchema", () => {
      assert.equal(createTaskSchema.safeParse({ title: "Task", teamId: 0 }).success, false);
      assert.equal(createTaskSchema.safeParse({ title: "Task", teamId: -1 }).success, false);
      assert.equal(createTaskSchema.safeParse({ title: "Task", teamId: "invalid" }).success, false);
    });

    it("rejects client attempt to inject userId or role in createTaskSchema", () => {
      assert.equal(
        createTaskSchema.safeParse({ title: "Task", teamId: 10, userId: 99 }).success,
        false
      );
      assert.equal(
        createTaskSchema.safeParse({ title: "Task", teamId: 10, role: "ADMIN" }).success,
        false
      );
    });

    it("rejects changing teamId in updateTaskSchema", () => {
      assert.equal(
        updateTaskSchema.safeParse({ title: "Updated", teamId: 20 }).success,
        false
      );
      assert.equal(
        updateTaskSchema.safeParse({ teamId: null }).success,
        false
      );
    });

    it("validates teamId query parameter in taskQuerySchema", () => {
      const result = taskQuerySchema.safeParse({ teamId: "10" });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.teamId, 10);
      }
    });

    it("rejects non-positive teamId in taskQuerySchema", () => {
      assert.equal(taskQuerySchema.safeParse({ teamId: "0" }).success, false);
      assert.equal(taskQuerySchema.safeParse({ teamId: "-5" }).success, false);
      assert.equal(taskQuerySchema.safeParse({ teamId: "abc" }).success, false);
    });
  });

  // ==========================================
  // 2. Creating Team Tasks (POST /api/tasks)
  // ==========================================
  describe("POST /api/tasks — Create Collaborative Team Task", () => {
    it("allows a team member to create a task in their team", async () => {
      const restoreTM = setupMockTeamMember();
      const originalCreate = prisma.task.create;
      let capturedData: any = null;

      try {
        prisma.task.create = (async (args: any) => {
          capturedData = args.data;
          return {
            id: 201,
            title: args.data.title,
            description: args.data.description,
            status: args.data.status,
            priority: args.data.priority,
            dueDate: args.data.dueDate,
            userId: args.data.userId,
            teamId: args.data.teamId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${member1Token}`, // user 3
          },
          body: JSON.stringify({
            title: "Build Login Screen",
            description: "Collaborative team task description",
            priority: TaskPriority.HIGH,
            teamId: 10,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.success, true);
        assert.equal(body.data.task.title, "Build Login Screen");
        assert.equal(body.data.task.teamId, 10);
        assert.equal(body.data.task.userId, 3);

        // Security check: creator derived from JWT, teamId assigned
        assert.equal(capturedData.userId, 3);
        assert.equal(capturedData.teamId, 10);
      } finally {
        restoreTM();
        prisma.task.create = originalCreate;
      }
    });

    it("rejects task creation in a team if requester is NOT a member (HTTP 404)", async () => {
      const restoreTM = setupMockTeamMember();

      try {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${outsiderToken}`, // user 5 (not in Team 10)
          },
          body: JSON.stringify({
            title: "Malicious Task",
            teamId: 10,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Team not found");
      } finally {
        restoreTM();
      }
    });

    it("rejects task creation for nonexistent team (HTTP 404)", async () => {
      const restoreTM = setupMockTeamMember();

      try {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${member1Token}`,
          },
          body: JSON.stringify({
            title: "Task for fake team",
            teamId: 99999,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "Team not found");
      } finally {
        restoreTM();
      }
    });

    it("continues creating personal task with teamId: null when teamId is omitted", async () => {
      const originalCreate = prisma.task.create;
      let capturedData: any = null;

      try {
        prisma.task.create = (async (args: any) => {
          capturedData = args.data;
          return {
            id: 202,
            title: args.data.title,
            description: null,
            status: TaskStatus.TODO,
            priority: TaskPriority.MEDIUM,
            dueDate: null,
            userId: args.data.userId,
            teamId: args.data.teamId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${member1Token}`,
          },
          body: JSON.stringify({
            title: "My Personal Note",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.data.task.teamId, null);
        assert.equal(capturedData.teamId, null);
      } finally {
        prisma.task.create = originalCreate;
      }
    });
  });

  // ==========================================
  // 3. Listing Team Tasks (GET /api/tasks?teamId=...)
  // ==========================================
  describe("GET /api/tasks — List Team Tasks vs Personal Tasks", () => {
    it("returns team tasks when member queries with teamId", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedWhere: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedWhere = args.where;
          return [
            {
              id: 201,
              title: "Team Task 1",
              description: null,
              status: TaskStatus.TODO,
              priority: TaskPriority.HIGH,
              dueDate: null,
              userId: 3,
              teamId: 10,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        }) as any;
        prisma.task.count = (async () => 1) as any;

        const res = await fetch(`${baseUrl}/api/tasks?teamId=10`, {
          headers: { Authorization: `Bearer ${member1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.tasks.length, 1);
        assert.equal(body.data.tasks[0].teamId, 10);

        // Crucial authorization test: DB query filtered strictly by teamId, not userId
        assert.equal(capturedWhere.teamId, 10);
        assert.equal(capturedWhere.userId, undefined);
      } finally {
        restoreTM();
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("rejects team task listing for non-members (HTTP 404)", async () => {
      const restoreTM = setupMockTeamMember();

      try {
        const res = await fetch(`${baseUrl}/api/tasks?teamId=10`, {
          headers: { Authorization: `Bearer ${outsiderToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "Team not found");
      } finally {
        restoreTM();
      }
    });

    it("never includes team tasks in personal listing (teamId: null enforced)", async () => {
      const originalFindMany = prisma.task.findMany;
      const originalCount = prisma.task.count;
      let capturedWhere: any = null;

      try {
        prisma.task.findMany = (async (args: any) => {
          capturedWhere = args.where;
          return [];
        }) as any;
        prisma.task.count = (async () => 0) as any;

        const res = await fetch(`${baseUrl}/api/tasks`, {
          headers: { Authorization: `Bearer ${member1Token}` },
        });

        assert.equal(res.status, 200);
        // Crucial isolation test: personal queries MUST specify teamId: null
        assert.equal(capturedWhere.userId, 3);
        assert.equal(capturedWhere.teamId, null);
      } finally {
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });

    it("applies status, priority, and search filters within team tasks", async () => {
      const restoreTM = setupMockTeamMember();
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
          `${baseUrl}/api/tasks?teamId=10&status=IN_PROGRESS&priority=HIGH&search=deploy`,
          {
            headers: { Authorization: `Bearer ${ownerToken}` },
          }
        );

        assert.equal(res.status, 200);
        assert.equal(capturedWhere.teamId, 10);
        assert.equal(capturedWhere.status, TaskStatus.IN_PROGRESS);
        assert.equal(capturedWhere.priority, TaskPriority.HIGH);
        assert.ok(Array.isArray(capturedWhere.OR));
      } finally {
        restoreTM();
        prisma.task.findMany = originalFindMany;
        prisma.task.count = originalCount;
      }
    });
  });

  // ==========================================
  // 4. Reading a Team Task (GET /api/tasks/:id)
  // ==========================================
  describe("GET /api/tasks/:id — Read Collaborative Team Task", () => {
    it("allows any active team member to read a team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;

      try {
        // Task 300 belongs to Team 10, created by member1 (userId: 3)
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              title: "Shared Team Task",
              description: "Team documentation",
              status: TaskStatus.TODO,
              priority: TaskPriority.MEDIUM,
              dueDate: null,
              userId: 3, // created by member1
              teamId: 10,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          return null;
        }) as any;

        // member2 (userId: 4) reads member1's task
        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          headers: { Authorization: `Bearer ${member2Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.task.id, 300);
        assert.equal(body.data.task.teamId, 10);
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("rejects non-members from reading a team task (HTTP 404)", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              title: "Shared Team Task",
              userId: 3,
              teamId: 10,
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          headers: { Authorization: `Bearer ${outsiderToken}` }, // outsider not in Team 10
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "Team not found");
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
      }
    });
  });

  // ==========================================
  // 5. Updating a Team Task (PATCH /api/tasks/:id)
  // ==========================================
  describe("PATCH /api/tasks/:id — Update Permissions on Team Task", () => {
    it("allows the creator to update their own team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalUpdateMany = prisma.task.updateMany;
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.updateMany = (async (args: any) => {
          if (args.where.id === 300 && args.where.userId === 3) {
            return { count: 1 };
          }
          return { count: 0 };
        }) as any;

        prisma.task.findFirst = (async () => {
          return {
            id: 300,
            title: "Creator Updated Title",
            description: null,
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            dueDate: null,
            userId: 3,
            teamId: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${member1Token}`, // creator
          },
          body: JSON.stringify({
            title: "Creator Updated Title",
            status: TaskStatus.IN_PROGRESS,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.task.title, "Creator Updated Title");
      } finally {
        restoreTM();
        prisma.task.updateMany = originalUpdateMany;
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("allows team OWNER to update another member's team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalUpdateMany = prisma.task.updateMany;
      const originalFindFirst = prisma.task.findFirst;
      const originalUpdate = prisma.task.update;

      try {
        // Owner is user 1, task creator is user 3, so updateMany({ id: 300, userId: 1 }) yields 0
        prisma.task.updateMany = (async () => ({ count: 0 })) as any;

        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3,
              teamId: 10,
            };
          }
          return null;
        }) as any;

        prisma.task.update = (async (args: any) => {
          return {
            id: 300,
            title: args.data.title,
            description: null,
            status: TaskStatus.COMPLETED,
            priority: TaskPriority.MEDIUM,
            dueDate: null,
            userId: 3,
            teamId: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`, // Team OWNER
          },
          body: JSON.stringify({
            title: "Owner Re-prioritized",
            status: TaskStatus.COMPLETED,
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.task.title, "Owner Re-prioritized");
      } finally {
        restoreTM();
        prisma.task.updateMany = originalUpdateMany;
        prisma.task.findFirst = originalFindFirst;
        prisma.task.update = originalUpdate;
      }
    });

    it("allows team ADMIN to update another member's team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalUpdateMany = prisma.task.updateMany;
      const originalFindFirst = prisma.task.findFirst;
      const originalUpdate = prisma.task.update;

      try {
        prisma.task.updateMany = (async () => ({ count: 0 })) as any;

        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3,
              teamId: 10,
            };
          }
          return null;
        }) as any;

        prisma.task.update = (async (args: any) => {
          return {
            id: 300,
            title: "Admin Updated",
            description: null,
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            dueDate: null,
            userId: 3,
            teamId: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`, // Team ADMIN
          },
          body: JSON.stringify({
            title: "Admin Updated",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
      } finally {
        restoreTM();
        prisma.task.updateMany = originalUpdateMany;
        prisma.task.findFirst = originalFindFirst;
        prisma.task.update = originalUpdate;
      }
    });

    it("rejects a regular MEMBER attempting to update another member's team task (HTTP 403)", async () => {
      const restoreTM = setupMockTeamMember();
      const originalUpdateMany = prisma.task.updateMany;
      const originalFindFirst = prisma.task.findFirst;

      try {
        // member2 (userId: 4) attempts to update member1's (userId: 3) task
        prisma.task.updateMany = (async () => ({ count: 0 })) as any;

        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3, // created by member1
              teamId: 10,
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${member2Token}`, // regular MEMBER
          },
          body: JSON.stringify({
            title: "Unauthorized Edit",
          }),
        });

        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.success, false);
        assert.equal(body.message, "You do not have permission to update this task");
      } finally {
        restoreTM();
        prisma.task.updateMany = originalUpdateMany;
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("rejects an update if client attempts to modify teamId or userId (strict Zod schema)", async () => {
      const res = await fetch(`${baseUrl}/api/tasks/300`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          title: "Try moving task",
          teamId: 99,
          userId: 1,
        }),
      });

      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 6. Deleting a Team Task (DELETE /api/tasks/:id)
  // ==========================================
  describe("DELETE /api/tasks/:id — Delete Permissions on Team Task", () => {
    it("allows the creator to delete their own team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;
      const originalDelete = prisma.task.delete;
      let deletedId: number | null = null;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3, // creator is member1
              teamId: 10,
            };
          }
          return null;
        }) as any;

        prisma.task.delete = (async (args: any) => {
          deletedId = args.where.id;
          return { id: 300 };
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${member1Token}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Task deleted successfully");
        assert.equal(deletedId, 300);
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
        prisma.task.delete = originalDelete;
      }
    });

    it("allows team OWNER to delete another member's team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;
      const originalDelete = prisma.task.delete;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3, // member1 created it
              teamId: 10,
            };
          }
          return null;
        }) as any;

        prisma.task.delete = (async () => ({ id: 300 })) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ownerToken}` }, // team OWNER
        });

        assert.equal(res.status, 200);
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
        prisma.task.delete = originalDelete;
      }
    });

    it("allows team ADMIN to delete another member's team task", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;
      const originalDelete = prisma.task.delete;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3,
              teamId: 10,
            };
          }
          return null;
        }) as any;

        prisma.task.delete = (async () => ({ id: 300 })) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` }, // team ADMIN
        });

        assert.equal(res.status, 200);
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
        prisma.task.delete = originalDelete;
      }
    });

    it("rejects regular MEMBER attempting to delete another member's task (HTTP 403)", async () => {
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3, // member1 created it
              teamId: 10,
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${member2Token}` }, // regular MEMBER
        });

        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.success, false);
        assert.equal(body.message, "You do not have permission to delete this task");
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
      }
    });

    it("revokes access for removed members (HTTP 404)", async () => {
      // Outsider (user 5) was removed or never joined
      const restoreTM = setupMockTeamMember();
      const originalFindFirst = prisma.task.findFirst;

      try {
        prisma.task.findFirst = (async (args: any) => {
          if (args.where.id === 300) {
            return {
              id: 300,
              userId: 3,
              teamId: 10,
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/tasks/300`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${outsiderToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "Team not found");
      } finally {
        restoreTM();
        prisma.task.findFirst = originalFindFirst;
      }
    });
  });
});
