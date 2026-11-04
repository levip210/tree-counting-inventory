import { LOGIN_LOCK_MS, LOGIN_MAX_FAILS } from "./constants";
import { prisma } from "./prisma";

export async function checkLock(scope: string): Promise<{ ok: true } | { ok: false; retryAt: Date }> {
  const row = await prisma.loginAttempt.findUnique({ where: { scope } });
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, retryAt: row.lockedUntil };
  }
  return { ok: true };
}

export async function recordFailure(scope: string): Promise<void> {
  const existing = await prisma.loginAttempt.findUnique({ where: { scope } });
  const failCount = (existing?.failCount || 0) + 1;
  const lockedUntil = failCount >= LOGIN_MAX_FAILS ? new Date(Date.now() + LOGIN_LOCK_MS) : null;
  await prisma.loginAttempt.upsert({
    where: { scope },
    create: {
      scope,
      failCount,
      lockedUntil,
      updatedAt: new Date(),
    },
    update: {
      failCount,
      lockedUntil,
      updatedAt: new Date(),
    },
  });
}

export async function clearFailures(scope: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { scope } });
}

export function clientScope(kind: string, ip: string): string {
  return `${kind}:${ip || "unknown"}`;
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
