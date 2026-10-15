import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    if (process.env.NODE_ENV === "test") {
      return new PrismaClient({ accelerateUrl: "prisma://test-mock-placeholder" });
    }
    throw new Error(
      "PrismaClient initialization failed: DATABASE_URL environment variable is missing."
    );
  }

  try {
    const requiresSsl =
      databaseUrl.includes("sslmode=require") ||
      databaseUrl.includes("neon.tech");

    const pool = new Pool({
      connectionString: databaseUrl,
      ...(requiresSsl ? { ssl: true } : {}),
    });

    pool.on("error", (err) => {
      console.error(JSON.stringify({
        level: "error",
        event: "postgres_pool_error",
        error: err.name,
      }));
    });

    globalForPrisma.pgPool = pool;

    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  } catch {
    throw new Error(
      "PrismaClient initialization failed with PostgreSQL driver adapter. Check DATABASE_URL configuration."
    );
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
export const pgPool = globalForPrisma.pgPool;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
