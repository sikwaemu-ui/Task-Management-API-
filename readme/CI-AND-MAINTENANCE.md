# CI and maintenance

## GitHub Actions CI

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on every push and pull request with read-only repository contents permission.

The job uses Node.js 22, npm caching, `npm ci`, and a temporary PostgreSQL 16 service. It then:

1. Generates the Prisma client.
2. Validates the Prisma schema.
3. Applies the checked-in migrations to the disposable CI database with `npx prisma migrate deploy`.
4. Runs `npm test` (Node test runner suites for auth, tasks, teams, team tasks, OpenAPI, and security).
5. Runs `npm run build`.

Latest status verified on October 16, 2026: [run #5](https://github.com/sikwaemu-ui/Task-Management-API-/actions/runs/38701853855), commit `e8808ee` on `main`, completed successfully October 15, 2026. Its sole job and all application verification steps completed successfully. This status is historical and can change as new commits run.

## CI is not production deployment

The workflow does not deploy to Render, access Neon, or run a production health check. It migrates only an ephemeral PostgreSQL 16 test service. A green run proves the listed checks passed for that commit; verify Render's deployed commit and health separately. See [deployment operations](DEPLOYMENT.md).

## Local maintenance commands

```bash
npm ci
npx prisma generate
npx prisma validate
npx prisma migrate dev
npm test
npm run build
```

Create schema changes with Prisma migrations, review generated SQL, and commit the migration with the application change. Production should apply committed migrations using `npx prisma migrate deploy` in a controlled release step, never `migrate reset`.

## Operational notes

- Keep Node.js on the CI-tested major, Node 22, in the deployment environment; the package currently has no `engines` field.
- Keep `.env` and provider secrets out of Git. Rotate a secret if it is exposed; do not put it into logs or support requests.
- Rate limiting currently uses process-local memory, so it resets on restart and is not shared among instances.
- Ensure `TRUST_PROXY_HOPS` reflects the actual proxy chain and configured frontend origins are exact.
- Review `SECURITY.md` before changing headers, CORS, logging, trust proxy, or rate-limit behavior.
- Avoid destructive schema/data changes without a reviewed migration, tested backup, and recovery plan.
