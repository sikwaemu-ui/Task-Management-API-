export type NodeEnvironment = "development" | "test" | "production";

export interface RuntimeConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  trustProxyHops: number;
  corsOrigins: string[];
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  apiRateLimitWindowMs: number;
  apiRateLimitMax: number;
  shutdownTimeoutMs: number;
  jwtExpiresIn: string;
}

const TEST_JWT_SECRET = "taskflow-test-only-secret-at-least-32-characters";
const LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

const positiveInteger = (
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  errors: string[],
  allowZero = false
): number => {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    errors.push(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value < 1)) {
    errors.push(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
    return fallback;
  }
  return value;
};

const parseOrigins = (raw: string | undefined, nodeEnv: NodeEnvironment, errors: string[]) => {
  const values = raw === undefined
    ? nodeEnv === "production" ? [] : LOCAL_ORIGINS
    : raw.split(",").map((value) => value.trim()).filter(Boolean);

  const origins = new Set<string>();
  for (const value of values) {
    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.origin !== value ||
        value === "*"
      ) {
        errors.push("CORS_ORIGINS must contain comma-separated http(s) origins without paths or wildcards.");
        continue;
      }
      origins.add(parsed.origin);
    } catch {
      errors.push("CORS_ORIGINS must contain comma-separated valid http(s) origins.");
    }
  }
  return [...origins];
};

/** Validate without returning or logging secret values. Test mode may omit DB/JWT credentials. */
export const validateEnvironment = (
  source: NodeJS.ProcessEnv = process.env
): RuntimeConfig => {
  const errors: string[] = [];
  const rawNodeEnv = source.NODE_ENV || "development";
  const nodeEnv = rawNodeEnv as NodeEnvironment;
  if (!["development", "test", "production"].includes(rawNodeEnv)) {
    errors.push("NODE_ENV must be development, test, or production.");
  }

  const port = positiveInteger(source, "PORT", 5000, errors);
  if (port > 65535) errors.push("PORT must be between 1 and 65535.");
  const trustProxyHops = positiveInteger(source, "TRUST_PROXY_HOPS", 0, errors, true);
  if (trustProxyHops > 10) errors.push("TRUST_PROXY_HOPS must not exceed 10.");
  const authRateLimitWindowMs = positiveInteger(source, "AUTH_RATE_LIMIT_WINDOW_MS", 900000, errors);
  const authRateLimitMax = positiveInteger(source, "AUTH_RATE_LIMIT_MAX", 10, errors);
  const apiRateLimitWindowMs = positiveInteger(source, "API_RATE_LIMIT_WINDOW_MS", 900000, errors);
  const apiRateLimitMax = positiveInteger(source, "API_RATE_LIMIT_MAX", 300, errors);
  const shutdownTimeoutMs = positiveInteger(source, "SHUTDOWN_TIMEOUT_MS", 10000, errors);
  if (authRateLimitWindowMs > 2147483647) errors.push("AUTH_RATE_LIMIT_WINDOW_MS is too large.");
  if (apiRateLimitWindowMs > 2147483647) errors.push("API_RATE_LIMIT_WINDOW_MS is too large.");
  if (shutdownTimeoutMs > 60000) errors.push("SHUTDOWN_TIMEOUT_MS must not exceed 60000.");

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl && nodeEnv !== "test") {
    errors.push("DATABASE_URL is required.");
  } else if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (
        (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
        !parsed.hostname ||
        parsed.pathname.length < 2
      ) {
        errors.push("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL connection URL.");
    }
  }

  const jwtSecret = source.JWT_SECRET || (nodeEnv === "test" ? TEST_JWT_SECRET : "");
  if (!jwtSecret && nodeEnv !== "test") errors.push("JWT_SECRET is required.");
  if (jwtSecret && jwtSecret.trim().length < 32) {
    errors.push("JWT_SECRET must contain at least 32 non-whitespace characters.");
  }

  const jwtExpiresIn = source.JWT_EXPIRES_IN || "1d";
  if (!/^[1-9]\d*(ms|s|m|h|d|w|y)$/i.test(jwtExpiresIn)) {
    errors.push("JWT_EXPIRES_IN must be a positive duration such as 15m, 1h, or 1d.");
  }

  const corsOrigins = parseOrigins(source.CORS_ORIGINS, nodeEnv, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(" ")}`);
  }

  return {
    nodeEnv,
    port,
    trustProxyHops,
    corsOrigins,
    authRateLimitWindowMs,
    authRateLimitMax,
    apiRateLimitWindowMs,
    apiRateLimitMax,
    shutdownTimeoutMs,
    jwtExpiresIn,
  };
};

// Loaded after dotenv/config by the application entry point, before route modules
// (and therefore before Prisma initializes its PostgreSQL pool).
export const runtimeConfig = validateEnvironment();
