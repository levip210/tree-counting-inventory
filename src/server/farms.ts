import { prisma } from "../lib/prisma";

/** Counts that still block farm delete / rename warnings. Voided history is ignored. */
export function activeFarmCountWhere(farmId: string) {
  return { farmId, voidedAt: null };
}

export async function countActiveFarmCounts(farmId: string) {
  return prisma.countRecord.count({ where: activeFarmCountWhere(farmId) });
}

async function pruneEmptySessions(sessionIds: string[]) {
  const unique = [...new Set(sessionIds.filter(Boolean))];
  for (const sessionId of unique) {
    const leftover = await prisma.countRecord.count({ where: { sessionId } });
    if (leftover === 0) {
      await prisma.countSession.delete({ where: { id: sessionId } });
    }
  }
}

export async function deleteOrDeactivateFarm(id: string) {
  const farm = await prisma.farm.findUnique({ where: { id } });
  if (!farm) return { ok: false as const, status: 404, error: "Farm not found." };

  const used = await countActiveFarmCounts(id);
  if (used > 0) {
    await prisma.farm.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
    return {
      ok: true as const,
      deactivated: true as const,
      message: "Farm has active saved counts, so it was deactivated instead of deleted.",
    };
  }

  const leftoverRows = await prisma.countRecord.findMany({
    where: { farmId: id },
    select: { sessionId: true },
  });
  await prisma.countRecord.deleteMany({ where: { farmId: id } });
  await pruneEmptySessions(leftoverRows.map((row) => row.sessionId));
  await prisma.startingInventory.deleteMany({ where: { farmId: id } });
  await prisma.farm.delete({ where: { id } });
  return { ok: true as const, deleted: true as const };
}
