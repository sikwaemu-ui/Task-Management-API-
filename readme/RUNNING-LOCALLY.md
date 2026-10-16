# Run TaskFlow locally

See the [root README](../README.md) for project scope and current CI status. For Render and Neon operations, see [deployment guide](DEPLOYMENT.md).

## Requirements

- Node.js 22 (the major version used by CI; `package.json` currently has no `engines` range).
- npm and a reachable PostgreSQL database.

## Setup

From the repository root:

```bash
npm ci
cp .env.example .env
```

Set `DATABASE_URL` to your local PostgreSQL or development Neon database, and set `JWT_SECRET` to a random value with at least 32 non-whitespace characters. For a local PostgreSQL instance, use the SSL option appropriate to that server; Neon connections generally require SSL. Keep `.env` private; it is ignored by Git. In local development, unset `CORS_ORIGINS` defaults to localhost ports 3000. Set exact `http://` or `https://` origins if your frontend uses another origin.

Generate the Prisma client and apply the checked-in migrations to your development database:

```bash
npx prisma generate
npx prisma migrate dev
```

There are two checked-in migrations under `prisma/migrations/`. For schema changes, create and review a new migration with Prisma, then commit its SQL alongside the code changes.

## Start and browse

```bash
npm run dev
```

The API defaults to `http://localhost:5000`. Health is `GET /api/health`, Swagger UI is `/api-docs`, and the raw OpenAPI document is `/api-docs.json`.

To use another port:

```bash
PORT=5001 npm run dev
```

Other project commands:

```bash
npx prisma validate
npm test
npm run build
npm start
```

`npm start` runs the compiled server in `dist/`; run `npm run build` first.

## Swagger walkthrough

1. Register through `POST /api/auth/register`.
2. Log in through `POST /api/auth/login` and copy the returned token.
3. Select **Authorize** in Swagger UI and paste the token value (Swagger applies the Bearer scheme).
4. Call protected task and team routes. Use `teamId` to work with team tasks.

The docs UI persists authorization in the browser. Avoid using real credentials in screenshots or public demos.
