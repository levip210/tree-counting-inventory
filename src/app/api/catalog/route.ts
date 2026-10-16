import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { requireAccess, sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { farmProgress } from "@/server/dashboard";
import { getCountHand } from "@/server/count-hand";
import { attachRequireFarm } from "@/server/require-farm";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  if (!requireAccess(session, "yard") && !requireAccess(session, "shipping")) {
    return errorJson("Sign-in required.", 401);
  }
  const [farms, customers, sizeRows, gradeRows, settings, progress] = await Promise.all([
    prisma.farm.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.treeSize.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true, color: true, displayOrder: true, active: true },
    }),
    prisma.treeGrade.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true, displayOrder: true, active: true },
    }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    farmProgress(),
  ]);
  const [sizes, grades] = await Promise.all([
    attachRequireFarm("size", sizeRows),
    attachRequireFarm("grade", gradeRows),
  ]);
  const countHand = await getCountHand(session);
  return json({
    farms,
    customers,
    sizes,
    grades,
    soundEnabled: settings?.soundEnabled ?? true,
    vibrationEnabled: settings?.vibrationEnabled ?? true,
    startingProgress: progress,
    countHand,
  });
}
