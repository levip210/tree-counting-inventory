import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { publicCount, voidCount } from "@/server/counts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const farmId = url.searchParams.get("farmId") || "";
  const sizeId = url.searchParams.get("sizeId") || "";
  const gradeId = url.searchParams.get("gradeId") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const includeVoided = url.searchParams.get("includeVoided") === "1";
  const q = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const take = Math.min(200, Number(url.searchParams.get("take") || 100));

  const rows = await prisma.countRecord.findMany({
    where: {
      ...(includeVoided ? {} : { voidedAt: null }),
      ...(action ? { action } : {}),
      ...(farmId ? { farmId } : {}),
      ...(sizeId ? { sizeId } : {}),
      ...(gradeId ? { gradeId } : {}),
    },
    orderBy: { timestampUtc: "desc" },
    take,
  });
  const filtered = rows.filter((row) => {
    if (from && row.timestampLocal.slice(0, 10) < from) return false;
    if (to && row.timestampLocal.slice(0, 10) > to) return false;
    if (!q) return true;
    const hay = `${row.farmName || ""} ${row.sizeName} ${row.gradeName} ${row.action} ${row.id}`.toLowerCase();
    return hay.includes(q);
  });
  return json({ counts: filtered.map(publicCount) });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  if (body?.action === "void") {
    const result = await voidCount({ id: body.id }, String(body.reason || "Admin correction"));
    if (!result.ok) return errorJson(result.error, 404);
    return json({ ok: true, already: result.already, id: result.id });
  }
  if (body?.action === "note") {
    const row = await prisma.countRecord.update({
      where: { id: body.id },
      data: { correctionNote: String(body.note || ""), correctedAt: new Date() },
    });
    return json({ ok: true, count: publicCount(row) });
  }
  return errorJson("Unknown correction action.", 400);
}
