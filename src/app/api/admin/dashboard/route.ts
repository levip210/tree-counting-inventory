import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { dashboardStats, farmProgress } from "@/server/dashboard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const [stats, progress, settings] = await Promise.all([
    dashboardStats(),
    farmProgress(),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
  ]);
  let checklist: Record<string, boolean> = {};
  try {
    checklist = JSON.parse(settings?.checklistJson || "{}") as Record<string, boolean>;
  } catch {
    checklist = {};
  }
  return json({
    stats,
    progress,
    excelEnabled: settings?.excelEnabled ?? false,
    hasExcelKey: Boolean(settings?.excelApiKeyHash),
    checklist,
    checklistDismissed: settings?.checklistDismissed ?? false,
    soundEnabled: settings?.soundEnabled ?? true,
    vibrationEnabled: settings?.vibrationEnabled ?? true,
  });
}
