import { prisma } from "../lib/prisma";
import type { SessionPayload } from "../lib/session";

export type MiscountView = {
  id: string;
  farmId: string;
  farmName: string;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  counterId: string;
  counterName: string;
  counterRole: string;
  timestampLocal: string;
  timestampUtc: string;
  createdAt: string;
};

export function canReviewMiscounts(session: SessionPayload | null): boolean {
  return session?.role === "admin";
}

export function counterFromSession(session: SessionPayload): {
  counterId: string;
  counterName: string;
  counterRole: "admin" | "counter";
} {
  if (session.role === "admin") {
    return {
      counterId: session.adminId || "admin",
      counterName: session.name || "Admin",
      counterRole: "admin",
    };
  }
  return {
    counterId: session.counterId || "counter",
    counterName: session.name || "Counter",
    counterRole: "counter",
  };
}

/** A farm carries a size/grade when that combo exists on starting inventory (same list as farm history). */
export async function farmCarriesSizeGrade(farmId: string, sizeId: string, gradeId: string): Promise<boolean> {
  const row = await prisma.startingInventory.findUnique({
    where: { farmId_sizeId_gradeId: { farmId, sizeId, gradeId } },
    select: { id: true },
  });
  return row != null;
}

export function publicMiscount(row: {
  id: string;
  farmId: string;
  farmName: string;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  counterId: string;
  counterName: string;
  counterRole: string;
  timestampLocal: string;
  timestampUtc: Date;
  createdAt: Date;
}): MiscountView {
  return {
    id: row.id,
    farmId: row.farmId,
    farmName: row.farmName,
    sizeId: row.sizeId,
    sizeName: row.sizeName,
    gradeId: row.gradeId,
    gradeName: row.gradeName,
    counterId: row.counterId,
    counterName: row.counterName,
    counterRole: row.counterRole,
    timestampLocal: row.timestampLocal,
    timestampUtc: row.timestampUtc.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMiscounts(): Promise<MiscountView[]> {
  const rows = await prisma.miscount.findMany({
    orderBy: [{ timestampUtc: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(publicMiscount);
}

/** Permanently removes the miscount row. Does not read or write live farm counts. */
export async function deleteMiscount(id: string) {
  const trimmed = String(id || "").trim();
  if (!trimmed) return { ok: false as const, error: "Miscount not found." };
  const row = await prisma.miscount.findUnique({ where: { id: trimmed }, select: { id: true } });
  if (!row) return { ok: false as const, error: "Miscount not found." };
  await prisma.miscount.delete({ where: { id: row.id } });
  return { ok: true as const, id: row.id };
}
