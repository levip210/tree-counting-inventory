import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { requireAccess, sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { ACTIONS } from "@/lib/constants";
import { sanitizeCount, syncCounts, voidCount } from "@/server/counts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return json({ counts: [] });
  const rows = await prisma.countRecord.findMany({
    where: { sessionId, voidedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      clientSyncId: true,
      timestampLocal: true,
      action: true,
      farmId: true,
      farmName: true,
      sizeId: true,
      sizeName: true,
      gradeId: true,
      gradeName: true,
      quantity: true,
      syncedAt: true,
    },
  });
  return json({ counts: rows });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  let body: { counts?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  const incoming = Array.isArray(body.counts) ? body.counts : [];
  if (incoming.length === 0) return errorJson("No counts to save.", 400);

  const first = incoming[0];
  if (first && typeof first === "object") {
    const peek = sanitizeCount(first as Record<string, unknown>);
    if (!("error" in peek)) {
      const need = peek.action === ACTIONS.YARD ? "yard" : "shipping";
      if (!requireAccess(session, need)) return errorJson("Not allowed.", 403);
    }
  }

  const result = await syncCounts(session, incoming);
  if (result.accepted.length === 0 && result.rejected.length > 0) {
    return json({ error: result.rejected[0]?.error || "Count not saved — tap again", ...result }, 400);
  }
  return json({ ok: true, ...result });
}

export async function DELETE(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return errorJson("Sign-in required.", 401);
  let body: { clientSyncId?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  const result = await voidCount({ clientSyncId: body.clientSyncId }, "Undo last count");
  if (!result.ok) return errorJson(result.error, 404);
  return json({ ok: true, already: result.already, id: result.id });
}
