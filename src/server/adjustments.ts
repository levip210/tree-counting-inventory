import type { Prisma, PrismaClient } from "@prisma/client";
import { ACTIONS, type ActionType } from "../lib/constants";
import { resolveInventoryGrade } from "../lib/grade-draw";
import { yardCellNeedsFarmList } from "../lib/require-farm";
import { prisma } from "../lib/prisma";
import { localTimestamp } from "../lib/security";
import type { SessionPayload } from "../lib/session";
import { publicCount } from "./counts";

export const MAX_ADJUST_AMOUNT = 9999;

export type AdjustDirection = "add" | "remove";
export type AdjustMode = "status" | "preview" | "commit";

type CountDb = Prisma.TransactionClient | PrismaClient;

type PilePreview = {
  gradeId: string;
  gradeName: string;
  linked: boolean;
  starting: number;
  received: number;
  nextReceived: number | null;
  remaining: number | null;
  exceeded: boolean;
};

export type AdjustmentSuccess = {
  ok: true;
  mode: AdjustMode;
  summary: string | null;
  detail: string;
  current: number;
  next: number | null;
  amount: number | null;
  direction: AdjustDirection | null;
  action: ActionType;
  sizeName: string;
  gradeName: string;
  placeLabel: string;
  overPile: boolean;
  pile: PilePreview | null;
  saved?: { id: string; duplicate: boolean };
};

export type AdjustmentFailure = { ok: false; status: number; error: string };

class AdjustError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(status: number, error: string): AdjustmentFailure {
  return { ok: false, status, error };
}

function isAction(value: string): value is ActionType {
  return value === ACTIONS.YARD || value === ACTIONS.SHIP;
}

function parseAmount(value: unknown): number | null {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > MAX_ADJUST_AMOUNT) return null;
  return numeric;
}

function parseDirection(value: unknown): AdjustDirection | null {
  return value === "add" || value === "remove" ? value : null;
}

function parseRequestId(value: unknown): string | null {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return null;
  return id;
}

function signedQuantity(direction: AdjustDirection, amount: number): number {
  return direction === "add" ? amount : -amount;
}

function qtyOf(quantity: number | null | undefined): number {
  return quantity || 1;
}

async function netQuantity(db: CountDb, where: Prisma.CountRecordWhereInput): Promise<number> {
  const rows = await db.countRecord.findMany({ where, select: { quantity: true } });
  return rows.reduce((sum, row) => sum + qtyOf(row.quantity), 0);
}

function takeAwayError(current: number, sizeName: string, gradeName: string, place: string, yard: boolean): string {
  const where = yard ? `at ${place}` : `shipped to ${place}`;
  if (current <= 0) {
    return `None of ${sizeName} ${gradeName} are counted ${where}. There is nothing to take away.`;
  }
  return `Only ${current} of ${sizeName} ${gradeName} are counted ${where}. Take away ${current} or fewer.`;
}

function pileSentence(
  pile: { gradeName: string; linked: boolean; starting: number; received: number },
  nextReceived: number | null,
): string {
  const lead = pile.linked
    ? `These counts draw from the ${pile.gradeName} pile, the same way a tap does.`
    : `This uses the ${pile.gradeName} pile.`;
  const shown = nextReceived == null ? pile.received : nextReceived;
  const move =
    nextReceived == null
      ? `Received on that pile is ${pile.received} of ${pile.starting} starting.`
      : `Received on that pile goes from ${pile.received} to ${nextReceived}.`;
  const over =
    shown > pile.starting
      ? ` That is ${shown - pile.starting} over the starting ${pile.starting}.`
      : ` ${Math.max(0, pile.starting - shown)} of ${pile.starting} are still not received.`;
  return `${lead} ${move}${over}`;
}

type Ready = {
  action: ActionType;
  farm: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  size: { id: string; name: string };
  grade: { id: string; name: string };
  placeLabel: string;
  current: number;
  pile: {
    gradeId: string;
    gradeName: string;
    linked: boolean;
    starting: number;
    received: number;
  } | null;
};

async function loadReady(db: CountDb, raw: Record<string, unknown>): Promise<Ready | AdjustmentFailure> {
  const action = String(raw.action || "");
  if (!isAction(action)) return fail(400, "Choose Yard Receiving or Shipping.");

  const sizeId = String(raw.sizeId || "").trim();
  const gradeId = String(raw.gradeId || "").trim();
  if (!sizeId) return fail(400, "Choose a size.");
  if (!gradeId) return fail(400, "Choose a grade.");

  const [size, grade, grades] = await Promise.all([
    db.treeSize.findUnique({ where: { id: sizeId } }),
    db.treeGrade.findUnique({ where: { id: gradeId } }),
    db.treeGrade.findMany({ select: { id: true, name: true, requireFarm: true, drawsFromGradeId: true } }),
  ]);
  if (!size) return fail(400, "Choose a size.");
  if (!size.active) return fail(400, "That size is turned off. Turn it back on before adjusting counts.");
  if (!grade) return fail(400, "Choose a grade.");
  if (!grade.active) return fail(400, "That grade is turned off. Turn it back on before adjusting counts.");

  const resolved = resolveInventoryGrade(grade.id, grades);
  const pileGrade = grades.find((row) => row.id === resolved.inventoryGradeId) || grade;
  const linked = resolved.inventoryGradeId !== grade.id;

  let farm: { id: string; name: string } | null = null;
  let customer: { id: string; name: string } | null = null;

  if (action === ACTIONS.YARD) {
    const farmId = String(raw.farmId || "").trim();
    if (!farmId) return fail(400, "Choose a farm.");
    const row = await db.farm.findUnique({ where: { id: farmId } });
    if (!row) return fail(400, "Choose a farm.");
    if (!row.active) return fail(400, "That farm is turned off. Turn it back on before adjusting counts.");
    farm = { id: row.id, name: row.name };

    const needsList = yardCellNeedsFarmList(size.requireFarm, resolved.requireFarm);
    if (needsList) {
      const carried = await db.startingInventory.findUnique({
        where: { farmId_sizeId_gradeId: { farmId: row.id, sizeId: size.id, gradeId: pileGrade.id } },
        select: { id: true },
      });
      if (!carried) {
        if (linked) {
          return fail(
            400,
            `${row.name} does not list ${size.name} ${pileGrade.name}. ${grade.name} counts use that pile. Add it on Starting inventory, or turn off the farm requirement.`,
          );
        }
        return fail(
          400,
          `${row.name} does not list ${size.name} ${grade.name}. Add it on Starting inventory, or turn off the farm requirement for that size or grade.`,
        );
      }
    }
  } else {
    const customerId = String(raw.customerId || "").trim();
    if (!customerId) return fail(400, "Choose a customer.");
    const row = await db.customer.findUnique({ where: { id: customerId } });
    if (!row) return fail(400, "Choose a customer.");
    if (!row.active) return fail(400, "That customer is turned off. Turn them back on before adjusting counts.");
    customer = { id: row.id, name: row.name };
  }

  const current = await netQuantity(db, {
    voidedAt: null,
    action,
    sizeId: size.id,
    gradeId: grade.id,
    ...(action === ACTIONS.YARD ? { farmId: farm?.id } : { customerId: customer?.id }),
  });

  let pile: Ready["pile"] = null;
  if (action === ACTIONS.YARD && farm) {
    const inventory = await db.startingInventory.findUnique({
      where: { farmId_sizeId_gradeId: { farmId: farm.id, sizeId: size.id, gradeId: pileGrade.id } },
      select: { quantity: true },
    });
    if (inventory) {
      const drawingIds = grades
        .filter((row) => resolveInventoryGrade(row.id, grades).inventoryGradeId === pileGrade.id)
        .map((row) => row.id);
      const received = await netQuantity(db, {
        voidedAt: null,
        action: ACTIONS.YARD,
        farmId: farm.id,
        sizeId: size.id,
        gradeId: { in: [...new Set([pileGrade.id, ...drawingIds])] },
      });
      pile = {
        gradeId: pileGrade.id,
        gradeName: pileGrade.name,
        linked,
        starting: inventory.quantity,
        received,
      };
    }
  }

  return {
    action,
    farm,
    customer,
    size: { id: size.id, name: size.name },
    grade: { id: grade.id, name: grade.name },
    placeLabel: farm?.name || customer?.name || "",
    current,
    pile,
  };
}

function describe(ready: Ready, direction: AdjustDirection | null, amount: number | null): Omit<AdjustmentSuccess, "ok" | "mode" | "saved"> {
  const yard = ready.action === ACTIONS.YARD;
  const next = direction && amount != null ? ready.current + signedQuantity(direction, amount) : null;
  const nextReceived =
    ready.pile && direction && amount != null ? ready.pile.received + (yard ? signedQuantity(direction, amount) : 0) : null;
  const place = ready.placeLabel;
  const counted = yard
    ? `Counted now: ${ready.current} of ${ready.size.name} ${ready.grade.name} at ${place}.`
    : `Counted now: ${ready.current} of ${ready.size.name} ${ready.grade.name} shipped to ${place}.`;

  let summary: string | null = null;
  let detail = counted;
  if (direction && amount != null && next != null) {
    const verb = direction === "add" ? "Add" : "Take away";
    summary = yard
      ? `${verb} ${amount} × ${ready.size.name} ${ready.grade.name} at ${place}?`
      : `${verb} ${amount} × ${ready.size.name} ${ready.grade.name} shipped to ${place}?`;
    const moved = yard
      ? `Yard received for ${ready.size.name} ${ready.grade.name} at ${place} goes from ${ready.current} to ${next}.`
      : `Shipped ${ready.size.name} ${ready.grade.name} for ${place} goes from ${ready.current} to ${next}.`;
    detail = ready.pile ? `${moved} ${pileSentence(ready.pile, yard ? nextReceived : null)}` : moved;
  } else if (ready.pile) {
    detail = `${counted} ${pileSentence(ready.pile, null)}`;
  }

  const shownReceived = nextReceived == null ? ready.pile?.received ?? 0 : nextReceived;
  const overPile = Boolean(ready.pile && shownReceived > ready.pile.starting && direction === "add");

  return {
    summary,
    detail,
    current: ready.current,
    next,
    amount,
    direction,
    action: ready.action,
    sizeName: ready.size.name,
    gradeName: ready.grade.name,
    placeLabel: place,
    overPile,
    pile: ready.pile
      ? {
          ...ready.pile,
          nextReceived: direction && amount != null ? nextReceived : null,
          remaining:
            nextReceived == null
              ? Math.max(0, ready.pile.starting - ready.pile.received)
              : Math.max(0, ready.pile.starting - nextReceived),
          exceeded: shownReceived > ready.pile.starting,
        }
      : null,
  };
}

export async function listRecentAdjustments() {
  const rows = await prisma.countRecord.findMany({
    where: { adjustmentDirection: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return rows.map(publicCount);
}

export async function adminAdjustment(session: SessionPayload, raw: unknown): Promise<AdjustmentSuccess | AdjustmentFailure> {
  if (session.role !== "admin" || !session.adminId) {
    return fail(403, "Admin sign-in required.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "Invalid request.");
  const body = raw as Record<string, unknown>;
  const mode = body.mode;
  if (mode !== "status" && mode !== "preview" && mode !== "commit") return fail(400, "Invalid request.");

  const direction = parseDirection(body.direction);
  const amount = parseAmount(body.amount);
  if (mode !== "status") {
    if (!direction) return fail(400, "Choose add or take away.");
    if (amount == null) return fail(400, `Enter a whole number from 1 to ${MAX_ADJUST_AMOUNT}.`);
  }

  if (mode !== "commit") {
    const ready = await loadReady(prisma, body);
    if ("error" in ready) return ready;
    if (direction && amount != null && direction === "remove" && ready.current - amount < 0) {
      return fail(400, takeAwayError(ready.current, ready.size.name, ready.grade.name, ready.placeLabel, ready.action === ACTIONS.YARD));
    }
    return { ok: true, mode, ...describe(ready, direction, amount) };
  }

  const clientRequestId = parseRequestId(body.clientRequestId);
  if (!clientRequestId || !direction || amount == null) {
    return fail(400, "Missing confirmation. Start the adjustment again.");
  }

  const adminId = session.adminId;
  const adminName = String(session.name || "Admin").trim().slice(0, 80) || "Admin";
  const now = new Date();
  const sessionId = `adj-${clientRequestId}`;

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.countRecord.findUnique({ where: { clientSyncId: clientRequestId } });
      if (existing) {
        const same =
          existing.adjustmentDirection === direction &&
          existing.quantity === signedQuantity(direction, amount) &&
          existing.action === String(body.action || "") &&
          existing.sizeId === String(body.sizeId || "").trim() &&
          existing.gradeId === String(body.gradeId || "").trim() &&
          (existing.farmId || "") === String(body.farmId || "").trim() &&
          (existing.customerId || "") === String(body.customerId || "").trim();
        if (!same) throw new AdjustError(409, "That adjustment was already saved with different details. Start again.");
        const ready = await loadReady(tx, body);
        const described =
          "error" in ready
            ? describe(
                {
                  action: existing.action === ACTIONS.SHIP ? ACTIONS.SHIP : ACTIONS.YARD,
                  farm: existing.farmId ? { id: existing.farmId, name: existing.farmName || "Farm" } : null,
                  customer: existing.customerId ? { id: existing.customerId, name: existing.customerName || "Customer" } : null,
                  size: { id: existing.sizeId, name: existing.sizeName },
                  grade: { id: existing.gradeId, name: existing.gradeName },
                  placeLabel: existing.farmName || existing.customerName || "",
                  current: existing.quantity,
                  pile: null,
                },
                direction,
                amount,
              )
            : describe(ready, direction, amount);
        return { id: existing.id, duplicate: true, described };
      }

      const ready = await loadReady(tx, body);
      if ("error" in ready) throw new AdjustError(ready.status, ready.error);
      const signed = signedQuantity(direction, amount);
      if (direction === "remove" && ready.current + signed < 0) {
        throw new AdjustError(
          400,
          takeAwayError(ready.current, ready.size.name, ready.grade.name, ready.placeLabel, ready.action === ACTIONS.YARD),
        );
      }

      await tx.countSession.create({
        data: {
          id: sessionId,
          action: ready.action,
          farmId: ready.farm?.id || null,
          farmName: ready.farm?.name || null,
          customerId: ready.customer?.id || null,
          customerName: ready.customer?.name || null,
          startedAt: now,
          endedAt: now,
        },
      });
      const created = await tx.countRecord.create({
        data: {
          timestampLocal: localTimestamp(now),
          timestampUtc: now,
          action: ready.action,
          farmId: ready.farm?.id || null,
          farmName: ready.farm?.name || null,
          customerId: ready.customer?.id || null,
          customerName: ready.customer?.name || null,
          sizeId: ready.size.id,
          sizeName: ready.size.name,
          gradeId: ready.grade.id,
          gradeName: ready.grade.name,
          quantity: signed,
          sessionId,
          clientSyncId: clientRequestId,
          syncedAt: now,
          correctionNote: `Admin number pad · ${direction === "add" ? "add" : "take away"} ${amount} · ${adminName}`,
          adjustmentDirection: direction,
          adjustedByAdminId: adminId,
          adjustedByName: adminName,
        },
      });

      const bucket = {
        voidedAt: null,
        action: ready.action,
        sizeId: ready.size.id,
        gradeId: ready.grade.id,
        ...(ready.action === ACTIONS.YARD ? { farmId: ready.farm?.id } : { customerId: ready.customer?.id }),
      };
      const after = await netQuantity(tx, bucket);
      if (after < 0) {
        const before = after - signed;
        throw new AdjustError(
          400,
          takeAwayError(before, ready.size.name, ready.grade.name, ready.placeLabel, ready.action === ACTIONS.YARD),
        );
      }
      return { id: created.id, duplicate: false, described: describe(ready, direction, amount) };
    });
    return { ok: true, mode: "commit", ...saved.described, saved: { id: saved.id, duplicate: saved.duplicate } };
  } catch (err) {
    if (err instanceof AdjustError) return fail(err.status, err.message);
    throw err;
  }
}
