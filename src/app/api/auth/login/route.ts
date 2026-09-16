import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkLock, clearFailures, clientIp, clientScope, recordFailure } from "@/lib/rate-limit";
import { applySessionCookie, errorJson, json, signSession } from "@/lib/session";
import { normalizeEmail, verifySecret } from "@/lib/security";

export const runtime = "nodejs";

const GENERIC = "Login failed.";
const LOCKED = "Login failed. Try again later.";

export async function POST(req: NextRequest) {
  const scope = clientScope("admin", clientIp(req));
  const lock = await checkLock(scope);
  if (!lock.ok) return errorJson(LOCKED, 429);

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson(GENERIC, 400);
  }

  const email = normalizeEmail(body.email || "");
  const password = body.password || "";
  const admin = email ? await prisma.adminAccount.findUnique({ where: { email } }) : null;
  const ok = admin ? await verifySecret(password, admin.passwordHash) : false;
  if (!admin || !ok) {
    await recordFailure(scope);
    return errorJson(GENERIC, 401);
  }
  await clearFailures(scope);
  const token = await signSession({
    role: "admin",
    adminId: admin.id,
    access: "admin",
    name: admin.name,
  });
  return applySessionCookie(json({ ok: true, role: "admin", name: admin.name }), token);
}
