import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { requireAccess, sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { farmProgress } from "@/server/dashboard";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  if (!requireAccess(session, "yard") && !requireAccess(session, "shipping")) {
    return errorJson("Sign-in required.", 401);
  }
  const [farms, sizes, grades, settings, progress] = await Promise.all([
    prisma.farm.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.treeSize.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.treeGrade.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    farmProgress(),
  ]);
  return json({
    farms,
    sizes,
    grades,
    soundEnabled: settings?.soundEnabled ?? true,
    vibrationEnabled: settings?.vibrationEnabled ?? true,
    startingProgress: progress,
  });
}
