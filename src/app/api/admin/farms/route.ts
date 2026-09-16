import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { countActiveFarmCounts, deleteOrDeactivateFarm } from "@/server/farms";

export const runtime = "nodejs";

async function requireAdmin(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const farms = await prisma.farm.findMany({ orderBy: { displayOrder: "asc" } });
  const withCounts = await Promise.all(
    farms
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      .map(async (f) => ({
        ...f,
        countTotal: await countActiveFarmCounts(f.id),
      })),
  );
  return json({ farms: withCounts });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  if (!name) return errorJson("Farm name is required.", 400);
  const max = await prisma.farm.aggregate({ _max: { displayOrder: true } });
  const farm = await prisma.farm.create({
    data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true, updatedAt: new Date() },
  });
  return json({ ok: true, farm });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return errorJson("Farm id required.", 400);
  const farm = await prisma.farm.findUnique({ where: { id } });
  if (!farm) return errorJson("Farm not found.", 404);

  if (body.action === "reorder") {
    const direction = body.direction === "up" ? -1 : 1;
    const all = await prisma.farm.findMany({ orderBy: { displayOrder: "asc" } });
    const idx = all.findIndex((f) => f.id === id);
    const swap = all[idx + direction];
    if (!swap) return json({ ok: true, farms: all });
    await prisma.$transaction([
      prisma.farm.update({ where: { id: farm.id }, data: { displayOrder: swap.displayOrder, updatedAt: new Date() } }),
      prisma.farm.update({ where: { id: swap.id }, data: { displayOrder: farm.displayOrder, updatedAt: new Date() } }),
    ]);
    return json({ ok: true });
  }

  const data: { name?: string; active?: boolean; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== farm.name) {
    const used = await countActiveFarmCounts(id);
    if (used > 0 && !body.confirmRename) {
      return json({ needsConfirm: true, message: `This farm has ${used} active saved counts. Rename anyway? The old name stays on past counts.` }, 409);
    }
    data.name = body.name.trim();
  }
  if (typeof body.active === "boolean") data.active = body.active;
  const updated = await prisma.farm.update({ where: { id }, data });
  return json({ ok: true, farm: updated });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return errorJson("Farm id required.", 400);
  const result = await deleteOrDeactivateFarm(id);
  if (!result.ok) return errorJson(result.error, result.status);
  return json(result);
}
