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
  createTeamSchema,
  updateTeamSchema,
  teamQuerySchema,
  teamIdParamSchema,
  addMemberSchema,
  teamMemberParamSchema,
} from "../src/schemas/team.schema";
import { TeamRole, Role } from "@prisma/client";

describe("Team Management Feature Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  const testSecret = process.env.JWT_SECRET || "test-jwt-secret-key-min-32-characters-taskflow";

  const createAuthToken = (
    userId: number = 1,
    email: string = "owner@example.com",
    role: Role = Role.USER
  ) => {
    return jwt.sign(
      { sub: String(userId), email, role },
      testSecret,
      { expiresIn: "1h" }
    );
  };

  const ownerToken = createAuthToken(1, "owner@example.com");
  const memberToken = createAuthToken(2, "member@example.com");
  const outsiderToken = createAuthToken(3, "outsider@example.com");
  const adminToken = createAuthToken(4, "teamadmin@example.com");

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
  describe("Team Zod Schema Validation Unit Tests", () => {
    describe("createTeamSchema", () => {
      it("validates and trims a valid team name", () => {
        const result = createTeamSchema.safeParse({
          name: "  Engineering Team  ",
        });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.name, "Engineering Team");
        }
      });

      it("rejects empty or whitespace-only name", () => {
        assert.equal(createTeamSchema.safeParse({ name: "" }).success, false);
        assert.equal(createTeamSchema.safeParse({ name: "   " }).success, false);
      });

      it("rejects name exceeding 100 characters", () => {
        const result = createTeamSchema.safeParse({ name: "a".repeat(101) });
        assert.equal(result.success, false);
      });

      it("rejects unknown extra fields (strict mode)", () => {
        const result = createTeamSchema.safeParse({
          name: "Team",
          ownerId: 999,
        });
        assert.equal(result.success, false);
      });
    });

    describe("updateTeamSchema", () => {
      it("validates partial name update", () => {
        const result = updateTeamSchema.safeParse({ name: "New Name" });
        assert.equal(result.success, true);
      });

      it("rejects empty update body", () => {
        const result = updateTeamSchema.safeParse({});
        assert.equal(result.success, false);
      });

      it("rejects unknown fields", () => {
        const result = updateTeamSchema.safeParse({ ownerId: 5 });
        assert.equal(result.success, false);
      });
    });

    describe("teamQuerySchema", () => {
      it("applies default page=1, limit=10", () => {
        const result = teamQuerySchema.safeParse({});
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.page, 1);
          assert.equal(result.data.limit, 10);
        }
      });

      it("coerces string page and limit", () => {
        const result = teamQuerySchema.safeParse({ page: "2", limit: "20" });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.page, 2);
          assert.equal(result.data.limit, 20);
        }
      });

      it("rejects page < 1 and limit > 100", () => {
        assert.equal(teamQuerySchema.safeParse({ page: 0 }).success, false);
        assert.equal(teamQuerySchema.safeParse({ limit: 101 }).success, false);
      });
    });

    describe("teamIdParamSchema", () => {
      it("coerces and validates positive integer", () => {
        const result = teamIdParamSchema.safeParse({ id: "42" });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.id, 42);
        }
      });

      it("rejects invalid values", () => {
        assert.equal(teamIdParamSchema.safeParse({ id: "0" }).success, false);
        assert.equal(teamIdParamSchema.safeParse({ id: "-5" }).success, false);
        assert.equal(teamIdParamSchema.safeParse({ id: "abc" }).success, false);
      });
    });

    describe("addMemberSchema", () => {
      it("accepts email to add a member", () => {
        const result = addMemberSchema.safeParse({
          email: "  User@Example.COM  ",
        });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.email, "user@example.com");
        }
      });

      it("accepts userId to add a member", () => {
        const result = addMemberSchema.safeParse({ userId: 5 });
        assert.equal(result.success, true);
      });

      it("rejects request with neither email nor userId", () => {
        const result = addMemberSchema.safeParse({});
        assert.equal(result.success, false);
      });

      it("rejects unknown fields (e.g. role injection)", () => {
        const result = addMemberSchema.safeParse({
          email: "user@example.com",
          role: "OWNER",
        });
        assert.equal(result.success, false);
      });
    });

    describe("teamMemberParamSchema", () => {
      it("validates both id and userId as positive integers", () => {
        const result = teamMemberParamSchema.safeParse({ id: "1", userId: "2" });
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.data.id, 1);
          assert.equal(result.data.userId, 2);
        }
      });

      it("rejects invalid id or userId", () => {
        assert.equal(teamMemberParamSchema.safeParse({ id: "1", userId: "abc" }).success, false);
        assert.equal(teamMemberParamSchema.safeParse({ id: "-1", userId: "2" }).success, false);
      });
    });
  });

  // ==========================================
  // 2. Authentication Protection
  // ==========================================
  describe("Authentication Requirements on all /api/teams endpoints", () => {
    it("POST /api/teams returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.message, "Authentication required");
    });

    it("GET /api/teams returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams`);
      assert.equal(res.status, 401);
    });

    it("GET /api/teams/:id returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams/1`);
      assert.equal(res.status, 401);
    });

    it("PATCH /api/teams/:id returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });
      assert.equal(res.status, 401);
    });

    it("POST /api/teams/:id/members returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams/1/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@test.com" }),
      });
      assert.equal(res.status, 401);
    });

    it("DELETE /api/teams/:id/members/:userId returns HTTP 401 without token", async () => {
      const res = await fetch(`${baseUrl}/api/teams/1/members/2`, {
        method: "DELETE",
      });
      assert.equal(res.status, 401);
    });
  });

  // ==========================================
  // 3. POST /api/teams (Create Team)
  // ==========================================
  describe("POST /api/teams — Create Team", () => {
    it("creates a team and records the creator as OWNER atomically", async () => {
      const originalTransaction = prisma.$transaction;
      let transactionCalled = false;
      let capturedTeamData: any = null;
      let capturedMemberData: any = null;

      try {
        prisma.$transaction = (async (fn: any) => {
          transactionCalled = true;
          const mockTx = {
            team: {
              create: async (args: any) => {
                capturedTeamData = args.data;
                return {
                  id: 10,
                  name: args.data.name,
                  createdAt: new Date("2026-10-14T10:00:00Z"),
                  updatedAt: new Date("2026-10-14T10:00:00Z"),
                };
              },
            },
            teamMember: {
              create: async (args: any) => {
                capturedMemberData = args.data;
                return {
                  id: 100,
                  teamId: 10,
                  userId: args.data.userId,
                  role: args.data.role,
                  createdAt: new Date("2026-10-14T10:00:00Z"),
                };
              },
            },
          };
          return fn(mockTx);
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ name: "  Engineering Team  " }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.success, true);
        assert.equal(body.message, "Team created successfully");
        assert.equal(body.data.team.id, 10);
        assert.equal(body.data.team.name, "Engineering Team");
        assert.equal(body.data.team.myRole, TeamRole.OWNER);
        assert.equal(body.data.team.memberCount, 1);

        // Verify atomicity and ownership assignment
        assert.equal(transactionCalled, true);
        assert.equal(capturedTeamData.name, "Engineering Team");
        assert.equal(capturedMemberData.userId, 1);
        assert.equal(capturedMemberData.role, TeamRole.OWNER);
      } finally {
        prisma.$transaction = originalTransaction;
      }
    });

    it("rejects empty team name (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/teams`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ name: "   " }),
      });

      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.success, false);
      assert.equal(body.message, "Validation failed");
    });

    it("rejects extra fields like ownerId injection (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/teams`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ name: "Team", ownerId: 999 }),
      });
      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 4. GET /api/teams (List Teams)
  // ==========================================
  describe("GET /api/teams — List User's Teams", () => {
    it("returns paginated teams the user belongs to", async () => {
      const originalFindMany = prisma.team.findMany;
      const originalCount = prisma.team.count;
      let capturedWhere: any = null;

      try {
        prisma.team.findMany = (async (args: any) => {
          capturedWhere = args.where;
          return [
            {
              id: 10,
              name: "Engineering",
              createdAt: new Date("2026-10-14T10:00:00Z"),
              updatedAt: new Date("2026-10-14T10:00:00Z"),
              _count: { memberships: 3 },
              memberships: [{ role: TeamRole.OWNER }],
            },
          ];
        }) as any;
        prisma.team.count = (async () => 1) as any;

        const res = await fetch(`${baseUrl}/api/teams`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Teams retrieved successfully");
        assert.equal(body.data.teams.length, 1);
        assert.equal(body.data.teams[0].myRole, TeamRole.OWNER);
        assert.equal(body.data.teams[0].memberCount, 3);
        assert.equal(body.data.pagination.page, 1);
        assert.equal(body.data.pagination.limit, 10);
        assert.equal(body.data.pagination.total, 1);
        assert.equal(body.data.pagination.totalPages, 1);

        // Must filter by membership at database level
        assert.ok(capturedWhere.memberships);
        assert.equal(capturedWhere.memberships.some.userId, 1);
      } finally {
        prisma.team.findMany = originalFindMany;
        prisma.team.count = originalCount;
      }
    });

    it("returns empty list for user who belongs to no teams", async () => {
      const originalFindMany = prisma.team.findMany;
      const originalCount = prisma.team.count;

      try {
        prisma.team.findMany = (async () => []) as any;
        prisma.team.count = (async () => 0) as any;

        const res = await fetch(`${baseUrl}/api/teams`, {
          headers: { Authorization: `Bearer ${outsiderToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.data.teams.length, 0);
        assert.equal(body.data.pagination.total, 0);
        assert.equal(body.data.pagination.totalPages, 0);
      } finally {
        prisma.team.findMany = originalFindMany;
        prisma.team.count = originalCount;
      }
    });

    it("respects custom pagination parameters", async () => {
      const originalFindMany = prisma.team.findMany;
      const originalCount = prisma.team.count;
      let capturedArgs: any = null;

      try {
        prisma.team.findMany = (async (args: any) => {
          capturedArgs = args;
          return [];
        }) as any;
        prisma.team.count = (async () => 25) as any;

        const res = await fetch(`${baseUrl}/api/teams?page=3&limit=5`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(capturedArgs.skip, 10);
        assert.equal(capturedArgs.take, 5);
        assert.equal(body.data.pagination.page, 3);
        assert.equal(body.data.pagination.limit, 5);
        assert.equal(body.data.pagination.total, 25);
        assert.equal(body.data.pagination.totalPages, 5);
      } finally {
        prisma.team.findMany = originalFindMany;
        prisma.team.count = originalCount;
      }
    });

    it("rejects invalid pagination (page=0, limit=101)", async () => {
      const res1 = await fetch(`${baseUrl}/api/teams?page=0`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/teams?limit=101`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res2.status, 400);
    });
  });

  // ==========================================
  // 5. GET /api/teams/:id (Team Details)
  // ==========================================
  describe("GET /api/teams/:id — Retrieve Team Details", () => {
    it("returns team details with members for an authorized member", async () => {
      const originalFindFirst = prisma.team.findFirst;

      try {
        prisma.team.findFirst = (async (args: any) => {
          // Verify membership filter is applied
          if (args.where.memberships?.some?.userId === 1 && args.where.id === 10) {
            return {
              id: 10,
              name: "Engineering",
              createdAt: new Date("2026-10-14T10:00:00Z"),
              updatedAt: new Date("2026-10-14T10:00:00Z"),
              memberships: [
                {
                  id: 100,
                  teamId: 10,
                  userId: 1,
                  role: TeamRole.OWNER,
                  createdAt: new Date("2026-10-14T10:00:00Z"),
                  user: { id: 1, email: "owner@example.com", role: Role.USER },
                },
                {
                  id: 101,
                  teamId: 10,
                  userId: 2,
                  role: TeamRole.MEMBER,
                  createdAt: new Date("2026-10-14T10:01:00Z"),
                  user: { id: 2, email: "member@example.com", role: Role.USER },
                },
              ],
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.team.id, 10);
        assert.equal(body.data.team.name, "Engineering");
        assert.equal(body.data.team.myRole, TeamRole.OWNER);
        assert.equal(body.data.team.members.length, 2);

        // Verify no password hashes are exposed
        const responseText = JSON.stringify(body);
        assert.equal(responseText.includes("password"), false);
      } finally {
        prisma.team.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 404 for non-member to prevent team enumeration", async () => {
      const originalFindFirst = prisma.team.findFirst;

      try {
        prisma.team.findFirst = (async (args: any) => {
          // Outsider (userId: 3) is not in team 10
          if (args.where.memberships?.some?.userId === 3) {
            return null;
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          headers: { Authorization: `Bearer ${outsiderToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Team not found");
      } finally {
        prisma.team.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 404 for nonexistent team", async () => {
      const originalFindFirst = prisma.team.findFirst;

      try {
        prisma.team.findFirst = (async () => null) as any;

        const res = await fetch(`${baseUrl}/api/teams/99999`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.success, false);
        assert.equal(body.message, "Team not found");
      } finally {
        prisma.team.findFirst = originalFindFirst;
      }
    });

    it("returns HTTP 400 for invalid team ID parameter", async () => {
      const res = await fetch(`${baseUrl}/api/teams/invalid-id`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 6. PATCH /api/teams/:id (Update Team)
  // ==========================================
  describe("PATCH /api/teams/:id — Update Team Details", () => {
    it("allows team OWNER to update name", async () => {
      const originalFindUnique = prisma.teamMember.findUnique;
      const originalUpdate = prisma.team.update;

      try {
        prisma.teamMember.findUnique = (async (args: any) => {
          if (args.where.userId_teamId?.userId === 1 && args.where.userId_teamId?.teamId === 10) {
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          return null;
        }) as any;

        prisma.team.update = (async (args: any) => {
          return {
            id: 10,
            name: args.data.name,
            updatedAt: new Date("2026-10-14T11:00:00Z"),
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ name: "Renamed Engineering" }),
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Team updated successfully");
        assert.equal(body.data.team.name, "Renamed Engineering");
      } finally {
        prisma.teamMember.findUnique = originalFindUnique;
        prisma.team.update = originalUpdate;
      }
    });

    it("returns HTTP 403 when ordinary MEMBER tries to update team", async () => {
      const originalFindUnique = prisma.teamMember.findUnique;

      try {
        prisma.teamMember.findUnique = (async (args: any) => {
          if (args.where.userId_teamId?.userId === 2 && args.where.userId_teamId?.teamId === 10) {
            return { id: 101, userId: 2, teamId: 10, role: TeamRole.MEMBER };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${memberToken}`,
          },
          body: JSON.stringify({ name: "Hacked Name" }),
        });

        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.success, false);
        assert.equal(body.message, "You do not have permission to manage this team");
      } finally {
        prisma.teamMember.findUnique = originalFindUnique;
      }
    });

    it("returns HTTP 404 when non-member tries to update (prevents enumeration)", async () => {
      const originalFindUnique = prisma.teamMember.findUnique;

      try {
        prisma.teamMember.findUnique = (async () => null) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${outsiderToken}`,
          },
          body: JSON.stringify({ name: "Attack" }),
        });

        assert.equal(res.status, 404);
      } finally {
        prisma.teamMember.findUnique = originalFindUnique;
      }
    });

    it("rejects empty update body (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/teams/10`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 7. POST /api/teams/:id/members (Add Member)
  // ==========================================
  describe("POST /api/teams/:id/members — Add Team Member", () => {
    it("allows OWNER to add an existing user by email", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;
      const originalUserFindUnique = prisma.user.findUnique;
      const originalTMCreate = prisma.teamMember.create;

      try {
        // assertTeamManager: owner is OWNER on team 10
        let tmFindUniqueCallCount = 0;
        prisma.teamMember.findUnique = (async (args: any) => {
          tmFindUniqueCallCount++;
          // First call: assertTeamManager for caller
          if (tmFindUniqueCallCount === 1) {
            if (args.where.userId_teamId?.userId === 1 && args.where.userId_teamId?.teamId === 10) {
              return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
            }
          }
          // Second call: duplicate check for target user
          if (tmFindUniqueCallCount === 2) {
            return null; // not yet a member
          }
          return null;
        }) as any;

        prisma.user.findUnique = (async (args: any) => {
          if (args.where.email === "newuser@example.com") {
            return { id: 5, email: "newuser@example.com", role: Role.USER };
          }
          return null;
        }) as any;

        prisma.teamMember.create = (async (args: any) => {
          return {
            id: 200,
            teamId: args.data.teamId,
            userId: args.data.userId,
            role: args.data.role,
            createdAt: new Date("2026-10-14T12:00:00Z"),
            user: { id: 5, email: "newuser@example.com", role: Role.USER },
          };
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ email: "newuser@example.com" }),
        });

        const body = await res.json();
        assert.equal(res.status, 201);
        assert.equal(body.success, true);
        assert.equal(body.message, "Team member added successfully");
        assert.equal(body.data.member.userId, 5);
        assert.equal(body.data.member.role, TeamRole.MEMBER);
        assert.equal(body.data.member.user.email, "newuser@example.com");

        // Verify no password hash exposed
        assert.equal(JSON.stringify(body).includes("password"), false);
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
        prisma.user.findUnique = originalUserFindUnique;
        prisma.teamMember.create = originalTMCreate;
      }
    });

    it("returns HTTP 404 when target user does not exist", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;
      const originalUserFindUnique = prisma.user.findUnique;

      try {
        prisma.teamMember.findUnique = (async (args: any) => {
          if (args.where.userId_teamId?.userId === 1) {
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          return null;
        }) as any;

        prisma.user.findUnique = (async () => null) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ email: "ghost@nowhere.com" }),
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "User not found");
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
        prisma.user.findUnique = originalUserFindUnique;
      }
    });

    it("returns HTTP 409 when user is already a member (duplicate membership)", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;
      const originalUserFindUnique = prisma.user.findUnique;

      try {
        let tmFindUniqueCallCount = 0;
        prisma.teamMember.findUnique = (async (args: any) => {
          tmFindUniqueCallCount++;
          if (tmFindUniqueCallCount === 1) {
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          // Second call: existing membership found
          if (tmFindUniqueCallCount === 2) {
            return { id: 101, userId: 5, teamId: 10, role: TeamRole.MEMBER };
          }
          return null;
        }) as any;

        prisma.user.findUnique = (async () => {
          return { id: 5, email: "existing@example.com", role: Role.USER };
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ email: "existing@example.com" }),
        });

        const body = await res.json();
        assert.equal(res.status, 409);
        assert.equal(body.success, false);
        assert.equal(body.message, "User is already a member of this team");
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
        prisma.user.findUnique = originalUserFindUnique;
      }
    });

    it("returns HTTP 403 when ordinary MEMBER tries to add another member", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;

      try {
        prisma.teamMember.findUnique = (async (args: any) => {
          if (args.where.userId_teamId?.userId === 2) {
            return { id: 101, userId: 2, teamId: 10, role: TeamRole.MEMBER };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${memberToken}`,
          },
          body: JSON.stringify({ email: "newuser@example.com" }),
        });

        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.success, false);
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
      }
    });

    it("does not allow caller to supply a role in the request body (strict schema)", async () => {
      const res = await fetch(`${baseUrl}/api/teams/10/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ email: "user@test.com", role: "OWNER" }),
      });

      assert.equal(res.status, 400);
    });

    it("rejects request with neither email nor userId (HTTP 400)", async () => {
      const res = await fetch(`${baseUrl}/api/teams/10/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
    });
  });

  // ==========================================
  // 8. DELETE /api/teams/:id/members/:userId (Remove Member)
  // ==========================================
  describe("DELETE /api/teams/:id/members/:userId — Remove Team Member", () => {
    it("allows OWNER to remove an eligible MEMBER", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;
      const originalTMDelete = prisma.teamMember.delete;
      let deletedId: number | null = null;

      try {
        let tmFindUniqueCallCount = 0;
        prisma.teamMember.findUnique = (async (args: any) => {
          tmFindUniqueCallCount++;
          // First call: assertTeamManager for caller (userId: 1)
          if (tmFindUniqueCallCount === 1) {
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          // Second call: target membership (userId: 2)
          if (tmFindUniqueCallCount === 2) {
            return { id: 101, userId: 2, teamId: 10, role: TeamRole.MEMBER };
          }
          return null;
        }) as any;

        prisma.teamMember.delete = (async (args: any) => {
          deletedId = args.where.id;
          return { id: args.where.id };
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members/2`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.message, "Team member removed successfully");
        assert.equal(deletedId, 101);
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
        prisma.teamMember.delete = originalTMDelete;
      }
    });

    it("prevents removal of the last (only) owner", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;
      const originalTMCount = prisma.teamMember.count;

      try {
        let tmFindUniqueCallCount = 0;
        prisma.teamMember.findUnique = (async (args: any) => {
          tmFindUniqueCallCount++;
          if (tmFindUniqueCallCount === 1) {
            // Caller is the only OWNER
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          if (tmFindUniqueCallCount === 2) {
            // Target is also the owner (self-removal attempt)
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          return null;
        }) as any;

        prisma.teamMember.count = (async () => 1) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members/1`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.success, false);
        assert.ok(body.message.includes("Cannot remove the only owner"));
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
        prisma.teamMember.count = originalTMCount;
      }
    });

    it("returns HTTP 403 when ordinary MEMBER tries to remove another member", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;

      try {
        prisma.teamMember.findUnique = (async (args: any) => {
          if (args.where.userId_teamId?.userId === 2) {
            return { id: 101, userId: 2, teamId: 10, role: TeamRole.MEMBER };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members/5`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${memberToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.success, false);
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
      }
    });

    it("returns HTTP 404 when target membership does not exist", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;

      try {
        let tmFindUniqueCallCount = 0;
        prisma.teamMember.findUnique = (async (args: any) => {
          tmFindUniqueCallCount++;
          if (tmFindUniqueCallCount === 1) {
            return { id: 100, userId: 1, teamId: 10, role: TeamRole.OWNER };
          }
          // Target not found
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members/999`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 404);
        assert.equal(body.message, "Team member not found");
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
      }
    });

    it("returns HTTP 404 when non-member tries to remove (prevents enumeration)", async () => {
      const originalTMFindUnique = prisma.teamMember.findUnique;

      try {
        prisma.teamMember.findUnique = (async () => null) as any;

        const res = await fetch(`${baseUrl}/api/teams/10/members/2`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${outsiderToken}` },
        });

        assert.equal(res.status, 404);
      } finally {
        prisma.teamMember.findUnique = originalTMFindUnique;
      }
    });

    it("returns HTTP 400 for invalid team or user ID parameters", async () => {
      const res1 = await fetch(`${baseUrl}/api/teams/abc/members/2`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/teams/10/members/-1`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(res2.status, 400);
    });
  });

  // ==========================================
  // 9. Password hash and private field safety
  // ==========================================
  describe("Safety: No password hashes or private fields exposed", () => {
    it("team details response never contains password field", async () => {
      const originalFindFirst = prisma.team.findFirst;

      try {
        prisma.team.findFirst = (async (args: any) => {
          if (args.where.memberships?.some?.userId === 1) {
            return {
              id: 10,
              name: "Safe Team",
              createdAt: new Date(),
              updatedAt: new Date(),
              memberships: [
                {
                  id: 100,
                  teamId: 10,
                  userId: 1,
                  role: TeamRole.OWNER,
                  createdAt: new Date(),
                  user: { id: 1, email: "owner@example.com", role: Role.USER },
                },
              ],
            };
          }
          return null;
        }) as any;

        const res = await fetch(`${baseUrl}/api/teams/10`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });

        const body = await res.json();
        assert.equal(res.status, 200);

        const text = JSON.stringify(body);
        assert.equal(text.includes("password"), false);
        assert.equal(text.includes("hash"), false);
        assert.equal(text.includes("secret"), false);
      } finally {
        prisma.team.findFirst = originalFindFirst;
      }
    });
  });
});
