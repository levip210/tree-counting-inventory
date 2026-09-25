import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { confirmAdminPassword } from "@/server/password-gate";
import { hashSecret, normalizeEmail, validatePassword } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  let body: { currentPassword?: string; email?: string; newPassword?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  if (!(await confirmAdminPassword(session.adminId, String(body.currentPassword || "")))) {
    return errorJson("Password confirmation failed.", 403);
  }

  const data: { email?: string; passwordHash?: string; name?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (body.email) {
    const email = normalizeEmail(body.email);
    if (!email.includes("@")) return errorJson("A valid email is required.", 400);
    const clash = await prisma.adminAccount.findFirst({
      where: { email, id: { not: session.adminId } },
    });
    if (clash) return errorJson("That email is already in use.", 409);
    data.email = email;
  }
  if (body.newPassword) {
    const err = validatePassword(body.newPassword);
    if (err) return errorJson(err, 400);
    data.passwordHash = await hashSecret(body.newPassword);
  }
  if (body.name) data.name = body.name.trim();
  const admin = await prisma.adminAccount.update({ where: { id: session.adminId }, data });
  return json({ ok: true, admin: { id: admin.id, name: admin.name, email: admin.email } });
}
