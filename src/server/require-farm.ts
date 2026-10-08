import { requireFarmOn, yardCellNeedsFarmList } from "../lib/require-farm";
import { prisma } from "../lib/prisma";

export async function yardCellNeedsFarmRecord(sizeId: string, gradeId: string): Promise<boolean> {
  try {
    const [size, grade] = await Promise.all([
      prisma.treeSize.findUnique({ where: { id: sizeId }, select: { requireFarm: true } }),
      prisma.treeGrade.findUnique({ where: { id: gradeId }, select: { requireFarm: true } }),
    ]);
    return yardCellNeedsFarmList(size?.requireFarm, grade?.requireFarm);
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
