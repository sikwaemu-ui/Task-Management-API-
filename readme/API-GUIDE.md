# API guide

See the [root README](../README.md) for project and CI status. Base path: `/api`. The interactive contract at `/api-docs` is the source for request/response schemas and status codes.

## Routes

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Liveness check |
| POST | `/api/auth/register` | Public | Create an account |
| POST | `/api/auth/login` | Public | Sign in and receive a JWT |
| GET | `/api/auth/me` | JWT | Read the current user profile |
| POST | `/api/tasks` | JWT | Create a personal task or a task in a team |
| GET | `/api/tasks` | JWT | List personal or team tasks with filters and pagination |
| GET | `/api/tasks/{id}` | JWT | Read an authorized task |
| PATCH | `/api/tasks/{id}` | JWT | Update an authorized task |
| DELETE | `/api/tasks/{id}` | JWT | Delete an authorized task |
| POST | `/api/teams` | JWT | Create a team (creator becomes OWNER) |
| GET | `/api/teams` | JWT | List teams the caller belongs to |
| GET | `/api/teams/{id}` | JWT | Read team details and member profiles |
| PATCH | `/api/teams/{id}` | Team OWNER/ADMIN | Rename a team |
| POST | `/api/teams/{id}/members` | Team OWNER/ADMIN | Add an existing user as MEMBER |
| DELETE | `/api/teams/{id}/members/{userId}` | Team OWNER/ADMIN | Remove a member, subject to owner safeguards |

## Common behavior

- Protected routes use `Authorization: Bearer <JWT>`.
- Validation errors return HTTP 400 with field-level details.
- Task status values: `TODO`, `IN_PROGRESS`, `COMPLETED`.
- Task priority values: `LOW`, `MEDIUM`, `HIGH`.
- Task list query parameters include `page`, `limit`, `status`, `priority`, `search`, `sortBy`, `sortOrder`, and `teamId`.
- Pagination defaults to page 1 and limit 10; `limit` supports 1–100.
- Dates use ISO 8601 strings.
- The API and authentication routes have configurable in-memory rate limits. Requests from origins outside configured CORS origins are rejected.
- Team OWNER and ADMIN can manage teams and memberships. Only an OWNER can remove another OWNER, and the final OWNER cannot be removed.
- Team members can read team tasks. Creators can manage their own team tasks; OWNER/ADMIN can also manage others' tasks. A regular MEMBER cannot edit or delete another member's task.
- The health endpoint is public and mounted before the general API rate limiter.

After starting the app, open `http://localhost:5000/api-docs` for exact payload examples and response schemas. For local setup use [RUNNING-LOCALLY.md](RUNNING-LOCALLY.md); for hosting status use [DEPLOYMENT.md](DEPLOYMENT.md).
