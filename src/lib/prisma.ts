import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function ensureSqlite(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys=ON;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch {
    // Non-sqlite providers ignore these.
  }
}

export async function getSettings() {
  await ensureSqlite();
  return prisma.appSettings.upsert({
    where: { id: "default" },
    create: { id: "default", updatedAt: new Date() },
    update: {},
  });
}
