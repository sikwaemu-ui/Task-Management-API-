# Render and Neon deployment guide

## Hosting architecture

The project uses a Render web service for the Express API and Neon for managed PostgreSQL. Render runs the Node.js process; Prisma 7 connects to Neon through the `pg` pool and `@prisma/adapter-pg`. The code enables TLS when `DATABASE_URL` contains `sslmode=require` or its hostname contains `neon.tech`.

The Neon host currently present in the local, ignored `.env` confirms that this checkout has a Neon connection configured. The credential and complete connection string are intentionally withheld from documentation. This does not verify that the production Render service uses the same Neon database.

## Verified configuration versus provider-only settings

Verified in this repository:

- `npm run build` compiles TypeScript into `dist/`.
- `npm start` runs `node dist/server.js`.
- `PORT` defaults to `5000`; the server binds to `0.0.0.0` and uses the configured port.
- The health route is `GET /api/health` and returns HTTP 200 JSON when the server is running.
- `prisma.config.ts` points to `prisma/schema.prisma` and uses `DATABASE_URL`.
- The repository has two checked-in migrations, and CI successfully applies them to a temporary database using `npx prisma migrate deploy`.
- CI tests Node.js 22. `package.json` does not pin Node through an `engines` field; set the Render runtime to Node.js 22 to match CI.

Not verifiable from repository files or the public GitHub deployment API:

- The production Render URL, service name, region, and current health.
- The connected GitHub repository/branch, auto-deploy setting, and latest Render deployment logs.
- Render's actual build/start/pre-deploy commands and Node runtime setting.
- Whether/when migrations have been applied to the production Neon database.

No Render service manifest or GitHub deployment record is checked in. Do not treat a successful GitHub Actions run as evidence that Render deployed the same commit or that production is healthy.

## Render service commands

These are the commands supported by the current package and CI setup; compare them with the live Render service settings before calling them the deployed configuration:

| Setting | Supported value |
| --- | --- |
| Runtime | Node.js 22 (matches CI; not pinned in `package.json`) |
| Build command | `npm ci && npx prisma generate && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Migration command | `npx prisma migrate deploy` |

Configure migrations as a controlled pre-deploy/release step that completes before the new application version receives traffic. Do not run production migrations from the TypeScript build step: builds can be retried, and build environments should not mutate production data. Review migrations for backward compatibility and take/verify a Neon backup before risky schema changes. The current CI workflow runs migrations only against its temporary PostgreSQL service; it does not migrate Neon.

The process reads Render's assigned `PORT` and listens on `0.0.0.0`, which supports a Render web service. `GET /api/health` is deliberately mounted before the general `/api` rate limiter so health checks remain available when the API quota is exhausted. Confirm the service's configured health-check path matches this route.

## Environment variables

Set secrets in the Render service environment, not in source control. `.env.example` contains local placeholders only.

| Variable | Requirement and behavior |
| --- | --- |
| `NODE_ENV` | Set to `production` for production-safe error behavior and production CORS defaults. |
| `PORT` | Supplied by Render; defaults to `5000` locally. |
| `DATABASE_URL` | Required Neon PostgreSQL URL. Use the connection string intended for the app/runtime, preserve required SSL parameters, and never publish it. |
| `JWT_SECRET` | Required random secret with at least 32 non-whitespace characters. Keep separate from other environments. |
| `JWT_EXPIRES_IN` | Optional positive duration such as `1d`; defaults to `1d`. |
| `CORS_ORIGINS` | Comma-separated exact browser origins. Production defaults to no browser origins; configure the real frontend origin(s) without paths or wildcards. |
| `TRUST_PROXY_HOPS` | Non-negative integer, default `0`. Configure only after verifying the proxy chain; never use `true`. |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | Optional auth limiter window and request count; defaults are 900000 ms and 10. |
| `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` | Optional general API limiter window and request count; defaults are 900000 ms and 300. |
| `SHUTDOWN_TIMEOUT_MS` | Optional per-phase graceful shutdown timeout; default `10000`, maximum `60000`. |

The default rate-limit store is in memory and is per process. Multiple Render instances do not share counts; use a shared store before scaling if a global limit is required.

## How changes reach production

`.github/workflows/ci.yml` is continuous integration only. It has no Render deploy action, deploy token, or deployment job. If the Render service is connected to this GitHub repository, Render's own Git integration may deploy a selected branch after a push; that connection and branch selection are dashboard settings and are not represented in this repo. Verify the connected repository, production branch, auto-deploy mode, and deployed commit in Render before describing the delivery path as automatic.

Recommended release sequence:

1. Push or merge the change to the branch protected by successful CI.
2. Confirm the CI run succeeds for the exact commit.
3. Confirm the Render service deploys that same commit (or initiate a manual deploy if auto-deploy is off).
4. Review build and deploy logs; verify the migration step completed if the change includes schema migrations.
5. Request `GET https://<verified-render-host>/api/health` and confirm HTTP 200 with `success: true`.
6. For database-dependent confidence, exercise a safe read or a staging smoke test; liveness alone does not prove Neon connectivity or endpoint correctness.

## Current deployment evidence

At documentation time, the latest GitHub Actions CI run was [run #5](https://github.com/sikwaemu-ui/Task-Management-API-/actions/runs/38701853855), successful on October 15, 2026, for commit `e8808ee`. The public GitHub deployments API returned no repository deployment records. No verified Render URL or Render logs were available in the repository. Production deployment and health are therefore not currently verified.

To close these gaps, add the production Render URL and service name here after checking them in the Render dashboard; record the connected branch, auto-deploy setting, effective commands/runtime, latest deployed commit, migration evidence, and timestamped health-check result. Do not add credentials or database URLs.

## Troubleshooting checklist

- **Service fails during startup:** inspect Render logs for the safe configuration error; confirm `DATABASE_URL`, `JWT_SECRET`, and the assigned `PORT` are present and valid.
- **Prisma cannot connect:** confirm the Neon URL, database/role, SSL requirements, and network access. Never paste connection credentials into an issue or log excerpt.
- **Health check fails:** verify Render checks `/api/health`, the server binds to `0.0.0.0`, and the service is listening on its supplied `PORT`.
- **Browser calls fail with 403:** set `CORS_ORIGINS` to the frontend's exact origin, including scheme and port where applicable. CORS does not replace JWT authorization.
- **Migration fails:** stop before routing traffic to an incompatible build; inspect the failed migration and database state, then use a reviewed forward fix or a planned recovery. Do not reset the production database.
- **Rate limiting differs across instances:** the limiter is in-memory per process; a shared store is required for shared quotas.
- **CI passes but the live API is stale/down:** check Render's deploy history and deployed commit independently; CI does not deploy or health-check Render.
