import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { confirmAdminPassword } from "@/server/password-gate";
import { SUGGESTED_GRADES, SUGGESTED_SIZES } from "@/lib/constants";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  if (!(await confirmAdminPassword(session.adminId, String(body?.currentPassword || "")))) {
    return errorJson("Password confirmation failed.", 403);
  }

  if (body.action === "delete-counts") {
    await prisma.countRecord.deleteMany();
    await prisma.countSession.deleteMany();
    return json({ ok: true, message: "All counting data was deleted." });
  }

  if (body.action === "reset-site") {
    await prisma.countRecord.deleteMany();
    await prisma.countSession.deleteMany();
    await prisma.startingInventory.deleteMany();
    await prisma.counterAccount.deleteMany();
    await prisma.farm.deleteMany();
    await prisma.treeSize.deleteMany();
    await prisma.treeGrade.deleteMany();
    await prisma.loginAttempt.deleteMany();
    await prisma.adminAccount.deleteMany();
    const now = new Date();
    await prisma.treeSize.createMany({
      data: SUGGESTED_SIZES.map((name, i) => ({ name, displayOrder: i, active: true, updatedAt: now })),
    });
    await prisma.treeGrade.createMany({
      data: SUGGESTED_GRADES.map((name, i) => ({ name, displayOrder: i, active: true, updatedAt: now })),
    });
    await prisma.appSettings.update({
      where: { id: "default" },
      data: {
        setupLocked: false,
        excelApiKeyHash: null,
        excelEnabled: false,
        checklistJson: "{}",
        checklistDismissed: false,
        updatedAt: now,
      },
    });
    return json({ ok: true, message: "Website and database were reset. First-administrator setup is open again." });
  }

  return errorJson("Unknown danger action.", 400);
}
