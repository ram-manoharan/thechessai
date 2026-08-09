import { PrismaClient } from "@prisma/client";

// Standard Next.js hot-reload-safe singleton: without this, every module
// reload in dev spins up a fresh PrismaClient (and a fresh connection pool)
// without closing the old one, exhausting Postgres connections in minutes.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
