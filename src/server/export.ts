import { prisma } from "../lib/prisma";
import { toCsv } from "../lib/security";
import { publicCount } from "./counts";

const COUNT_COLUMNS = [
  "CountID",
  "Timestamp",
  "Action",
  "FarmID",
  "FarmName",
  "SizeID",
  "SizeName",
  "GradeID",
  "GradeName",
  "Quantity",
  "SessionID",
  "CreatedAt",
  "SyncedAt",
  "VoidedAt",
  "VoidReason",
  "CorrectionNote",
];

export async function countingExportRows(includeVoided = false) {
  const rows = await prisma.countRecord.findMany({
    where: includeVoided ? {} : { voidedAt: null },
    orderBy: { timestampUtc: "asc" },
  });
  return rows.map((row) => {
    const pub = publicCount(row);
    return {
      CountID: pub.countId,
      Timestamp: pub.timestamp,
      Action: pub.action,
      FarmID: pub.farmId ?? "",
      FarmName: pub.farmName ?? "",
      SizeID: pub.sizeId,
      SizeName: pub.sizeName,
      GradeID: pub.gradeId,
      GradeName: pub.gradeName,
      Quantity: pub.quantity,
      SessionID: pub.sessionId,
      CreatedAt: pub.createdAt,
      SyncedAt: pub.syncedAt ?? "",
      VoidedAt: pub.voidedAt ?? "",
      VoidReason: pub.voidReason ?? "",
      CorrectionNote: pub.correctionNote ?? "",
    };
  });
}

export async function inventoryExportRows() {
  const rows = await prisma.startingInventory.findMany({
    include: { farm: true, size: true, grade: true },
    orderBy: [{ farm: { displayOrder: "asc" } }, { size: { displayOrder: "asc" } }, { grade: { displayOrder: "asc" } }],
  });
  return rows.map((row) => ({
    FarmID: row.farmId,
    FarmName: row.farm.name,
    SizeID: row.sizeId,
    SizeName: row.size.name,
    GradeID: row.gradeId,
    GradeName: row.grade.name,
    StartingQuantity: row.quantity,
    UpdatedAt: row.updatedAt.toISOString(),
  }));
}

export async function exportCountsCsv(includeVoided = false) {
  return toCsv(await countingExportRows(includeVoided), COUNT_COLUMNS);
}

export async function exportCountsJson(includeVoided = false) {
  return JSON.stringify({ records: await countingExportRows(includeVoided) }, null, 2);
}

export async function exportInventoryCsv() {
  return toCsv(await inventoryExportRows(), [
    "FarmID",
    "FarmName",
    "SizeID",
    "SizeName",
    "GradeID",
    "GradeName",
    "StartingQuantity",
    "UpdatedAt",
  ]);
}

export async function exportInventoryJson() {
  return JSON.stringify({ startingInventory: await inventoryExportRows() }, null, 2);
}

export async function backupTables() {
  const [counts, farms, sizes, grades, sessions, inventory, counters, admins, settings] = await Promise.all([
    prisma.countRecord.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.farm.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.countSession.findMany({ orderBy: { startedAt: "asc" } }),
    prisma.startingInventory.findMany(),
    prisma.counterAccount.findMany({
      select: {
        id: true,
        accountLabel: true,
        active: true,
        access: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.adminAccount.findMany({
      select: { id: true, name: true, email: true, createdAt: true, updatedAt: true },
    }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    note: "Backup excludes password hashes, PIN hashes, PIN keys, and Excel API key hashes.",
    counts: counts.map((c) => ({
      CountID: c.id,
      Timestamp: c.timestampLocal,
      TimestampUtc: c.timestampUtc.toISOString(),
      Action: c.action,
      FarmID: c.farmId,
      FarmName: c.farmName,
      SizeID: c.sizeId,
      SizeName: c.sizeName,
      GradeID: c.gradeId,
      GradeName: c.gradeName,
      Quantity: c.quantity,
      SessionID: c.sessionId,
      ClientSyncId: c.clientSyncId,
      CreatedAt: c.createdAt.toISOString(),
      SyncedAt: c.syncedAt?.toISOString() ?? "",
      VoidedAt: c.voidedAt?.toISOString() ?? "",
      VoidReason: c.voidReason ?? "",
      CorrectionNote: c.correctionNote ?? "",
    })),
    farms,
    sizes,
    grades,
    sessions,
    startingInventory: inventory,
    counterAccounts: counters,
    adminAccounts: admins,
    settings: settings
      ? {
          excelEnabled: settings.excelEnabled,
          soundEnabled: settings.soundEnabled,
          vibrationEnabled: settings.vibrationEnabled,
          setupLocked: settings.setupLocked,
          checklistDismissed: settings.checklistDismissed,
        }
      : null,
  };
}
