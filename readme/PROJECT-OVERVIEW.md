# TaskFlow API — project overview

See the [root README](../README.md) for the landing page, latest verified CI run, technology summary, and deployment-status note.

## Purpose

TaskFlow is an Express REST API for personal task tracking and collaborative team task management. It separates HTTP routing/controllers, validation middleware and Zod schemas, service-layer business rules, and Prisma/PostgreSQL persistence.

## Implemented capabilities

- Register and sign in with email/password, bcrypt password hashing, signed JWTs, and current-user profile lookup.
- CRUD personal tasks and team tasks with status, priority, due date, filtering, case-insensitive search, sorting, and pagination.
- Create and manage teams, list team members, add/remove members, and apply OWNER/ADMIN/MEMBER authorization.
- Validate request bodies, query parameters, and route IDs; return structured validation and centralized error responses.
- Provide Swagger UI and an OpenAPI 3.0.3 document.
- Apply Helmet, configurable exact-origin CORS, API/auth rate limiting, safe request logging, environment checks, and graceful shutdown.
- Maintain a Prisma PostgreSQL schema and two checked-in migrations; CI has applied these migrations to a temporary PostgreSQL database.

## Architecture and code layout

```text
src/
  config/       environment and runtime validation
  controllers/  HTTP handlers
  db/           Prisma client and PostgreSQL adapter
  middleware/   auth, validation, CORS, rate limits, logging, errors
  routes/       auth, task, and team routes
  schemas/      Zod request schemas
  services/     business rules and database operations
  openapi.ts    OpenAPI contract served by Swagger UI
prisma/
  schema.prisma PostgreSQL model
  migrations/   versioned SQL schema changes
tests/          Node test-runner suites
readme/         architecture, operations, API, and portfolio docs
```

## Data model

Prisma models `User`, `Task`, `Team`, and `TeamMember` with enums for global user role, team membership role, task status, and task priority. Personal tasks have a null `teamId`; collaborative tasks refer to a team. A database uniqueness constraint allows a user one membership per team.

## Authorization model

JWT authentication identifies the caller. Personal task operations are scoped to their owner. Team task operations require active team membership; creators can manage their own team tasks, while OWNER/ADMIN can manage other team members' tasks. Team settings and membership changes require OWNER/ADMIN. A regular MEMBER can manage only their own team task. Team resources are hidden behind not-found responses for nonmembers.

## Hosting note

The intended hosting architecture is a Render Node.js service connected to Neon PostgreSQL. The repository confirms Neon-compatible TLS handling and is configured with a Neon database locally, but does not prove which Neon database the production service uses. The Render URL and current production state remain unverified. See [deployment guide](DEPLOYMENT.md).
