import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-secret-value-at-least-16";
process.env.PIN_PEPPER = "pepper";
process.env.APP_TIMEZONE = "America/New_York";
delete process.env.GOOGLE_SHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

const dir = mkdtempSync(join(tmpdir(), "ptf-backup-"));
const dbPath = join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

execSync("npx prisma db push --skip-generate", {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const PIN_MARKER = "secret-pin-hash-marker";
const PIN_KEY_MARKER = "secret-pin-key-marker";
const EXCEL_MARKER = "secret-excel-hash-marker";

type Doc = import("../src/server/backup-document").BackupDocument;
type SheetsClient = import("../src/server/sheets-backup").SheetsClient;

let buildBackupDocument: typeof import("../src/server/backup-document").buildBackupDocument;
let parseBackupDocument: typeof import("../src/server/backup-document").parseBackupDocument;
let restoreBackupDocument: typeof import("../src/server/backup-document").restoreBackupDocument;
let formatBackupStatus: typeof import("../src/server/backup-status").formatBackupStatus;
let backupStatusLine: typeof import("../src/server/backup-status").backupStatusLine;
let readSheetsConfig: typeof import("../src/server/sheets-backup").readSheetsConfig;
let runSheetsBackup: typeof import("../src/server/sheets-backup").runSheetsBackup;
let sheetTables: typeof import("../src/server/sheets-backup").sheetTables;
let SHEET_TABS: typeof import("../src/server/sheets-backup").SHEET_TABS;
let createFirstAdmin: typeof import("../src/server/setup").createFirstAdmin;
let confirmAdminPassword: typeof import("../src/server/password-gate").confirmAdminPassword;

let saved: Doc;
let originalAdminId = "";

function memorySheets(existing: string[] = []): SheetsClient & { ensured: string[]; sheets: Map<string, string[][]> } {
  const sheets = new Map<string, string[][]>(existing.map((title) => [title, []]));
  const ensured: string[] = [];
  return {
    sheets,
    ensured,
    async listTitles() {
      return [...sheets.keys()];
    },
    async ensureSheet(title: string) {
      ensured.push(title);
      if (!sheets.has(title)) sheets.set(title, []);
    },
    async overwrite(title: string, rows: string[][]) {
      sheets.set(title, rows);
    },
  };
}

async function snapshot() {
  const [farms, customers, sizes, grades, inventory, sessions, counts, miscounts, admins, counters] = await Promise.all([
    prisma.farm.count(),
    prisma.customer.count(),
    prisma.treeSize.count(),
    prisma.treeGrade.count(),
    prisma.startingInventory.count(),
    prisma.countSession.count(),
    prisma.countRecord.count(),
    prisma.miscount.count(),
    prisma.adminAccount.count(),
    prisma.counterAccount.count(),
  ]);
  return { farms, customers, sizes, grades, inventory, sessions, counts, miscounts, admins, counters };
}

test("load backup modules", async () => {
  ({ buildBackupDocument, parseBackupDocument, restoreBackupDocument } = await import("../src/server/backup-document"));
  ({ formatBackupStatus, backupStatusLine } = await import("../src/server/backup-status"));
  ({ readSheetsConfig, runSheetsBackup, sheetTables, SHEET_TABS } = await import("../src/server/sheets-backup"));
  ({ createFirstAdmin } = await import("../src/server/setup"));
  ({ confirmAdminPassword } = await import("../src/server/password-gate"));
  assert.equal(SHEET_TABS.length, 8);
});

test("backup status uses New York time", () => {
  const at = new Date("2026-10-16T13:53:00.000Z");
  assert.equal(formatBackupStatus(null), "Last backup: never");
  assert.match(formatBackupStatus({ lastBackupAt: at, lastBackupOk: true, lastBackupError: null }), /Last backup: Oct 16, 2026, 9:53 AM .* — OK/);
  assert.match(
    formatBackupStatus({ lastBackupAt: at, lastBackupOk: false, lastBackupError: "sheet missing" }),
    /Last backup: Oct 16, 2026, 9:53 AM .* — failed \(sheet missing\)/,
  );
});

test("sheets config skips when unset or invalid", () => {
  assert.equal(readSheetsConfig({}).ok, false);
  assert.match(readSheetsConfig({}).ok ? "" : readSheetsConfig({}).error, /not set/);
  const missingSheet = readSheetsConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: "{\"client_email\":\"a@b.c\",\"private_key\":\"x\"}" });
  assert.equal(missingSheet.ok, false);
  const badJson = readSheetsConfig({ GOOGLE_SHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_JSON: "not-json" });
  assert.equal(badJson.ok, false);
  if (!badJson.ok) assert.match(badJson.error, /not valid JSON/);
  const missingKey = readSheetsConfig({
    GOOGLE_SHEET_ID: "sheet",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b.c" }),
  });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.match(missingKey.error, /private_key/);
});

test("seed operational data and export without secrets", async () => {
  const created = await createFirstAdmin({
    name: "Levi Powers",
    email: "levi@powerstreefarm.com",
    password: "FraserFir99!",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  originalAdminId = created.admin.id;
  await prisma.adminAccount.update({ where: { id: created.admin.id }, data: { countHand: "left" } });
  await prisma.appSettings.update({
    where: { id: "default" },
    data: {
      excelApiKeyHash: EXCEL_MARKER,
      excelEnabled: true,
      soundEnabled: false,
      checklistJson: "{\"farms\":true}",
    },
  });
  await prisma.counterAccount.create({
    data: {
      accountLabel: "Yard tablet",
      pinHash: PIN_MARKER,
      pinKey: PIN_KEY_MARKER,
      access: "both",
      active: true,
      countHand: "left",
      updatedAt: new Date(),
    },
  });
  const farm = await prisma.farm.create({
    data: { name: "Bald Mountain", displayOrder: 0, active: true, updatedAt: new Date() },
  });
  const customer = await prisma.customer.create({
    data: { name: "North Ridge Nursery", displayOrder: 0, active: true },
  });
  const size = await prisma.treeSize.create({
    data: { name: "Boughs", color: "#335544", requireFarm: false, displayOrder: 0, active: true, updatedAt: new Date() },
  });
  const grade = await prisma.treeGrade.create({
    data: { name: "#2 Utility Cull", requireFarm: false, displayOrder: 0, active: true, updatedAt: new Date() },
  });
  await prisma.startingInventory.create({
    data: { farmId: farm.id, sizeId: size.id, gradeId: grade.id, quantity: 40, updatedAt: new Date() },
  });
  const yardSession = "session-yard";
  const shipSession = "session-ship";
  await prisma.countSession.create({
    data: { id: yardSession, action: "Yard Received", farmId: farm.id, farmName: farm.name, startedAt: new Date("2026-10-16T14:00:00.000Z") },
  });
  await prisma.countSession.create({
    data: {
      id: shipSession,
      action: "Shipped",
      customerId: customer.id,
      customerName: customer.name,
      startedAt: new Date("2026-10-16T15:00:00.000Z"),
    },
  });
  await prisma.countRecord.create({
    data: {
      timestampLocal: "2026-10-16T10:00:00.000-04:00",
      timestampUtc: new Date("2026-10-16T14:00:00.000Z"),
      action: "Yard Received",
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: yardSession,
      clientSyncId: "yard-sync-1",
    },
  });
  await prisma.countRecord.create({
    data: {
      timestampLocal: "2026-10-16T11:00:00.000-04:00",
      timestampUtc: new Date("2026-10-16T15:00:00.000Z"),
      action: "Shipped",
      customerId: customer.id,
      customerName: customer.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: shipSession,
      clientSyncId: "ship-sync-1",
    },
  });
  await prisma.miscount.create({
    data: {
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      counterId: "counter-1",
      counterName: "Yard tablet",
      counterRole: "counter",
      timestampLocal: "2026-10-16T10:05:00.000-04:00",
      timestampUtc: new Date("2026-10-16T14:05:00.000Z"),
      clientSyncId: "mis-sync-1",
    },
  });

  saved = await buildBackupDocument();
  const raw = JSON.stringify(saved);
  assert.equal(saved.backupVersion, 1);
  assert.doesNotMatch(raw, /passwordHash|pinHash|pinKey|excelApiKeyHash|private_key|access_token/i);
  assert.equal(raw.includes(PIN_MARKER), false);
  assert.equal(raw.includes(PIN_KEY_MARKER), false);
  assert.equal(raw.includes(EXCEL_MARKER), false);
  assert.equal(saved.adminAccounts[0]?.countHand, "left");
  assert.equal(saved.counterAccounts[0]?.countHand, "left");
  assert.equal(saved.sizes.find((row) => row.name === "Boughs")?.requireFarm, false);
  assert.equal(saved.grades.find((row) => row.name === "#2 Utility Cull")?.requireFarm, false);
  assert.equal(saved.miscounts.length, 1);
  assert.equal(saved.counts.filter((row) => row.action === "Shipped")[0]?.customerName, "North Ridge Nursery");
  assert.equal("passwordHash" in (saved.adminAccounts[0] || {}), false);
  assert.equal("pinHash" in (saved.counterAccounts[0] || {}), false);
  assert.equal(saved.settings?.excelEnabled, true);
  assert.equal("excelApiKeyHash" in (saved.settings || {}), false);
});

test("sheets job writes tabs and status, and records a skip when unset", async () => {
  const client = memorySheets(["Farms"]);
  const ok = await runSheetsBackup({ client, now: new Date("2026-10-16T13:53:00.000Z") });
  assert.equal(ok.ok, true);
  assert.deepEqual([...client.sheets.keys()].sort(), [...SHEET_TABS].sort());
  assert.equal(client.ensured.includes("Farms"), false);
  assert.equal(client.ensured.includes("Miscounts"), true);
  const sizes = client.sheets.get("Sizes") || [];
  assert.deepEqual(sizes[0], ["SizeID", "Name", "Color", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"]);
  const requireCol = sizes[0]!.indexOf("RequireFarm");
  const boughs = sizes.slice(1).find((row) => row[1] === "Boughs");
  assert.equal(boughs?.[requireCol], "false");
  const dumped = JSON.stringify([...client.sheets.values()]);
  assert.equal(dumped.includes(PIN_MARKER), false);
  assert.equal(dumped.includes(EXCEL_MARKER), false);
  assert.doesNotMatch(dumped, /passwordHash|pinHash|pinKey|excelApiKeyHash|private_key/);
  assert.equal(client.sheets.has("Admins" as "Farms"), false);
  const line = await backupStatusLine();
  assert.match(line, /Last backup: Oct 16, 2026, 9:53 AM .* — OK/);

  delete process.env.GOOGLE_SHEET_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const skipped = await runSheetsBackup({ now: new Date("2026-10-16T14:00:00.000Z") });
  assert.equal(skipped.ok, false);
  assert.match(skipped.error || "", /GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are not set/);
  const failed = await backupStatusLine();
  assert.match(failed, /— failed \(GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are not set\)/);

  process.env.GOOGLE_SHEET_ID = "sheet-id";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "not-json";
  const invalid = await runSheetsBackup({ now: new Date("2026-10-16T14:05:00.000Z") });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error || "", /not valid JSON/);
  assert.match(await backupStatusLine(), /— failed \(GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON\)/);
  delete process.env.GOOGLE_SHEET_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

test("overlapping sheets runs are skipped", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  const client: SheetsClient = {
    async listTitles() {
      return [];
    },
    async ensureSheet() {},
    async overwrite() {
      started += 1;
      await gate;
    },
  };
  const first = runSheetsBackup({ client });
  const second = await runSheetsBackup({ client });
  assert.equal(second.skipped, true);
  release();
  const finished = await first;
  assert.equal(finished.ok, true);
  assert.equal(started, SHEET_TABS.length);
});

test("wipe to a fresh admin and restore the same rows", async () => {
  const before = await snapshot();
  console.log("BEFORE", JSON.stringify(before));
  assert.equal(before.farms, 1);
  assert.equal(before.customers, 1);
  assert.equal(before.counts, 2);
  assert.equal(before.miscounts, 1);
  assert.equal(before.counters, 1);

  await prisma.countRecord.deleteMany();
  await prisma.miscount.deleteMany();
  await prisma.countSession.deleteMany();
  await prisma.startingInventory.deleteMany();
  await prisma.farm.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.treeSize.deleteMany();
  await prisma.treeGrade.deleteMany();
  await prisma.counterAccount.deleteMany();
  await prisma.adminAccount.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.appSettings.deleteMany();

  const fresh = await createFirstAdmin({
    name: "Restoring Admin",
    email: "restore@example.com",
    password: "RestorePass99",
  });
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  const wiped = await snapshot();
  console.log("WIPED", JSON.stringify(wiped));
  assert.equal(wiped.farms, 0);
  assert.equal(wiped.counts, 0);
  assert.equal(wiped.miscounts, 0);
  assert.ok(wiped.sizes > 1);
  assert.equal(wiped.admins, 1);
  assert.equal(wiped.counters, 0);

  const parsed = parseBackupDocument(JSON.parse(JSON.stringify(saved)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await restoreBackupDocument(parsed.doc);

  const after = await snapshot();
  console.log("AFTER", JSON.stringify(after));
  assert.deepEqual(
    { ...after, admins: before.admins, counters: 0 },
    { ...before, admins: before.admins, counters: 0 },
  );
  assert.equal(after.admins, 1);
  assert.equal(after.counters, 0);

  const farm = await prisma.farm.findFirstOrThrow();
  assert.equal(farm.name, "Bald Mountain");
  const size = await prisma.treeSize.findFirstOrThrow({ where: { name: "Boughs" } });
  assert.equal(size.requireFarm, false);
  assert.equal(size.color, "#335544");
  const grade = await prisma.treeGrade.findFirstOrThrow({ where: { name: "#2 Utility Cull" } });
  assert.equal(grade.requireFarm, false);
  const inventory = await prisma.startingInventory.findFirstOrThrow();
  assert.equal(inventory.quantity, 40);
  const shipped = await prisma.countRecord.findFirstOrThrow({ where: { clientSyncId: "ship-sync-1" } });
  assert.equal(shipped.customerName, "North Ridge Nursery");
  assert.equal(shipped.action, "Shipped");
  const mis = await prisma.miscount.findFirstOrThrow({ where: { clientSyncId: "mis-sync-1" } });
  assert.equal(mis.farmName, "Bald Mountain");
  const admin = await prisma.adminAccount.findFirstOrThrow();
  assert.equal(admin.email, "restore@example.com");
  assert.equal(admin.countHand, "right");
  assert.equal(await prisma.adminAccount.count({ where: { email: "levi@powerstreefarm.com" } }), 0);
  assert.equal(await confirmAdminPassword(admin.id, "RestorePass99"), true);
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: "default" } });
  assert.equal(settings.soundEnabled, false);
  assert.equal(settings.checklistJson, "{\"farms\":true}");
  assert.equal(settings.excelApiKeyHash, null);
  assert.equal(settings.setupLocked, true);
});

test("a bad backup file changes nothing", async () => {
  const before = await snapshot();
  const farmName = (await prisma.farm.findFirstOrThrow()).name;
  const missing = parseBackupDocument({ backupVersion: 1 });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /missing farms/);
  const broken = JSON.parse(JSON.stringify(saved)) as Doc;
  broken.counts.push({ ...broken.counts[0]!, id: "extra-count", clientSyncId: "extra-sync", sessionId: "missing-session" });
  const parsed = parseBackupDocument(broken);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /session that is not in this file/);
  const notBackup = parseBackupDocument({ hello: "world" });
  assert.equal(notBackup.ok, false);
  if (!notBackup.ok) assert.match(notBackup.error, /not a Powers Tree Farm backup/);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await prisma.farm.findFirstOrThrow()).name, farmName);
});

test("restore route is admin only and rejects a bad confirmation", async () => {
  const { NextRequest } = await import("next/server");
  const { GET, POST } = await import("../src/app/api/admin/backup/route");
  const { signSession } = await import("../src/lib/session-edge");
  const admin = await prisma.adminAccount.findFirstOrThrow();
  const adminToken = await signSession({ role: "admin", adminId: admin.id, access: "admin", name: admin.name });
  const counterToken = await signSession({ role: "counter", counterId: "counter-x", access: "both", name: "Yard tablet" });
  const before = await snapshot();

  const anon = await POST(new NextRequest("http://localhost/api/admin/backup", { method: "POST", body: "{}" }));
  assert.equal(anon.status, 401);
  const counter = await POST(
    new NextRequest("http://localhost/api/admin/backup", {
      method: "POST",
      headers: { cookie: `ptf_session=${counterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESTORE", currentPassword: "RestorePass99", backup: saved }),
    }),
  );
  assert.equal(counter.status, 401);

  const phrase = await POST(
    new NextRequest("http://localhost/api/admin/backup", {
      method: "POST",
      headers: { cookie: `ptf_session=${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "restore", currentPassword: "RestorePass99", backup: saved }),
    }),
  );
  assert.equal(phrase.status, 400);
  assert.match(((await phrase.json()) as { error: string }).error, /RESTORE/);

  const password = await POST(
    new NextRequest("http://localhost/api/admin/backup", {
      method: "POST",
      headers: { cookie: `ptf_session=${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESTORE", currentPassword: "wrong-password", backup: saved }),
    }),
  );
  assert.equal(password.status, 403);

  const corrupt = await POST(
    new NextRequest("http://localhost/api/admin/backup", {
      method: "POST",
      headers: { cookie: `ptf_session=${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESTORE", currentPassword: "RestorePass99", backup: { backupVersion: 1 } }),
    }),
  );
  assert.equal(corrupt.status, 400);
  assert.deepEqual(await snapshot(), before);

  const status = await GET(
    new NextRequest("http://localhost/api/admin/backup?view=status", { headers: { cookie: `ptf_session=${adminToken}` } }),
  );
  assert.equal(status.status, 200);
  const download = await GET(
    new NextRequest("http://localhost/api/admin/backup?table=json", { headers: { cookie: `ptf_session=${adminToken}` } }),
  );
  assert.equal(download.status, 200);
  const body = (await download.json()) as Doc;
  assert.equal(body.miscounts.length, 1);
  assert.equal(body.sizes.find((row) => row.name === "Boughs")?.requireFarm, false);
  const downloaded = JSON.stringify(body);
  assert.equal(downloaded.includes(PIN_MARKER), false);
  assert.doesNotMatch(downloaded, /passwordHash|pinHash|excelApiKeyHash/);

  const counterStatus = await GET(
    new NextRequest("http://localhost/api/admin/backup?view=status", { headers: { cookie: `ptf_session=${counterToken}` } }),
  );
  assert.equal(counterStatus.status, 401);
});

test("cleanup backup database", async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
