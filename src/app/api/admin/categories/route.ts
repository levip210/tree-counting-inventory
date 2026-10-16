import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { normalizeSizeColor } from "@/lib/size-color";
import { attachRequireFarm } from "@/server/require-farm";

export const runtime = "nodejs";

type Kind = "size" | "grade";

const sizeFields = {
  id: true,
  name: true,
  color: true,
  displayOrder: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gradeFields = {
  id: true,
  name: true,
  displayOrder: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isMissingColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("requireFarm") || message.includes("P2022");
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const kind = (new URL(req.url).searchParams.get("kind") || "size") as Kind;
  if (kind === "size") {
    const rows = await prisma.treeSize.findMany({
      orderBy: { displayOrder: "asc" },
      select: sizeFields,
    });
    const withFlag = await attachRequireFarm("size", rows);
    const items = await Promise.all(
      withFlag.map(async (row) => ({
        ...row,
        countTotal: await prisma.countRecord.count({ where: { sizeId: row.id } }),
      })),
    );
    return json({ items });
  }
  const rows = await prisma.treeGrade.findMany({
    orderBy: { displayOrder: "asc" },
    select: gradeFields,
  });
  const withFlag = await attachRequireFarm("grade", rows);
  const items = await Promise.all(
    withFlag.map(async (row) => ({
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
  try {
    if (kind === "size") {
      let color: string | null = null;
      if (body?.color != null && String(body.color).trim() !== "") {
        color = normalizeSizeColor(body.color);
        if (!color) return errorJson("Color must be a hex value like #3D8A5C.", 400);
      }
      const max = await prisma.treeSize.aggregate({ _max: { displayOrder: true } });
      const created = await prisma.treeSize.create({
        data: { name, color, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true, updatedAt: now },
        select: sizeFields,
      });
      const [item] = await attachRequireFarm("size", [created]);
      return json({ ok: true, item });
    }
    const max = await prisma.treeGrade.aggregate({ _max: { displayOrder: true } });
    const created = await prisma.treeGrade.create({
      data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true, updatedAt: now },
      select: gradeFields,
    });
    const [item] = await attachRequireFarm("grade", [created]);
    return json({ ok: true, item });
  } catch (err) {
    if (isMissingColumn(err)) {
      return errorJson("Sizes and grades are still updating. Try again in a moment.", 503);
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const kind = (body?.kind || "size") as Kind;
  const id = String(body?.id || "");
  if (kind === "size") {
    const row = await prisma.treeSize.findUnique({ where: { id }, select: { id: true, displayOrder: true } });
    if (!row) return errorJson("Not found.", 404);
    if (body.action === "reorder") {
      const direction = body.direction === "up" ? -1 : 1;
      const all = await prisma.treeSize.findMany({
        orderBy: { displayOrder: "asc" },
        select: { id: true, displayOrder: true },
      });
      const idx = all.findIndex((f) => f.id === id);
      const swap = all[idx + direction];
      if (!swap) return json({ ok: true });
      await prisma.$transaction([
        prisma.treeSize.update({ where: { id: row.id }, data: { displayOrder: swap.displayOrder, updatedAt: new Date() }, select: { id: true } }),
        prisma.treeSize.update({ where: { id: swap.id }, data: { displayOrder: row.displayOrder, updatedAt: new Date() }, select: { id: true } }),
      ]);
      return json({ ok: true });
    }
    const data: { name?: string; active?: boolean; color?: string | null; requireFarm?: boolean; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.active === "boolean") data.active = body.active;
    if (typeof body.requireFarm === "boolean") data.requireFarm = body.requireFarm;
    if ("color" in body) {
      if (body.color == null || String(body.color).trim() === "") {
        data.color = null;
      } else {
        const color = normalizeSizeColor(body.color);
        if (!color) return errorJson("Color must be a hex value like #3D8A5C.", 400);
        data.color = color;
      }
    }
    try {
      const updated = await prisma.treeSize.update({ where: { id }, data, select: sizeFields });
      const [item] = await attachRequireFarm("size", [updated]);
      return json({ ok: true, item });
    } catch (err) {
      if (isMissingColumn(err)) {
        return errorJson("The require-farm setting is not ready yet. Try again in a moment.", 503);
      }
      throw err;
    }
  }

  const row = await prisma.treeGrade.findUnique({ where: { id }, select: { id: true, displayOrder: true } });
  if (!row) return errorJson("Not found.", 404);
  if (body.action === "reorder") {
    const direction = body.direction === "up" ? -1 : 1;
    const all = await prisma.treeGrade.findMany({
      orderBy: { displayOrder: "asc" },
      select: { id: true, displayOrder: true },
    });
    const idx = all.findIndex((f) => f.id === id);
    const swap = all[idx + direction];
    if (!swap) return json({ ok: true });
    await prisma.$transaction([
      prisma.treeGrade.update({ where: { id: row.id }, data: { displayOrder: swap.displayOrder, updatedAt: new Date() }, select: { id: true } }),
      prisma.treeGrade.update({ where: { id: swap.id }, data: { displayOrder: row.displayOrder, updatedAt: new Date() }, select: { id: true } }),
    ]);
    return json({ ok: true });
  }
  const data: { name?: string; active?: boolean; requireFarm?: boolean; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.requireFarm === "boolean") data.requireFarm = body.requireFarm;
  try {
    const updated = await prisma.treeGrade.update({ where: { id }, data, select: gradeFields });
    const [item] = await attachRequireFarm("grade", [updated]);
    return json({ ok: true, item });
  } catch (err) {
    if (isMissingColumn(err)) {
      return errorJson("The require-farm setting is not ready yet. Try again in a moment.", 503);
    }
    throw err;
  }
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
      await prisma.treeSize.update({ where: { id }, data: { active: false, updatedAt: new Date() }, select: { id: true } });
    } else {
      await prisma.treeGrade.update({ where: { id }, data: { active: false, updatedAt: new Date() }, select: { id: true } });
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
