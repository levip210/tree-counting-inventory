import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const data: { soundEnabled?: boolean; vibrationEnabled?: boolean; checklistJson?: string; checklistDismissed?: boolean; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (typeof body.soundEnabled === "boolean") data.soundEnabled = body.soundEnabled;
  if (typeof body.vibrationEnabled === "boolean") data.vibrationEnabled = body.vibrationEnabled;
  if (body.checklist && typeof body.checklist === "object") {
    data.checklistJson = JSON.stringify(body.checklist);
  }
  if (typeof body.checklistDismissed === "boolean") data.checklistDismissed = body.checklistDismissed;
  const settings = await prisma.appSettings.update({ where: { id: "default" }, data });
  return json({ ok: true, settings });
}
