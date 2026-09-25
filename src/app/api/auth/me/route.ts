import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return json({
    role: session.role,
    access: session.access,
    name: session.name,
    soundEnabled: settings?.soundEnabled ?? true,
    vibrationEnabled: settings?.vibrationEnabled ?? true,
  });
}
