import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { confirmAdminPassword } from "@/server/password-gate";
import { hashSecret, pinKey, validatePin } from "@/lib/security";
import { pinInUse } from "@/server/pins";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  const admin = await prisma.adminAccount.findUnique({
    where: { id: session.adminId },
    select: { id: true, name: true, email: true, createdAt: true, pinKey: true },
  });
  return json({ admin: { ...admin, hasPin: Boolean(admin?.pinKey) } });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  let body: { action?: string; pin?: string; currentPassword?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }

  if (body.action === "set-pin") {
    const pin = String(body.pin || "");
    const err = validatePin(pin);
    if (err) return errorJson(err, 400);
    if (await pinInUse(pin, { adminId: session.adminId })) {
      return errorJson("That PIN is already used by an active account.", 409);
    }
    await prisma.adminAccount.update({
      where: { id: session.adminId },
      data: { pinHash: await hashSecret(pin), pinKey: pinKey(pin), updatedAt: new Date() },
    });
    return json({ ok: true, hasPin: true });
  }

  if (body.action === "remove-pin") {
    await prisma.adminAccount.update({
      where: { id: session.adminId },
      data: { pinHash: null, pinKey: null, updatedAt: new Date() },
    });
    return json({ ok: true, hasPin: false });
  }

  if (body.action === "reset-pin") {
    const password = String(body.currentPassword || "");
    if (!(await confirmAdminPassword(session.adminId, password))) {
      return errorJson("Password confirmation failed.", 403);
    }
    await prisma.adminAccount.update({
      where: { id: session.adminId },
      data: { pinHash: null, pinKey: null, updatedAt: new Date() },
    });
    return json({ ok: true, hasPin: false });
  }

  return errorJson("Unknown action.", 400);
}
