import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { farmProgress } from "@/server/dashboard";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const [farms, sizes, grades, rows, progress] = await Promise.all([
    prisma.farm.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.treeSize.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.treeGrade.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    prisma.startingInventory.findMany(),
    farmProgress(),
  ]);
  return json({ farms, sizes, grades, rows, progress });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const farmId = String(body?.farmId || "");
  const sizeId = String(body?.sizeId || "");
  const gradeId = String(body?.gradeId || "");
  const quantity = Number(body?.quantity);
  if (!farmId || !sizeId || !gradeId) return errorJson("Farm, size, and grade are required.", 400);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
    return errorJson("Quantity must be a whole number 0 or greater.", 400);
  }
  const row = await prisma.startingInventory.upsert({
    where: { farmId_sizeId_gradeId: { farmId, sizeId, gradeId } },
    create: { farmId, sizeId, gradeId, quantity, updatedAt: new Date() },
    update: { quantity, updatedAt: new Date() },
  });
  return json({ ok: true, row, progress: await farmProgress() });
}
