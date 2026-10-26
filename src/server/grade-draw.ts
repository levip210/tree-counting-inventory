import { prisma } from "../lib/prisma";
import { requireFarmOn } from "../lib/require-farm";
import { resolveInventoryGrade, type GradeDrawRow } from "../lib/grade-draw";

export function isMissingDrawColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("drawsFromGradeId");
}

function isSchemaDrift(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("drawsFromGradeId") || message.includes("requireFarm") || message.includes("P2022");
}

/**
 * Every grade, with a draws-from link when the column exists.
 * A database that has not been migrated yet returns no links, so Scale free
 * keeps today's behavior until the column is added.
 */
export async function loadGradeDraws(): Promise<GradeDrawRow[]> {
  try {
    return await prisma.treeGrade.findMany({
      select: { id: true, requireFarm: true, drawsFromGradeId: true },
    });
  } catch (err) {
    if (!isSchemaDrift(err)) throw err;
  }
  try {
    const rows = await prisma.treeGrade.findMany({
      select: { id: true, requireFarm: true },
    });
    return rows.map((row) => ({ ...row, drawsFromGradeId: null }));
  } catch (err) {
    if (!isSchemaDrift(err)) throw err;
  }
  const rows = await prisma.treeGrade.findMany({ select: { id: true } });
  return rows.map((row) => ({ id: row.id, requireFarm: true, drawsFromGradeId: null }));
}

export async function annotateGrades<T extends { id: string; requireFarm?: boolean }>(rows: T[]) {
  const draws = await loadGradeDraws();
  return rows.map((row) => {
    const resolved = resolveInventoryGrade(row.id, draws);
    const linked = resolved.inventoryGradeId !== row.id;
    return {
      ...row,
      drawsFromGradeId: linked ? resolved.inventoryGradeId : null,
      inventoryRequireFarm: requireFarmOn(linked ? resolved.requireFarm : row.requireFarm),
    };
  });
}

export async function clearIncomingDraws(gradeId: string) {
  try {
    await prisma.treeGrade.updateMany({
      where: { drawsFromGradeId: gradeId },
      data: { drawsFromGradeId: null, updatedAt: new Date() },
    });
  } catch (err) {
    if (!isMissingDrawColumn(err)) throw err;
  }
}
