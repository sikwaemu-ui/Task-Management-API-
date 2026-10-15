# TaskFlow API security configuration

The server validates configuration before importing route modules or creating the Prisma PostgreSQL pool. Production and development startup require `DATABASE_URL` and a `JWT_SECRET` of at least 32 characters. `JWT_EXPIRES_IN` defaults to `1d` and accepts a positive duration such as `15m`, `1h`, or `1d`. `PORT` defaults to `5000`.

## Browser origins

Set `CORS_ORIGINS` to a comma-separated list of exact `http://` or `https://` origins, without paths or wildcards. Development defaults to localhost ports used by the frontend. Production defaults to no allowed browser origins until the deployed frontend origin is known. Set it in the deployment environment after that origin is established. Requests without an `Origin` header are still handled normally and must use the API's authentication and authorization controls where required. CORS is not authentication.

## Request limits

`AUTH_RATE_LIMIT_WINDOW_MS` and `AUTH_RATE_LIMIT_MAX` configure the shared registration/login limit (defaults: 900000 ms and 10 requests). `API_RATE_LIMIT_WINDOW_MS` and `API_RATE_LIMIT_MAX` configure the general `/api` limit (defaults: 900000 ms and 300 requests). A limit response is HTTP 429 with `{ "success": false, "message": "Too many requests. Please try again later." }`.

The default rate-limit store is in memory. Counts are per process and reset on restart; with multiple Render instances, each instance maintains separate counts. Use a shared store such as Redis before scaling out if limits must apply across instances.

## Reverse proxies

`TRUST_PROXY_HOPS` defaults to `0`, so Express does not accept forwarded headers to determine client IP or protocol. Do not set it to `true`. For a Render deployment, inspect the actual trusted proxy chain and configure a numeric hop count matching only proxies that overwrite or append the forwarded address. Render's public traffic passes through its edge/load-balancing layer and can also pass through Cloudflare; the right count depends on the deployed path. Incorrect trust can let clients spoof IP addresses and evade rate limits. See [Render's web service networking guidance](https://render.com/docs/web-services) and [Render's DDoS and forwarded-IP notes](https://render.com/articles/how-render-handles-ddos-attacks).

## Headers, logs, and shutdown

Helmet provides the baseline security headers. CSP and Cross-Origin Resource Policy are disabled so the same-origin Swagger UI continues to load; no credentialed CORS is enabled. Request logs contain only method, path without query string, status, and duration. They omit headers and bodies. Production 500 responses and error logs do not include internal error messages. Development error text is kept useful with common credential, connection URL, and bearer-token forms redacted.

`SHUTDOWN_TIMEOUT_MS` controls the maximum wait per graceful-shutdown phase (HTTP close and Prisma disconnect), defaulting to `10000`. On timeout, the server closes remaining HTTP connections, reports a safe structured event, and exits after the bounded cleanup attempt.

## Environment variables

Copy `.env.example` for local development. Never commit `.env` or put real credentials in `.env.example`. Configure production values through the hosting provider's secret/environment settings. Rate limiting is disabled only in `NODE_ENV=test`; limiter behavior is tested with isolated in-memory instances.
