/** A grade may draw yard counts from another grade's starting-inventory pile. */

export type GradeDrawRow = {
  id: string;
  requireFarm?: unknown;
  drawsFromGradeId?: string | null;
};

export type YardGuardGrade = {
  id: string;
  requireFarm?: unknown;
  drawsFromGradeId?: string | null;
  /** requireFarm of the pile grade. Sent by the catalog when a link is set. */
  inventoryRequireFarm?: unknown;
};

export type PileProgress = {
  farmId: string;
  sizeId: string;
  gradeId: string;
  starting: number;
  received: number;
  notYetReceived: number;
  exceeded: boolean;
};

export function normalizeDrawId(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

/**
 * One hop. Counts of `gradeId` use `drawsFromGradeId` when that id is a different
 * grade in the list. The target's own link is not followed. A missing target
 * is ignored so a stale id behaves like no link.
 */
export function resolveInventoryGrade(
  gradeId: string,
  grades: GradeDrawRow[],
): { inventoryGradeId: string; requireFarm: unknown } {
  const self = grades.find((grade) => grade.id === gradeId);
  const targetId = normalizeDrawId(self?.drawsFromGradeId);
  if (!self || !targetId || targetId === gradeId) {
    return { inventoryGradeId: gradeId, requireFarm: self?.requireFarm };
  }
  const target = grades.find((grade) => grade.id === targetId);
  if (!target) {
    return { inventoryGradeId: gradeId, requireFarm: self.requireFarm };
  }
  return { inventoryGradeId: target.id, requireFarm: target.requireFarm };
}

/** Catalog rows already carry the server-resolved pile id and its require-farm flag. */
export function yardGuardForGrade(grade: YardGuardGrade): { inventoryGradeId: string; requireFarm: unknown } {
  const targetId = normalizeDrawId(grade.drawsFromGradeId);
  if (!targetId || targetId === grade.id) {
    return { inventoryGradeId: grade.id, requireFarm: grade.requireFarm };
  }
  return {
    inventoryGradeId: targetId,
    requireFarm: grade.inventoryRequireFarm ?? true,
  };
}

/** Move received/remaining/exceeded on one farm+size inventory pile. */
export function applyPileDelta<T extends PileProgress>(
  rows: T[],
  farmId: string,
  sizeId: string,
  inventoryGradeId: string,
  delta: number,
): T[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.farmId !== farmId || row.sizeId !== sizeId || row.gradeId !== inventoryGradeId) return row;
    changed = true;
    const received = row.received + delta;
    return {
      ...row,
      received,
      notYetReceived: Math.max(0, row.starting - received),
      exceeded: received > row.starting,
    };
  });
  return changed ? next : rows;
}

export function validateDrawTarget(
  gradeId: string,
  targetId: string | null,
  grades: { id: string; drawsFromGradeId?: string | null }[],
): { ok: true; drawsFromGradeId: string | null } | { ok: false; error: string } {
  const target = normalizeDrawId(targetId);
  if (!target) return { ok: true, drawsFromGradeId: null };
  if (target === gradeId) return { ok: false, error: "A grade cannot draw from itself." };
  const row = grades.find((grade) => grade.id === target);
  if (!row) return { ok: false, error: "That grade was not found." };
  const rowTarget = normalizeDrawId(row.drawsFromGradeId);
  if (rowTarget && rowTarget !== row.id) {
    return { ok: false, error: "Choose a grade that uses its own starting inventory." };
  }
  const usedAsPile = grades.some((grade) => normalizeDrawId(grade.drawsFromGradeId) === gradeId);
  if (usedAsPile) {
    return { ok: false, error: "Other grades draw from this one. Clear those links first." };
  }
  return { ok: true, drawsFromGradeId: row.id };
}
