/**
 * OpenAPI contract for the TaskFlow API.
 * Keep these schemas and status codes aligned with the Zod validators,
 * controllers, services, and centralized error handler.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Record<string, unknown>) => ({
  "application/json": { schema },
});
const success = (message: string, data?: Record<string, unknown>) => ({
  type: "object",
  required: data ? ["success", "message", "data"] : ["success", "message"],
  properties: {
    success: { type: "boolean", enum: [true] },
    message: { type: "string", example: message },
    ...(data ? { data: { type: "object", required: Object.keys(data), properties: data } } : {}),
  },
});
const errorResponse = (description: string) => ({
  description,
  content: json(ref("Error")),
});
const badRequestResponse = {
  description: "Request validation failed or the JSON payload could not be parsed.",
  content: json({ oneOf: [ref("ValidationError"), ref("Error")] }),
};
const bearer = [{ bearerAuth: [] }];
const pathId = (description: string) => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "integer", minimum: 1 },
});
const taskResponse = success("Task retrieved successfully", { task: ref("Task") });
const teamResponse = success("Team retrieved successfully", { team: ref("TeamDetail") });

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "TaskFlow API",
    version: "1.0.0",
    description:
      "Task management API with JWT authentication, personal tasks, collaborative team tasks, and role-based team management. Dates are ISO 8601 strings. Register and login are public; use the returned JWT with the Authorize button for protected routes.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Health", description: "Service health" },
    { name: "Authentication", description: "Account registration, login, and profile" },
    { name: "Tasks", description: "Personal and team task management" },
    { name: "Teams", description: "Team details and membership management" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"], summary: "Health check", operationId: "getHealth",
        responses: { "200": { description: "API is running", content: json(success("Task Managing API is running")) } },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Authentication"], summary: "Register an account", operationId: "register",
        description: "Creates a user with the default USER role. Email is trimmed and lowercased; password is stored hashed and is never returned.",
        requestBody: { required: true, content: json(ref("RegisterRequest")) },
        responses: {
          "201": { description: "Account created", content: json(success("Account created successfully", { user: ref("UserProfile") })) },
          "400": badRequestResponse,
          "409": errorResponse("An account with this email already exists."),
          "500": errorResponse("Unexpected server error."),
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Authentication"], summary: "Log in", operationId: "login",
        description: "Returns a signed JWT. Supply its token value in Swagger Authorize; the Bearer scheme is applied automatically.",
        requestBody: { required: true, content: json(ref("LoginRequest")) },
        responses: {
          "200": { description: "Login successful", content: json(success("Login successful", { token: { type: "string", description: "JWT access token" }, tokenType: { type: "string", enum: ["Bearer"] }, user: ref("User") })) },
          "400": badRequestResponse,
          "401": errorResponse("Credentials are invalid."),
          "500": errorResponse("Unexpected server error."),
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Authentication"], summary: "Get current user profile", operationId: "getCurrentUser", security: bearer,
        responses: {
          "200": { description: "Profile retrieved", content: json(success("User profile retrieved successfully", { user: ref("UserProfile") })) },
          "401": errorResponse("Missing, malformed, or invalid/expired JWT, or user account no longer exists."),
          "500": errorResponse("Unexpected server error."),
        },
      },
    },
    "/api/tasks": {
      post: {
        tags: ["Tasks"], summary: "Create a task", operationId: "createTask", security: bearer,
        description: "Omit teamId or send null to create a personal task. Supply a teamId to create a task in that team; the authenticated user must be a member. The creator is derived from the JWT.",
        requestBody: { required: true, content: json(ref("CreateTaskRequest")) },
        responses: {
          "201": { description: "Task created", content: json(success("Task created successfully", { task: ref("Task") })) },
          "400": badRequestResponse, "401": errorResponse("Authentication is required."),
          "404": errorResponse("Team does not exist or the caller is not a member."),
          "500": errorResponse("Unexpected server error."),
        },
      },
      get: {
        tags: ["Tasks"], summary: "List tasks", operationId: "listTasks", security: bearer,
        description: "Without teamId, returns only the authenticated user's personal tasks (teamId is null). With teamId, returns that team's tasks after verifying active membership. Search checks title and description case-insensitively. Results are paginated.",
        parameters: [
          { name: "page", in: "query", description: "Page number (default 1).", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", description: "Items per page (1–100, default 10).", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } },
          { name: "status", in: "query", schema: ref("TaskStatus") },
          { name: "priority", in: "query", schema: ref("TaskPriority") },
          { name: "search", in: "query", description: "Case-insensitive substring in title or description.", schema: { type: "string" } },
          { name: "sortBy", in: "query", schema: { type: "string", enum: ["createdAt", "updatedAt", "dueDate", "title", "priority", "status"], default: "createdAt" } },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "teamId", in: "query", description: "Positive team ID to list team tasks; omit for personal tasks.", schema: { type: "integer", minimum: 1 } },
        ],
        responses: {
          "200": { description: "Task page", content: json(success("Tasks retrieved successfully", { tasks: { type: "array", items: ref("Task") }, pagination: ref("Pagination") })) },
          "400": badRequestResponse, "401": errorResponse("Authentication is required."),
          "404": errorResponse("Team does not exist or the caller is not a member."),
          "500": errorResponse("Unexpected server error."),
        },
      },
    },
    "/api/tasks/{id}": {
      parameters: [pathId("Positive integer task ID.")],
      get: {
        tags: ["Tasks"], summary: "Get a task", operationId: "getTask", security: bearer,
        description: "Personal tasks are visible to their owner. Team tasks are visible to active team members.",
        responses: { "200": { description: "Task retrieved", content: json(taskResponse) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "404": errorResponse("Task not found, or caller is not a member of its team."), "500": errorResponse("Unexpected server error.") },
      },
      patch: {
        tags: ["Tasks"], summary: "Update a task", operationId: "updateTask", security: bearer,
        description: "At least one field is required. Personal tasks can be updated by their owner. For team tasks, the creator, OWNER, or ADMIN can update; MEMBER can update only their own task. teamId cannot be changed.",
        requestBody: { required: true, content: json(ref("UpdateTaskRequest")) },
        responses: { "200": { description: "Task updated", content: json(success("Task updated successfully", { task: ref("Task") })) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "403": errorResponse("Caller cannot update another member's team task."), "404": errorResponse("Task not found, or caller is not a member of its team."), "500": errorResponse("Unexpected server error.") },
      },
      delete: {
        tags: ["Tasks"], summary: "Delete a task", operationId: "deleteTask", security: bearer,
        description: "Personal tasks can be deleted by their owner. For team tasks, the creator, OWNER, or ADMIN can delete; MEMBER can delete only their own task.",
        responses: { "200": { description: "Task deleted", content: json(success("Task deleted successfully")) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "403": errorResponse("Caller cannot delete another member's team task."), "404": errorResponse("Task not found, or caller is not a member of its team."), "500": errorResponse("Unexpected server error.") },
      },
    },
    "/api/teams": {
      post: {
        tags: ["Teams"], summary: "Create a team", operationId: "createTeam", security: bearer,
        description: "Creates a team and makes the authenticated user its OWNER.",
        requestBody: { required: true, content: json(ref("CreateTeamRequest")) },
        responses: { "201": { description: "Team created", content: json(success("Team created successfully", { team: ref("TeamSummary") })) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "500": errorResponse("Unexpected server error.") },
      },
      get: {
        tags: ["Teams"], summary: "List my teams", operationId: "listTeams", security: bearer,
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", description: "Items per page (1–100, default 10).", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } },
        ],
        responses: { "200": { description: "Team page", content: json(success("Teams retrieved successfully", { teams: { type: "array", items: ref("TeamSummary") }, pagination: ref("Pagination") })) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "500": errorResponse("Unexpected server error.") },
      },
    },
    "/api/teams/{id}": {
      parameters: [pathId("Positive integer team ID.")],
      get: {
        tags: ["Teams"], summary: "Get team details and members", operationId: "getTeam", security: bearer,
        description: "Only active team members can view team details and the safe member profiles (ID, email, and global role).",
        responses: { "200": { description: "Team details", content: json(teamResponse) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "404": errorResponse("Team not found or caller is not a member."), "500": errorResponse("Unexpected server error.") },
      },
      patch: {
        tags: ["Teams"], summary: "Update team name", operationId: "updateTeam", security: bearer,
        description: "Only OWNER and ADMIN memberships can update a team. At least one accepted field is required.",
        requestBody: { required: true, content: json(ref("UpdateTeamRequest")) },
        responses: { "200": { description: "Team updated", content: json(success("Team updated successfully", { team: ref("TeamUpdated") })) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "403": errorResponse("Only team OWNER or ADMIN can manage this team."), "404": errorResponse("Team not found or caller is not a member."), "500": errorResponse("Unexpected server error.") },
      },
    },
    "/api/teams/{id}/members": {
      parameters: [pathId("Positive integer team ID.")],
      post: {
        tags: ["Teams"], summary: "Add a team member", operationId: "addTeamMember", security: bearer,
        description: "Only OWNER and ADMIN can add an existing user. Provide email or userId; if both are supplied, the email is used to look up the user. The new membership always receives the MEMBER role; callers cannot choose a role.",
        requestBody: { required: true, content: json(ref("AddMemberRequest")) },
        responses: { "201": { description: "Member added", content: json(success("Team member added successfully", { member: ref("TeamMember") })) }, "400": badRequestResponse, "401": errorResponse("Authentication is required."), "403": errorResponse("Only team OWNER or ADMIN can manage membership."), "404": errorResponse("Team or target user not found."), "409": errorResponse("User is already a member of this team."), "500": errorResponse("Unexpected server error.") },
      },
    },
    "/api/teams/{id}/members/{userId}": {
      parameters: [pathId("Positive integer team ID."), { name: "userId", in: "path", required: true, description: "Positive integer user ID to remove.", schema: { type: "integer", minimum: 1 } }],
      delete: {
        tags: ["Teams"], summary: "Remove a team member", operationId: "removeTeamMember", security: bearer,
        description: "Only OWNER and ADMIN can remove members. Only an OWNER can remove another OWNER, and the last OWNER cannot be removed.",
        responses: { "200": { description: "Member removed", content: json(success("Team member removed successfully")) }, "400": { description: "Invalid IDs, malformed JSON, or attempted removal of the only owner.", content: json({ oneOf: [ref("ValidationError"), ref("Error")] }) }, "401": errorResponse("Authentication is required."), "403": errorResponse("Caller lacks manager permissions, or only an OWNER can remove an OWNER."), "404": errorResponse("Team or member not found."), "500": errorResponse("Unexpected server error.") },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Paste the JWT returned by POST /api/auth/login. Do not include the word Bearer." },
    },
    schemas: {
      TaskStatus: { type: "string", enum: ["TODO", "IN_PROGRESS", "COMPLETED"] },
      TaskPriority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      UserRole: { type: "string", enum: ["USER", "ADMIN"] },
      TeamRole: { type: "string", enum: ["OWNER", "ADMIN", "MEMBER"], description: "Team OWNER and ADMIN manage team settings and membership. For team tasks, creator, OWNER, and ADMIN can update/delete; MEMBER can manage their own tasks." },
      RegisterRequest: { type: "object", additionalProperties: false, required: ["email", "password"], properties: { email: { type: "string", format: "email", example: "person@example.com" }, password: { type: "string", minLength: 8, description: "UTF-8 encoded value must not exceed 72 bytes (bcrypt limit).", example: "correct-horse-battery" } } },
      LoginRequest: { type: "object", additionalProperties: false, required: ["email", "password"], properties: { email: { type: "string", format: "email", example: "person@example.com" }, password: { type: "string", minLength: 1, description: "UTF-8 encoded value must not exceed 72 bytes.", example: "correct-horse-battery" } } },
      User: { type: "object", required: ["id", "email", "role"], properties: { id: { type: "integer", example: 12 }, email: { type: "string", format: "email", example: "person@example.com" }, role: ref("UserRole") } },
      UserProfile: { allOf: [ref("User"), { type: "object", required: ["createdAt"], properties: { createdAt: { type: "string", format: "date-time" } } }] },
      RegisterResponse: success("Account created successfully", { user: ref("UserProfile") }),
      Task: { type: "object", required: ["id", "title", "description", "status", "priority", "dueDate", "userId", "teamId", "createdAt", "updatedAt"], properties: { id: { type: "integer" }, title: { type: "string", maxLength: 255 }, description: { type: "string", nullable: true, maxLength: 5000 }, status: ref("TaskStatus"), priority: ref("TaskPriority"), dueDate: { type: "string", format: "date-time", nullable: true }, userId: { type: "integer", description: "User who created the task." }, teamId: { type: "integer", nullable: true, description: "Null for personal tasks; otherwise the associated team." }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
      CreateTaskRequest: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 255, example: "Prepare release" }, description: { type: "string", maxLength: 5000, nullable: true }, status: ref("TaskStatus"), priority: ref("TaskPriority"), dueDate: { type: "string", format: "date-time", nullable: true }, teamId: { type: "integer", minimum: 1, nullable: true, description: "Omit or null for a personal task; a positive team ID creates a team task if the caller is a member." } } },
      UpdateTaskRequest: { type: "object", additionalProperties: false, minProperties: 1, properties: { title: { type: "string", minLength: 1, maxLength: 255 }, description: { type: "string", maxLength: 5000, nullable: true }, status: ref("TaskStatus"), priority: ref("TaskPriority"), dueDate: { type: "string", format: "date-time", nullable: true } } },
      Pagination: { type: "object", required: ["page", "limit", "total", "totalPages"], properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
      CreateTeamRequest: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 100, example: "Engineering" } } },
      UpdateTeamRequest: { type: "object", additionalProperties: false, minProperties: 1, properties: { name: { type: "string", minLength: 1, maxLength: 100 } } },
      TeamSummary: { type: "object", required: ["id", "name", "createdAt", "updatedAt", "myRole", "memberCount"], properties: { id: { type: "integer" }, name: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, myRole: ref("TeamRole"), memberCount: { type: "integer" } } },
      TeamUpdated: { type: "object", required: ["id", "name", "updatedAt"], properties: { id: { type: "integer" }, name: { type: "string" }, updatedAt: { type: "string", format: "date-time" } } },
      TeamMember: { type: "object", required: ["id", "teamId", "userId", "role", "createdAt", "user"], properties: { id: { type: "integer" }, teamId: { type: "integer" }, userId: { type: "integer" }, role: ref("TeamRole"), createdAt: { type: "string", format: "date-time" }, user: { type: "object", required: ["id", "email", "role"], properties: { id: { type: "integer" }, email: { type: "string", format: "email" }, role: ref("UserRole") } } } },
      TeamDetail: { type: "object", required: ["id", "name", "createdAt", "updatedAt", "myRole", "members"], properties: { id: { type: "integer" }, name: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, myRole: ref("TeamRole"), members: { type: "array", items: ref("TeamMember") } } },
      AddMemberRequest: { type: "object", additionalProperties: false, description: "At least one of email or userId is required; if both are supplied, both must identify the same existing user.", properties: { email: { type: "string", format: "email", example: "new.member@example.com" }, userId: { type: "integer", minimum: 1 } }, anyOf: [{ required: ["email"] }, { required: ["userId"] }] },
      Error: { type: "object", required: ["success", "message"], properties: { success: { type: "boolean", enum: [false] }, message: { type: "string", example: "Resource not found" } } },
      ValidationError: { type: "object", required: ["success", "message", "errors"], properties: { success: { type: "boolean", enum: [false] }, message: { type: "string", enum: ["Validation failed"] }, errors: { type: "array", items: { type: "object", required: ["field", "message"], properties: { field: { type: "string", description: "Invalid field or parameter." }, message: { type: "string" } } } } } },
    },
  },
} as const;
