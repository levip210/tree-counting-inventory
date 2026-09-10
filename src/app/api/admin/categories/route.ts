import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Kind = "size" | "grade";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const kind = (new URL(req.url).searchParams.get("kind") || "size") as Kind;
  if (kind === "size") {
    const rows = await prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } });
    const items = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        countTotal: await prisma.countRecord.count({ where: { sizeId: row.id } }),
      })),
    );
    return json({ items });
  }
  const rows = await prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } });
  const items = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      countTotal: await prisma.countRecord.count({ where: { gradeId: row.id } }),
    })),
  );
  return json({ items });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const kind = (body?.kind || "size") as Kind;
  const name = String(body?.name || "").trim();
  if (!name) return errorJson("Name is required.", 400);
  const now = new Date();
  if (kind === "size") {
    const max = await prisma.treeSize.aggregate({ _max: { displayOrder: true } });
    const item = await prisma.treeSize.create({
      data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true, updatedAt: now },
    });
    return json({ ok: true, item });
  }
  const max = await prisma.treeGrade.aggregate({ _max: { displayOrder: true } });
  const item = await prisma.treeGrade.create({
    data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true, updatedAt: now },
  });
  return json({ ok: true, item });
}

export async function PATCH(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const kind = (body?.kind || "size") as Kind;
  const id = String(body?.id || "");
  if (kind === "size") {
    const row = await prisma.treeSize.findUnique({ where: { id } });
    if (!row) return errorJson("Not found.", 404);
    if (body.action === "reorder") {
      const direction = body.direction === "up" ? -1 : 1;
      const all = await prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } });
      const idx = all.findIndex((f) => f.id === id);
      const swap = all[idx + direction];
      if (!swap) return json({ ok: true });
      await prisma.$transaction([
        prisma.treeSize.update({ where: { id: row.id }, data: { displayOrder: swap.displayOrder, updatedAt: new Date() } }),
        prisma.treeSize.update({ where: { id: swap.id }, data: { displayOrder: row.displayOrder, updatedAt: new Date() } }),
      ]);
      return json({ ok: true });
    }
    const data: { name?: string; active?: boolean; updatedAt: Date } = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.active === "boolean") data.active = body.active;
    const item = await prisma.treeSize.update({ where: { id }, data });
    return json({ ok: true, item });
  }

  const row = await prisma.treeGrade.findUnique({ where: { id } });
  if (!row) return errorJson("Not found.", 404);
  if (body.action === "reorder") {
    const direction = body.direction === "up" ? -1 : 1;
    const all = await prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } });
    const idx = all.findIndex((f) => f.id === id);
    const swap = all[idx + direction];
    if (!swap) return json({ ok: true });
    await prisma.$transaction([
      prisma.treeGrade.update({ where: { id: row.id }, data: { displayOrder: swap.displayOrder, updatedAt: new Date() } }),
      prisma.treeGrade.update({ where: { id: swap.id }, data: { displayOrder: row.displayOrder, updatedAt: new Date() } }),
    ]);
    return json({ ok: true });
  }
  const data: { name?: string; active?: boolean; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.active === "boolean") data.active = body.active;
  const item = await prisma.treeGrade.update({ where: { id }, data });
  return json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "size") as Kind;
  const id = url.searchParams.get("id") || "";
  const used = await prisma.countRecord.count({
    where: kind === "size" ? { sizeId: id } : { gradeId: id },
  });
  if (used > 0) {
    if (kind === "size") {
      await prisma.treeSize.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
    } else {
      await prisma.treeGrade.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
    }
    return json({ ok: true, deactivated: true, message: "This category is used in saved counts, so it was deactivated instead of deleted." });
  }
  if (kind === "size") {
    await prisma.startingInventory.deleteMany({ where: { sizeId: id } });
    await prisma.treeSize.delete({ where: { id } });
  } else {
    await prisma.startingInventory.deleteMany({ where: { gradeId: id } });
    await prisma.treeGrade.delete({ where: { id } });
  }
  return json({ ok: true, deleted: true });
}
