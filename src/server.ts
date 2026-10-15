import "dotenv/config";
import { runtimeConfig } from "./config/env";
import express from "express";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes";
import taskRoutes from "./routes/task.routes";
import teamRoutes from "./routes/team.routes";
import { errorHandler } from "./middleware/error.middleware";
import { createCorsMiddleware } from "./middleware/cors.middleware";
import requestLogger from "./middleware/request-logger.middleware";
import { createRateLimiters } from "./middleware/rate-limit.middleware";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./openapi";
import { createServer, Server } from "node:http";
import prisma, { pgPool } from "./db/prisma";
import { createGracefulShutdown } from "./server-lifecycle";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", runtimeConfig.trustProxyHops);

// Keep Swagger's same-origin assets working without enabling a CSP that would
// block its inline bootstrap. CORP is disabled because this API serves docs UI assets.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(requestLogger);
app.use(createCorsMiddleware(runtimeConfig));
app.use(express.json());

const { apiLimiter, authLimiter } = createRateLimiters(runtimeConfig);

// Keep the Render liveness check reachable even when the general API quota is exhausted.
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Task Managing API is running",
  });
});

app.use("/api", apiLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/login", authLimiter);

app.get("/api-docs.json", (_req, res) => {
  res.json(openApiSpec);
});
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "TaskFlow API Documentation",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/teams", teamRoutes);

// Global centralized error handler
app.use(errorHandler);

export const startServer = (): { server: Server; shutdown: (signal?: string) => Promise<boolean> } => {
  const server = createServer(app);
  server.listen(runtimeConfig.port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "server_started", port: runtimeConfig.port }));
  });

  const shutdown = createGracefulShutdown({
    server,
    disconnect: async () => {
      try {
        await prisma.$disconnect();
      } finally {
        // PrismaPg does not own externally supplied pools unless configured to dispose them.
        if (pgPool) await pgPool.end();
      }
    },
    timeoutMs: runtimeConfig.shutdownTimeoutMs,
  });

  let exitStarted = false;
  const handleSignal = (signal: NodeJS.Signals) => {
    if (exitStarted) return;
    exitStarted = true;
    void shutdown(signal).then((successful) => {
      process.exitCode = successful ? 0 : 1;
      // A timeout may leave an unresponsive adapter handle alive; exit after the
      // bounded cleanup sequence so the platform can restart the process.
      process.exit();
    });
  };
  process.once("SIGTERM", handleSignal);
  process.once("SIGINT", handleSignal);

  return { server, shutdown };
};

if (require.main === module && runtimeConfig.nodeEnv !== "test") {
  startServer();
}

export default app;
