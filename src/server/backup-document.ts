import { prisma } from "../lib/prisma";

export const BACKUP_VERSION = 1;

const SECRET_KEY = /password|pinhash|pinkey|apikey|secret|private_key|access_token|refresh_token|tokenhash/i;

export type BackupFarm = {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BackupCustomer = BackupFarm;

export type BackupSize = BackupFarm & {
  color: string | null;
  requireFarm: boolean;
};

export type BackupGrade = BackupFarm & {
  requireFarm: boolean;
  /** Null when this grade uses its own starting inventory. Omitted on older backups. */
  drawsFromGradeId: string | null;
};

export type BackupInventory = {
  id: string;
  farmId: string;
  farmName: string;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: number;
  updatedAt: string;
};

export type BackupSession = {
  id: string;
  action: string;
  farmId: string | null;
  farmName: string | null;
  customerId: string | null;
  customerName: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
};

export type BackupCount = {
  id: string;
  timestampLocal: string;
  timestampUtc: string;
  action: string;
  farmId: string | null;
  farmName: string | null;
  customerId: string | null;
  customerName: string | null;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: number;
  sessionId: string;
  clientSyncId: string;
  createdAt: string;
  syncedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  correctionNote: string | null;
  correctedAt: string | null;
};

export type BackupMiscount = {
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
  clientSyncId: string;
  createdAt: string;
};

export type BackupCounter = {
  id: string;
  accountLabel: string;
  active: boolean;
  access: string;
  countHand: string;
  createdAt: string;
  updatedAt: string;
};

export type BackupAdmin = {
  id: string;
  name: string;
  email: string;
  countHand: string;
  createdAt: string;
  updatedAt: string;
};

export type BackupSettings = {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  checklistDismissed: boolean;
  checklistJson: string;
  excelEnabled: boolean;
  setupLocked: boolean;
};

export type BackupDocument = {
  backupVersion: typeof BACKUP_VERSION;
  generatedAt: string;
  note: string;
  farms: BackupFarm[];
  customers: BackupCustomer[];
  sizes: BackupSize[];
  grades: BackupGrade[];
  startingInventory: BackupInventory[];
  sessions: BackupSession[];
  counts: BackupCount[];
  miscounts: BackupMiscount[];
  counterAccounts: BackupCounter[];
  adminAccounts: BackupAdmin[];
  settings: BackupSettings | null;
};

const NOTE =
  "Backup excludes password hashes, PIN hashes, PIN keys, and API key hashes. Restore replaces operational data and keeps the current admin and counter accounts.";

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function assertNoSecretFields(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(`Refusing to export secret field ${key}`);
    }
    assertNoSecretFields(child, `${path}.${key}`);
  }
}

export async function buildBackupDocument(now = new Date()): Promise<BackupDocument> {
  const [farms, customers, sizes, grades, inventory, sessions, counts, miscounts, counters, admins, settings] =
    await Promise.all([
      prisma.farm.findMany({ orderBy: { displayOrder: "asc" } }),
      prisma.customer.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
      prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } }),
      prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } }),
      prisma.startingInventory.findMany({ include: { farm: true, size: true, grade: true } }),
      prisma.countSession.findMany({ orderBy: { startedAt: "asc" } }),
      prisma.countRecord.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.miscount.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.counterAccount.findMany({
        select: {
          id: true,
          accountLabel: true,
          active: true,
          access: true,
          countHand: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { accountLabel: "asc" },
      }),
      prisma.adminAccount.findMany({
        select: { id: true, name: true, email: true, countHand: true, createdAt: true, updatedAt: true },
        orderBy: { email: "asc" },
      }),
      prisma.appSettings.findUnique({ where: { id: "default" } }),
    ]);

  const doc: BackupDocument = {
    backupVersion: BACKUP_VERSION,
    generatedAt: now.toISOString(),
    note: NOTE,
    farms: farms.map((row) => ({
      id: row.id,
      name: row.name,
      displayOrder: row.displayOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    customers: customers.map((row) => ({
      id: row.id,
      name: row.name,
      displayOrder: row.displayOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    sizes: sizes.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      requireFarm: row.requireFarm,
      displayOrder: row.displayOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    grades: grades.map((row) => ({
      id: row.id,
      name: row.name,
      requireFarm: row.requireFarm,
      drawsFromGradeId: row.drawsFromGradeId,
      displayOrder: row.displayOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    startingInventory: inventory.map((row) => ({
      id: row.id,
      farmId: row.farmId,
      farmName: row.farm.name,
      sizeId: row.sizeId,
      sizeName: row.size.name,
      gradeId: row.gradeId,
      gradeName: row.grade.name,
      quantity: row.quantity,
      updatedAt: row.updatedAt.toISOString(),
    })),
    sessions: sessions.map((row) => ({
      id: row.id,
      action: row.action,
      farmId: row.farmId,
      farmName: row.farmName,
      customerId: row.customerId,
      customerName: row.customerName,
      startedAt: row.startedAt.toISOString(),
      endedAt: iso(row.endedAt),
      createdAt: row.createdAt.toISOString(),
    })),
    counts: counts.map((row) => ({
      id: row.id,
      timestampLocal: row.timestampLocal,
      timestampUtc: row.timestampUtc.toISOString(),
      action: row.action,
      farmId: row.farmId,
      farmName: row.farmName,
      customerId: row.customerId,
      customerName: row.customerName,
      sizeId: row.sizeId,
      sizeName: row.sizeName,
      gradeId: row.gradeId,
      gradeName: row.gradeName,
      quantity: row.quantity,
      sessionId: row.sessionId,
      clientSyncId: row.clientSyncId,
      createdAt: row.createdAt.toISOString(),
      syncedAt: iso(row.syncedAt),
      voidedAt: iso(row.voidedAt),
      voidReason: row.voidReason,
      correctionNote: row.correctionNote,
      correctedAt: iso(row.correctedAt),
    })),
    miscounts: miscounts.map((row) => ({
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
      clientSyncId: row.clientSyncId,
      createdAt: row.createdAt.toISOString(),
    })),
    counterAccounts: counters.map((row) => ({
      id: row.id,
      accountLabel: row.accountLabel,
      active: row.active,
      access: row.access,
      countHand: row.countHand,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    adminAccounts: admins.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      countHand: row.countHand,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    settings: settings
      ? {
          soundEnabled: settings.soundEnabled,
          vibrationEnabled: settings.vibrationEnabled,
          checklistDismissed: settings.checklistDismissed,
          checklistJson: settings.checklistJson,
          excelEnabled: settings.excelEnabled,
          setupLocked: settings.setupLocked,
        }
      : null,
  };
  assertNoSecretFields(doc);
  return doc;
}

export type OperationalExport = {
  exportedAt: string;
  farms: BackupFarm[];
  customers: BackupCustomer[];
  sizes: BackupSize[];
  grades: BackupGrade[];
  startingInventory: BackupInventory[];
  sessions: BackupSession[];
  counts: BackupCount[];
  miscounts: BackupMiscount[];
};

export async function buildOperationalExport(now = new Date()): Promise<OperationalExport> {
  const doc = await buildBackupDocument(now);
  const payload: OperationalExport = {
    exportedAt: now.toISOString(),
    farms: doc.farms,
    customers: doc.customers,
    sizes: doc.sizes,
    grades: doc.grades,
    startingInventory: doc.startingInventory,
    sessions: doc.sessions,
    counts: doc.counts,
    miscounts: doc.miscounts,
  };
  assertNoSecretFields(payload);
  return payload;
}

type ParseResult = { ok: true; doc: BackupDocument } | { ok: false; error: string };

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reqString(row: Record<string, unknown>, key: string, label: string): string | ParseResult {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) return fail(`${label} is missing ${key}.`);
  if (value.length > 500) return fail(`${label} has a ${key} that is too long.`);
  return value;
}

function optString(row: Record<string, unknown>, key: string, label: string): string | null | ParseResult {
  const value = row[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") return fail(`${label} has an invalid ${key}.`);
  if (value.length > 2000) return fail(`${label} has a ${key} that is too long.`);
  return value;
}

function reqBool(row: Record<string, unknown>, key: string, label: string): boolean | ParseResult {
  if (typeof row[key] !== "boolean") return fail(`${label} is missing ${key}.`);
  return row[key] as boolean;
}

function reqInt(row: Record<string, unknown>, key: string, label: string): number | ParseResult {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
    return fail(`${label} has an invalid ${key}.`);
  }
  return value;
}

function reqDate(row: Record<string, unknown>, key: string, label: string): string | ParseResult {
  const value = row[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fail(`${label} has an invalid ${key}.`);
  return new Date(value).toISOString();
}

function optDrawId(row: Record<string, unknown>, label: string): string | null | ParseResult {
  if (!("drawsFromGradeId" in row) || row.drawsFromGradeId == null || row.drawsFromGradeId === "") return null;
  if (typeof row.drawsFromGradeId !== "string") return fail(`${label} has an invalid drawsFromGradeId.`);
  const value = row.drawsFromGradeId.trim();
  if (!value) return null;
  if (value.length > 200) return fail(`${label} has a drawsFromGradeId that is too long.`);
  return value;
}

function optDate(row: Record<string, unknown>, key: string, label: string): string | null | ParseResult {
  const value = row[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fail(`${label} has an invalid ${key}.`);
  return new Date(value).toISOString();
}

function isFail(value: unknown): value is ParseResult {
  return Boolean(value) && typeof value === "object" && (value as ParseResult).ok === false;
}

function takeArray(raw: Record<string, unknown>, key: string): unknown[] | ParseResult {
  const value = raw[key];
  if (!Array.isArray(value)) return fail(`Backup is missing ${key}.`);
  if (value.length > 100_000) return fail(`Backup ${key} is too large.`);
  return value;
}

function uniqueIds(ids: string[], label: string): ParseResult | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return fail(`Two ${label} rows use the same id.`);
    seen.add(id);
  }
  return null;
}

export function parseBackupDocument(input: unknown): ParseResult {
  if (!isRecord(input)) return fail("This file is not a Powers Tree Farm backup.");
  if (input.backupVersion !== BACKUP_VERSION) return fail("This file is not a Powers Tree Farm backup.");

  const farmsRaw = takeArray(input, "farms");
  if (isFail(farmsRaw)) return farmsRaw;
  const customersRaw = takeArray(input, "customers");
  if (isFail(customersRaw)) return customersRaw;
  const sizesRaw = takeArray(input, "sizes");
  if (isFail(sizesRaw)) return sizesRaw;
  const gradesRaw = takeArray(input, "grades");
  if (isFail(gradesRaw)) return gradesRaw;
  const inventoryRaw = takeArray(input, "startingInventory");
  if (isFail(inventoryRaw)) return inventoryRaw;
  const sessionsRaw = takeArray(input, "sessions");
  if (isFail(sessionsRaw)) return sessionsRaw;
  const countsRaw = takeArray(input, "counts");
  if (isFail(countsRaw)) return countsRaw;
  const miscountsRaw = takeArray(input, "miscounts");
  if (isFail(miscountsRaw)) return miscountsRaw;
  const countersRaw = takeArray(input, "counterAccounts");
  if (isFail(countersRaw)) return countersRaw;
  const adminsRaw = takeArray(input, "adminAccounts");
  if (isFail(adminsRaw)) return adminsRaw;

  const farms: BackupFarm[] = [];
  for (let i = 0; i < farmsRaw.length; i++) {
    const label = `Farm row ${i + 1}`;
    if (!isRecord(farmsRaw[i])) return fail(`${label} is not an object.`);
    const row = farmsRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const name = reqString(row, "name", label);
    if (isFail(name)) return name;
    const displayOrder = reqInt(row, "displayOrder", label);
    if (isFail(displayOrder)) return displayOrder;
    const active = reqBool(row, "active", label);
    if (isFail(active)) return active;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    farms.push({ id, name, displayOrder, active, createdAt, updatedAt });
  }
  const farmDup = uniqueIds(farms.map((row) => row.id), "farm");
  if (farmDup) return farmDup;

  const customers: BackupCustomer[] = [];
  for (let i = 0; i < customersRaw.length; i++) {
    const label = `Customer row ${i + 1}`;
    if (!isRecord(customersRaw[i])) return fail(`${label} is not an object.`);
    const row = customersRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const name = reqString(row, "name", label);
    if (isFail(name)) return name;
    const displayOrder = reqInt(row, "displayOrder", label);
    if (isFail(displayOrder)) return displayOrder;
    const active = reqBool(row, "active", label);
    if (isFail(active)) return active;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    customers.push({ id, name, displayOrder, active, createdAt, updatedAt });
  }
  const customerDup = uniqueIds(customers.map((row) => row.id), "customer");
  if (customerDup) return customerDup;

  const sizes: BackupSize[] = [];
  for (let i = 0; i < sizesRaw.length; i++) {
    const label = `Size row ${i + 1}`;
    if (!isRecord(sizesRaw[i])) return fail(`${label} is not an object.`);
    const row = sizesRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const name = reqString(row, "name", label);
    if (isFail(name)) return name;
    const color = optString(row, "color", label);
    if (isFail(color)) return color;
    const requireFarm = reqBool(row, "requireFarm", label);
    if (isFail(requireFarm)) return requireFarm;
    const displayOrder = reqInt(row, "displayOrder", label);
    if (isFail(displayOrder)) return displayOrder;
    const active = reqBool(row, "active", label);
    if (isFail(active)) return active;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    sizes.push({ id, name, color, requireFarm, displayOrder, active, createdAt, updatedAt });
  }
  const sizeDup = uniqueIds(sizes.map((row) => row.id), "size");
  if (sizeDup) return sizeDup;

  const grades: BackupGrade[] = [];
  for (let i = 0; i < gradesRaw.length; i++) {
    const label = `Grade row ${i + 1}`;
    if (!isRecord(gradesRaw[i])) return fail(`${label} is not an object.`);
    const row = gradesRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const name = reqString(row, "name", label);
    if (isFail(name)) return name;
    const requireFarm = reqBool(row, "requireFarm", label);
    if (isFail(requireFarm)) return requireFarm;
    const drawsFromGradeId = optDrawId(row, label);
    if (isFail(drawsFromGradeId)) return drawsFromGradeId;
    const displayOrder = reqInt(row, "displayOrder", label);
    if (isFail(displayOrder)) return displayOrder;
    const active = reqBool(row, "active", label);
    if (isFail(active)) return active;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    grades.push({ id, name, requireFarm, drawsFromGradeId, displayOrder, active, createdAt, updatedAt });
  }
  const gradeDup = uniqueIds(grades.map((row) => row.id), "grade");
  if (gradeDup) return gradeDup;
  const gradeIdsForDraw = new Set(grades.map((row) => row.id));
  for (const grade of grades) {
    if (!grade.drawsFromGradeId) continue;
    if (grade.drawsFromGradeId === grade.id) return fail(`Grade ${grade.name} cannot draw from itself.`);
    if (!gradeIdsForDraw.has(grade.drawsFromGradeId)) {
      return fail(`Grade ${grade.name} draws from a grade that is not in this file.`);
    }
  }

  const farmIds = new Set(farms.map((row) => row.id));
  const sizeIds = new Set(sizes.map((row) => row.id));
  const gradeIds = new Set(grades.map((row) => row.id));

  const startingInventory: BackupInventory[] = [];
  const inventoryKeys = new Set<string>();
  for (let i = 0; i < inventoryRaw.length; i++) {
    const label = `Starting inventory row ${i + 1}`;
    if (!isRecord(inventoryRaw[i])) return fail(`${label} is not an object.`);
    const row = inventoryRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const farmId = reqString(row, "farmId", label);
    if (isFail(farmId)) return farmId;
    const sizeId = reqString(row, "sizeId", label);
    if (isFail(sizeId)) return sizeId;
    const gradeId = reqString(row, "gradeId", label);
    if (isFail(gradeId)) return gradeId;
    if (!farmIds.has(farmId)) return fail(`${label} refers to a farm that is not in this file.`);
    if (!sizeIds.has(sizeId)) return fail(`${label} refers to a size that is not in this file.`);
    if (!gradeIds.has(gradeId)) return fail(`${label} refers to a grade that is not in this file.`);
    const key = `${farmId}|${sizeId}|${gradeId}`;
    if (inventoryKeys.has(key)) return fail(`${label} repeats a farm, size, and grade.`);
    inventoryKeys.add(key);
    const farmName = reqString(row, "farmName", label);
    if (isFail(farmName)) return farmName;
    const sizeName = reqString(row, "sizeName", label);
    if (isFail(sizeName)) return sizeName;
    const gradeName = reqString(row, "gradeName", label);
    if (isFail(gradeName)) return gradeName;
    const quantity = reqInt(row, "quantity", label);
    if (isFail(quantity)) return quantity;
    if (quantity < 0) return fail(`${label} has an invalid quantity.`);
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    startingInventory.push({ id, farmId, farmName, sizeId, sizeName, gradeId, gradeName, quantity, updatedAt });
  }
  const inventoryDup = uniqueIds(startingInventory.map((row) => row.id), "starting inventory");
  if (inventoryDup) return inventoryDup;

  const sessions: BackupSession[] = [];
  for (let i = 0; i < sessionsRaw.length; i++) {
    const label = `Session row ${i + 1}`;
    if (!isRecord(sessionsRaw[i])) return fail(`${label} is not an object.`);
    const row = sessionsRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const action = reqString(row, "action", label);
    if (isFail(action)) return action;
    const farmId = optString(row, "farmId", label);
    if (isFail(farmId)) return farmId;
    const farmName = optString(row, "farmName", label);
    if (isFail(farmName)) return farmName;
    const customerId = optString(row, "customerId", label);
    if (isFail(customerId)) return customerId;
    const customerName = optString(row, "customerName", label);
    if (isFail(customerName)) return customerName;
    const startedAt = reqDate(row, "startedAt", label);
    if (isFail(startedAt)) return startedAt;
    const endedAt = optDate(row, "endedAt", label);
    if (isFail(endedAt)) return endedAt;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    sessions.push({ id, action, farmId, farmName, customerId, customerName, startedAt, endedAt, createdAt });
  }
  const sessionDup = uniqueIds(sessions.map((row) => row.id), "session");
  if (sessionDup) return sessionDup;
  const sessionIds = new Set(sessions.map((row) => row.id));

  const counts: BackupCount[] = [];
  for (let i = 0; i < countsRaw.length; i++) {
    const label = `Count row ${i + 1}`;
    if (!isRecord(countsRaw[i])) return fail(`${label} is not an object.`);
    const row = countsRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const timestampLocal = reqString(row, "timestampLocal", label);
    if (isFail(timestampLocal)) return timestampLocal;
    const timestampUtc = reqDate(row, "timestampUtc", label);
    if (isFail(timestampUtc)) return timestampUtc;
    const action = reqString(row, "action", label);
    if (isFail(action)) return action;
    const farmId = optString(row, "farmId", label);
    if (isFail(farmId)) return farmId;
    const farmName = optString(row, "farmName", label);
    if (isFail(farmName)) return farmName;
    const customerId = optString(row, "customerId", label);
    if (isFail(customerId)) return customerId;
    const customerName = optString(row, "customerName", label);
    if (isFail(customerName)) return customerName;
    const sizeId = reqString(row, "sizeId", label);
    if (isFail(sizeId)) return sizeId;
    const sizeName = reqString(row, "sizeName", label);
    if (isFail(sizeName)) return sizeName;
    const gradeId = reqString(row, "gradeId", label);
    if (isFail(gradeId)) return gradeId;
    const gradeName = reqString(row, "gradeName", label);
    if (isFail(gradeName)) return gradeName;
    const quantity = reqInt(row, "quantity", label);
    if (isFail(quantity)) return quantity;
    const sessionId = reqString(row, "sessionId", label);
    if (isFail(sessionId)) return sessionId;
    if (!sessionIds.has(sessionId)) return fail(`${label} refers to a session that is not in this file.`);
    const clientSyncId = reqString(row, "clientSyncId", label);
    if (isFail(clientSyncId)) return clientSyncId;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const syncedAt = optDate(row, "syncedAt", label);
    if (isFail(syncedAt)) return syncedAt;
    const voidedAt = optDate(row, "voidedAt", label);
    if (isFail(voidedAt)) return voidedAt;
    const voidReason = optString(row, "voidReason", label);
    if (isFail(voidReason)) return voidReason;
    const correctionNote = optString(row, "correctionNote", label);
    if (isFail(correctionNote)) return correctionNote;
    const correctedAt = optDate(row, "correctedAt", label);
    if (isFail(correctedAt)) return correctedAt;
    counts.push({
      id,
      timestampLocal,
      timestampUtc,
      action,
      farmId,
      farmName,
      customerId,
      customerName,
      sizeId,
      sizeName,
      gradeId,
      gradeName,
      quantity,
      sessionId,
      clientSyncId,
      createdAt,
      syncedAt,
      voidedAt,
      voidReason,
      correctionNote,
      correctedAt,
    });
  }
  const countDup = uniqueIds(counts.map((row) => row.id), "count");
  if (countDup) return countDup;
  const syncDup = uniqueIds(counts.map((row) => row.clientSyncId), "count sync");
  if (syncDup) return syncDup;

  const miscounts: BackupMiscount[] = [];
  for (let i = 0; i < miscountsRaw.length; i++) {
    const label = `Miscount row ${i + 1}`;
    if (!isRecord(miscountsRaw[i])) return fail(`${label} is not an object.`);
    const row = miscountsRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const farmId = reqString(row, "farmId", label);
    if (isFail(farmId)) return farmId;
    const farmName = reqString(row, "farmName", label);
    if (isFail(farmName)) return farmName;
    const sizeId = reqString(row, "sizeId", label);
    if (isFail(sizeId)) return sizeId;
    const sizeName = reqString(row, "sizeName", label);
    if (isFail(sizeName)) return sizeName;
    const gradeId = reqString(row, "gradeId", label);
    if (isFail(gradeId)) return gradeId;
    const gradeName = reqString(row, "gradeName", label);
    if (isFail(gradeName)) return gradeName;
    const counterId = reqString(row, "counterId", label);
    if (isFail(counterId)) return counterId;
    const counterName = reqString(row, "counterName", label);
    if (isFail(counterName)) return counterName;
    const counterRole = reqString(row, "counterRole", label);
    if (isFail(counterRole)) return counterRole;
    const timestampLocal = reqString(row, "timestampLocal", label);
    if (isFail(timestampLocal)) return timestampLocal;
    const timestampUtc = reqDate(row, "timestampUtc", label);
    if (isFail(timestampUtc)) return timestampUtc;
    const clientSyncId = reqString(row, "clientSyncId", label);
    if (isFail(clientSyncId)) return clientSyncId;
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    miscounts.push({
      id,
      farmId,
      farmName,
      sizeId,
      sizeName,
      gradeId,
      gradeName,
      counterId,
      counterName,
      counterRole,
      timestampLocal,
      timestampUtc,
      clientSyncId,
      createdAt,
    });
  }
  const misDup = uniqueIds(miscounts.map((row) => row.id), "miscount");
  if (misDup) return misDup;

  const counterAccounts: BackupCounter[] = [];
  for (let i = 0; i < countersRaw.length; i++) {
    const label = `Counter account row ${i + 1}`;
    if (!isRecord(countersRaw[i])) return fail(`${label} is not an object.`);
    const row = countersRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const accountLabel = reqString(row, "accountLabel", label);
    if (isFail(accountLabel)) return accountLabel;
    const active = reqBool(row, "active", label);
    if (isFail(active)) return active;
    const access = reqString(row, "access", label);
    if (isFail(access)) return access;
    const countHand = typeof row.countHand === "string" && row.countHand ? row.countHand : "right";
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    counterAccounts.push({ id, accountLabel, active, access, countHand, createdAt, updatedAt });
  }

  const adminAccounts: BackupAdmin[] = [];
  for (let i = 0; i < adminsRaw.length; i++) {
    const label = `Admin account row ${i + 1}`;
    if (!isRecord(adminsRaw[i])) return fail(`${label} is not an object.`);
    const row = adminsRaw[i] as Record<string, unknown>;
    const id = reqString(row, "id", label);
    if (isFail(id)) return id;
    const name = reqString(row, "name", label);
    if (isFail(name)) return name;
    const email = reqString(row, "email", label);
    if (isFail(email)) return email;
    const countHand = typeof row.countHand === "string" && row.countHand ? row.countHand : "right";
    const createdAt = reqDate(row, "createdAt", label);
    if (isFail(createdAt)) return createdAt;
    const updatedAt = reqDate(row, "updatedAt", label);
    if (isFail(updatedAt)) return updatedAt;
    adminAccounts.push({ id, name, email, countHand, createdAt, updatedAt });
  }

  let settings: BackupSettings | null = null;
  if (input.settings != null) {
    if (!isRecord(input.settings)) return fail("Backup settings are invalid.");
    const soundEnabled = reqBool(input.settings, "soundEnabled", "Settings");
    if (isFail(soundEnabled)) return soundEnabled;
    const vibrationEnabled = reqBool(input.settings, "vibrationEnabled", "Settings");
    if (isFail(vibrationEnabled)) return vibrationEnabled;
    const checklistDismissed = reqBool(input.settings, "checklistDismissed", "Settings");
    if (isFail(checklistDismissed)) return checklistDismissed;
    const checklistJson = input.settings.checklistJson;
    if (typeof checklistJson !== "string") return fail("Settings are missing checklistJson.");
    const excelEnabled = reqBool(input.settings, "excelEnabled", "Settings");
    if (isFail(excelEnabled)) return excelEnabled;
    const setupLocked = reqBool(input.settings, "setupLocked", "Settings");
    if (isFail(setupLocked)) return setupLocked;
    settings = { soundEnabled, vibrationEnabled, checklistDismissed, checklistJson, excelEnabled, setupLocked };
  }

  const doc: BackupDocument = {
    backupVersion: BACKUP_VERSION,
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : new Date().toISOString(),
    note: NOTE,
    farms,
    customers,
    sizes,
    grades,
    startingInventory,
    sessions,
    counts,
    miscounts,
    counterAccounts,
    adminAccounts,
    settings,
  };
  assertNoSecretFields(doc);
  return { ok: true, doc };
}

async function createChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  const size = 40;
  for (let i = 0; i < rows.length; i += size) {
    if (rows.length === 0) return;
    await write(rows.slice(i, i + size));
  }
}

/** Replace operational rows. Accounts, login attempts, and secret settings stay. */
export async function restoreBackupDocument(doc: BackupDocument): Promise<void> {
  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      await tx.countRecord.deleteMany();
      await tx.miscount.deleteMany();
      await tx.countSession.deleteMany();
      await tx.startingInventory.deleteMany();
      await tx.farm.deleteMany();
      await tx.customer.deleteMany();
      await tx.treeSize.deleteMany();
      await tx.treeGrade.deleteMany();

      await createChunks(doc.farms, (chunk) =>
        tx.farm.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            name: row.name,
            displayOrder: row.displayOrder,
            active: row.active,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          })),
        }),
      );
      await createChunks(doc.customers, (chunk) =>
        tx.customer.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            name: row.name,
            displayOrder: row.displayOrder,
            active: row.active,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          })),
        }),
      );
      await createChunks(doc.sizes, (chunk) =>
        tx.treeSize.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            name: row.name,
            color: row.color,
            requireFarm: row.requireFarm,
            displayOrder: row.displayOrder,
            active: row.active,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          })),
        }),
      );
      await createChunks(doc.grades, (chunk) =>
        tx.treeGrade.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            name: row.name,
            requireFarm: row.requireFarm,
            drawsFromGradeId: row.drawsFromGradeId,
            displayOrder: row.displayOrder,
            active: row.active,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          })),
        }),
      );
      await createChunks(doc.sessions, (chunk) =>
        tx.countSession.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            action: row.action,
            farmId: row.farmId,
            farmName: row.farmName,
            customerId: row.customerId,
            customerName: row.customerName,
            startedAt: new Date(row.startedAt),
            endedAt: row.endedAt ? new Date(row.endedAt) : null,
            createdAt: new Date(row.createdAt),
          })),
        }),
      );
      await createChunks(doc.startingInventory, (chunk) =>
        tx.startingInventory.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            farmId: row.farmId,
            sizeId: row.sizeId,
            gradeId: row.gradeId,
            quantity: row.quantity,
            updatedAt: new Date(row.updatedAt),
          })),
        }),
      );
      await createChunks(doc.counts, (chunk) =>
        tx.countRecord.createMany({
          data: chunk.map((row) => ({
            id: row.id,
            timestampLocal: row.timestampLocal,
            timestampUtc: new Date(row.timestampUtc),
            action: row.action,
            farmId: row.farmId,
            farmName: row.farmName,
            customerId: row.customerId,
            customerName: row.customerName,
            sizeId: row.sizeId,
            sizeName: row.sizeName,
            gradeId: row.gradeId,
            gradeName: row.gradeName,
            quantity: row.quantity,
            sessionId: row.sessionId,
            clientSyncId: row.clientSyncId,
            createdAt: new Date(row.createdAt),
            syncedAt: row.syncedAt ? new Date(row.syncedAt) : null,
            voidedAt: row.voidedAt ? new Date(row.voidedAt) : null,
            voidReason: row.voidReason,
            correctionNote: row.correctionNote,
            correctedAt: row.correctedAt ? new Date(row.correctedAt) : null,
          })),
        }),
      );
      await createChunks(doc.miscounts, (chunk) =>
        tx.miscount.createMany({
          data: chunk.map((row) => ({
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
            timestampUtc: new Date(row.timestampUtc),
            clientSyncId: row.clientSyncId,
            createdAt: new Date(row.createdAt),
          })),
        }),
      );

      if (doc.settings) {
        await tx.appSettings.upsert({
          where: { id: "default" },
          create: {
            id: "default",
            soundEnabled: doc.settings.soundEnabled,
            vibrationEnabled: doc.settings.vibrationEnabled,
            checklistDismissed: doc.settings.checklistDismissed,
            checklistJson: doc.settings.checklistJson,
            updatedAt: now,
          },
          update: {
            soundEnabled: doc.settings.soundEnabled,
            vibrationEnabled: doc.settings.vibrationEnabled,
            checklistDismissed: doc.settings.checklistDismissed,
            checklistJson: doc.settings.checklistJson,
            updatedAt: now,
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
