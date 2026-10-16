import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getCountHand, setCountHand } from "@/server/count-hand";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const countHand = await getCountHand(session);
  return json({
    role: session.role,
    access: session.access,
    name: session.name,
    soundEnabled: settings?.soundEnabled ?? true,
    vibrationEnabled: settings?.vibrationEnabled ?? true,
    countHand,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  let body: { countHand?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  if (body.countHand !== "left" && body.countHand !== "right") {
    return errorJson("Choose left or right.", 400);
  }
  try {
    const countHand = await setCountHand(session, body.countHand);
    return json({ countHand });
  } catch (err) {
    if (err instanceof Error && err.message === "NO_ACCOUNT") return errorJson("Sign-in required.", 401);
    return errorJson("Could not save layout preference.", 503);
  }
}
