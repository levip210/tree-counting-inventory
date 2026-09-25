import { ACTIONS, type ActionType } from "../lib/constants";
import { prisma } from "../lib/prisma";
import { stripIdentity } from "../lib/guards";
import type { SessionPayload } from "../lib/session";
import { counterFromSession, farmCarriesSizeGrade } from "./miscounts";

export type IncomingCount = {
  clientSyncId: string;
  timestampLocal: string;
  action: ActionType;
  farmId?: string | null;
  farmName?: string | null;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity?: number;
  sessionId: string;
  sessionStartedAt?: string;
};

const IDENTITY_KEYS = [
  "counterName",
  "accountLabel",
  "loginNumber",
  "accountId",
  "counterId",
  "adminId",
  "email",
  "workerId",
  "workerIdentity",
  "deviceId",
  "permanentDeviceId",
  "whoCounted",
];

export function countHasIdentity(record: Record<string, unknown>): boolean {
  return IDENTITY_KEYS.some((k) => k in record && record[k] != null && record[k] !== "");
}

export function sanitizeCount(raw: Record<string, unknown>): IncomingCount | { error: string } {
  const clean = stripIdentity(raw);
  const clientSyncId = String(clean.clientSyncId || "").trim();
  const timestampLocal = String(clean.timestampLocal || "").trim();
  const action = clean.action as ActionType;
  const sizeId = String(clean.sizeId || "").trim();
  const sizeName = String(clean.sizeName || "").trim();
  const gradeId = String(clean.gradeId || "").trim();
  const gradeName = String(clean.gradeName || "").trim();
  const sessionId = String(clean.sessionId || "").trim();
  if (!clientSyncId) return { error: "Missing sync id." };
  if (!timestampLocal) return { error: "Missing local timestamp." };
  if (action !== ACTIONS.YARD && action !== ACTIONS.SHIP) return { error: "Invalid action." };
  if (!sizeId || !sizeName || !gradeId || !gradeName) return { error: "Size and grade are required." };
  if (!sessionId) return { error: "Missing session." };
  const quantity = Number(clean.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity !== 1) return { error: "Quantity must be 1." };

  if (action === ACTIONS.YARD) {
    const farmId = String(clean.farmId || "").trim();
    const farmName = String(clean.farmName || "").trim();
    if (!farmId || !farmName) return { error: "Farm is required for Yard Receiving." };
    return {
      clientSyncId,
      timestampLocal,
      action,
      farmId,
      farmName,
      sizeId,
      sizeName,
      gradeId,
      gradeName,
      quantity: 1,
      sessionId,
      sessionStartedAt: clean.sessionStartedAt ? String(clean.sessionStartedAt) : undefined,
    };
  }

  return {
    clientSyncId,
    timestampLocal,
    action,
    farmId: null,
    farmName: null,
    sizeId,
    sizeName,
    gradeId,
    gradeName,
    quantity: 1,
    sessionId,
    sessionStartedAt: clean.sessionStartedAt ? String(clean.sessionStartedAt) : undefined,
  };
}

function canWriteAction(session: SessionPayload, action: ActionType): boolean {
  if (session.role === "admin") return true;
  if (session.access === "both") return true;
  if (action === ACTIONS.YARD) return session.access === "yard";
  if (action === ACTIONS.SHIP) return session.access === "shipping";
  return false;
}

export async function syncCounts(session: SessionPayload, rawCounts: unknown[]) {
  const accepted: { clientSyncId: string; id: string; duplicate: boolean; miscount: boolean }[] = [];
  const rejected: { clientSyncId?: string; error: string }[] = [];

  for (const raw of rawCounts) {
    if (!raw || typeof raw !== "object") {
      rejected.push({ error: "Invalid count." });
      continue;
    }
    const record = raw as Record<string, unknown>;
    const sanitized = sanitizeCount(record);
    if ("error" in sanitized) {
      rejected.push({ clientSyncId: String(record.clientSyncId || ""), error: sanitized.error });
      continue;
    }
    if (!canWriteAction(session, sanitized.action)) {
      rejected.push({ clientSyncId: sanitized.clientSyncId, error: "Not allowed." });
      continue;
    }

    const existing = await prisma.countRecord.findUnique({
      where: { clientSyncId: sanitized.clientSyncId },
    });
    if (existing) {
      accepted.push({ clientSyncId: sanitized.clientSyncId, id: existing.id, duplicate: true, miscount: false });
      continue;
    }

    const existingMiscount = await prisma.miscount.findUnique({
      where: { clientSyncId: sanitized.clientSyncId },
    });
    if (existingMiscount) {
      accepted.push({
        clientSyncId: sanitized.clientSyncId,
        id: existingMiscount.id,
        duplicate: true,
        miscount: true,
      });
      continue;
    }

    if (sanitized.action === ACTIONS.YARD && sanitized.farmId) {
      const carries = await farmCarriesSizeGrade(sanitized.farmId, sanitized.sizeId, sanitized.gradeId);
      if (!carries) {
        const recorded = await recordMiscount(session, sanitized);
        accepted.push({
          clientSyncId: sanitized.clientSyncId,
          id: recorded.id,
          duplicate: false,
          miscount: true,
        });
        continue;
      }
    }

    const startedAt = sanitized.sessionStartedAt ? new Date(sanitized.sessionStartedAt) : new Date();
    await prisma.countSession.upsert({
      where: { id: sanitized.sessionId },
      create: {
        id: sanitized.sessionId,
        action: sanitized.action,
        farmId: sanitized.farmId || null,
        farmName: sanitized.farmName || null,
        startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
      },
      update: {},
    });

    const now = new Date();
    const created = await prisma.countRecord.create({
      data: {
        timestampLocal: sanitized.timestampLocal,
        timestampUtc: now,
        action: sanitized.action,
        farmId: sanitized.farmId || null,
        farmName: sanitized.farmName || null,
        sizeId: sanitized.sizeId,
        sizeName: sanitized.sizeName,
        gradeId: sanitized.gradeId,
        gradeName: sanitized.gradeName,
        quantity: 1,
        sessionId: sanitized.sessionId,
        clientSyncId: sanitized.clientSyncId,
        syncedAt: now,
      },
    });
    accepted.push({ clientSyncId: sanitized.clientSyncId, id: created.id, duplicate: false, miscount: false });
  }

  return { accepted, rejected };
}

async function recordMiscount(session: SessionPayload, sanitized: IncomingCount) {
  const [farm, size, grade] = await Promise.all([
    sanitized.farmId ? prisma.farm.findUnique({ where: { id: sanitized.farmId } }) : Promise.resolve(null),
    prisma.treeSize.findUnique({ where: { id: sanitized.sizeId } }),
    prisma.treeGrade.findUnique({ where: { id: sanitized.gradeId } }),
  ]);
  const who = counterFromSession(session);
  const now = new Date();
  return prisma.miscount.create({
    data: {
      farmId: sanitized.farmId || "",
      farmName: farm?.name || sanitized.farmName || "Farm",
      sizeId: sanitized.sizeId,
      sizeName: size?.name || sanitized.sizeName,
      gradeId: sanitized.gradeId,
      gradeName: grade?.name || sanitized.gradeName,
      counterId: who.counterId,
      counterName: who.counterName,
      counterRole: who.counterRole,
      timestampLocal: sanitized.timestampLocal,
      timestampUtc: now,
      clientSyncId: sanitized.clientSyncId,
    },
  });
}

function voidReasonText(reason: string | undefined, fallback: string) {
  const trimmed = String(reason || "").trim();
  return trimmed || fallback;
}

export async function voidCount(idOrSync: { id?: string; clientSyncId?: string }, reason?: string) {
  const where = idOrSync.id
    ? { id: idOrSync.id }
    : idOrSync.clientSyncId
      ? { clientSyncId: idOrSync.clientSyncId }
      : null;
  if (!where) return { ok: false as const, error: "Count not found." };
  const row = await prisma.countRecord.findUnique({ where });
  if (!row) return { ok: false as const, error: "Count not found." };
  if (row.voidedAt) return { ok: true as const, already: true, id: row.id };
  const updated = await prisma.countRecord.update({
    where: { id: row.id },
    data: { voidedAt: new Date(), voidReason: voidReasonText(reason, "Undo last count") },
  });
  return { ok: true as const, already: false, id: updated.id };
}

const MAX_BATCH_VOID = 200;

export function parseVoidIds(body: { id?: unknown; ids?: unknown }): string[] | { error: string } {
  const raw = Array.isArray(body.ids) ? body.ids : body.id != null && body.id !== "" ? [body.id] : [];
  const unique = [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))];
  if (unique.length === 0) return { error: "No counts selected." };
  if (unique.length > MAX_BATCH_VOID) return { error: "Too many counts selected." };
  return unique;
}

export async function voidCounts(ids: string[], reason?: string) {
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false as const, error: "No counts selected." };
  if (unique.length > MAX_BATCH_VOID) return { ok: false as const, error: "Too many counts selected." };
  const result = await prisma.countRecord.updateMany({
    where: { id: { in: unique }, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: voidReasonText(reason, "Admin correction") },
  });
  return { ok: true as const, voided: result.count, requested: unique.length };
}

export function publicCount(row: {
  id: string;
  timestampLocal: string;
  timestampUtc: Date;
  action: string;
  farmId: string | null;
  farmName: string | null;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: number;
  sessionId: string;
  createdAt: Date;
  syncedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  correctionNote: string | null;
  correctedAt: Date | null;
}) {
  return {
    countId: row.id,
    timestamp: row.timestampLocal,
    timestampUtc: row.timestampUtc.toISOString(),
    action: row.action,
    farmId: row.farmId,
    farmName: row.farmName,
    sizeId: row.sizeId,
    sizeName: row.sizeName,
    gradeId: row.gradeId,
    gradeName: row.gradeName,
    quantity: row.quantity,
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString(),
    syncedAt: row.syncedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    correctionNote: row.correctionNote,
    correctedAt: row.correctedAt?.toISOString() ?? null,
  };
}
