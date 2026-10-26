import { prisma } from "../lib/prisma";
import { toCsv } from "../lib/security";
import { buildBackupDocument } from "./backup-document";
import { publicCount } from "./counts";

const COUNT_COLUMNS = [
  "CountID",
  "Timestamp",
  "Action",
  "FarmID",
  "FarmName",
  "CustomerID",
  "CustomerName",
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
      CustomerID: pub.customerId ?? "",
      CustomerName: pub.customerName ?? "",
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
  return buildBackupDocument();
}
