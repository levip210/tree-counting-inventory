import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  let body: { id?: string; action?: string; farmId?: string | null; farmName?: string | null; startedAt?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  if (!body.id || !body.action) return errorJson("Session id and action are required.", 400);
  const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
  const row = await prisma.countSession.upsert({
    where: { id: body.id },
    create: {
      id: body.id,
      action: body.action,
      farmId: body.farmId || null,
      farmName: body.farmName || null,
      startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
    },
    update: {
      farmId: body.farmId || undefined,
      farmName: body.farmName || undefined,
    },
  });
  return json({ ok: true, session: row });
}

export async function PATCH(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  if (!body.id) return errorJson("Session id required.", 400);
  const row = await prisma.countSession.updateMany({
    where: { id: body.id, endedAt: null },
    data: { endedAt: new Date() },
  });
  return json({ ok: true, ended: row.count > 0 });
}
