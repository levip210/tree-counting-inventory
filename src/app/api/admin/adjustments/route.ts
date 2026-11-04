import { NextRequest } from "next/server";
import { sessionFromRequest } from "@/lib/guards";
import { errorJson, json } from "@/lib/session";
import { adminAdjustment, listRecentAdjustments } from "@/server/adjustments";

export const runtime = "nodejs";

function adminSession(session: Awaited<ReturnType<typeof sessionFromRequest>>) {
  return Boolean(session && session.role === "admin" && session.adminId);
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!adminSession(session)) return errorJson("Admin sign-in required.", 401);
  return json({ adjustments: await listRecentAdjustments() });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || !adminSession(session)) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const result = await adminAdjustment(session, body);
  if (!result.ok) return errorJson(result.error, result.status);
  return json(result);
}
