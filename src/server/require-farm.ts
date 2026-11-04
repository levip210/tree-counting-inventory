import { resolveInventoryGrade } from "../lib/grade-draw";
import { requireFarmOn, yardCellNeedsFarmList } from "../lib/require-farm";
import { prisma } from "../lib/prisma";
import { loadGradeDraws } from "./grade-draw";

export async function yardCellNeedsFarmRecord(sizeId: string, gradeId: string): Promise<boolean> {
  try {
    const [size, grades] = await Promise.all([
      prisma.treeSize.findUnique({ where: { id: sizeId }, select: { requireFarm: true } }),
      loadGradeDraws(),
    ]);
    const resolved = resolveInventoryGrade(gradeId, grades);
    return yardCellNeedsFarmList(size?.requireFarm, resolved.requireFarm);
  } catch {
    return true;
  }
}

export async function attachRequireFarm<T extends { id: string }>(
  kind: "size" | "grade",
  rows: T[],
): Promise<(T & { requireFarm: boolean })[]> {
  try {
    const flags =
      kind === "size"
        ? await prisma.treeSize.findMany({ select: { id: true, requireFarm: true } })
        : await prisma.treeGrade.findMany({ select: { id: true, requireFarm: true } });
    const byId = new Map(flags.map((row) => [row.id, requireFarmOn(row.requireFarm)]));
    return rows.map((row) => ({ ...row, requireFarm: byId.get(row.id) ?? true }));
  } catch {
    return rows.map((row) => ({ ...row, requireFarm: true }));
  }
}
