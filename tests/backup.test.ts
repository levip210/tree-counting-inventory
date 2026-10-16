import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-secret-value-at-least-16";
process.env.PIN_PEPPER = "pepper";
process.env.APP_TIMEZONE = "America/New_York";
delete process.env.BACKUP_TOKEN;

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

let buildBackupDocument: typeof import("../src/server/backup-document").buildBackupDocument;
let buildOperationalExport: typeof import("../src/server/backup-document").buildOperationalExport;
let parseBackupDocument: typeof import("../src/server/backup-document").parseBackupDocument;
let restoreBackupDocument: typeof import("../src/server/backup-document").restoreBackupDocument;
let formatBackupStatus: typeof import("../src/server/backup-status").formatBackupStatus;
let backupStatusLine: typeof import("../src/server/backup-status").backupStatusLine;
let createFirstAdmin: typeof import("../src/server/setup").createFirstAdmin;
let confirmAdminPassword: typeof import("../src/server/password-gate").confirmAdminPassword;

let saved: Doc;
let originalAdminId = "";

type SheetRow = { values: string[][]; clears: number };
type ScriptGlobal = Record<string, unknown> & {
  tablesFromExport: (payload: unknown) => { title: string; rows: string[][] }[];
  pullBackup: () => void;
  saveBackupConfig_: (url: string, token: string) => void;
  installBackupTrigger: () => void;
};

function mockSpreadsheet(seed: Record<string, string[][]> = {}) {
  const sheets = new Map<string, SheetRow>();
  for (const [name, values] of Object.entries(seed)) sheets.set(name, { values: values.map((row) => [...row]), clears: 0 });
  function wrap(name: string) {
    const row = sheets.get(name)!;
    return {
      clearContents() {
        row.clears += 1;
        row.values = [];
      },
      getRange() {
        return {
          setValues(values: string[][]) {
            row.values = values.map((line) => [...line]);
          },
        };
      },
    };
  }
  return {
    sheets,
    getSheetByName(name: string) {
      return sheets.has(name) ? wrap(name) : null;
    },
    insertSheet(name: string) {
      sheets.set(name, { values: [], clears: 0 });
      return wrap(name);
    },
  };
}

function loadAppsScript(extra: Record<string, unknown> = {}): ScriptGlobal {
  const sandbox = {
    SpreadsheetApp: {},
    PropertiesService: {},
    UrlFetchApp: {},
    ScriptApp: {},
    Utilities: { formatDate: () => "Oct 16, 2026, 9:53 AM EDT" },
    ...extra,
  };
  createContext(sandbox);
  runInContext(readFileSync(join(process.cwd(), "docs/backup-apps-script.gs"), "utf8"), sandbox, {
    filename: "docs/backup-apps-script.gs",
  });
  return sandbox as ScriptGlobal;
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
  ({ buildBackupDocument, buildOperationalExport, parseBackupDocument, restoreBackupDocument } = await import(
    "../src/server/backup-document"
  ));
  ({ formatBackupStatus, backupStatusLine } = await import("../src/server/backup-status"));
  ({ createFirstAdmin } = await import("../src/server/setup"));
  ({ confirmAdminPassword } = await import("../src/server/password-gate"));
  assert.equal(typeof buildOperationalExport, "function");
});

test("backup status uses New York time for export and download", () => {
  const at = new Date("2026-10-16T13:53:00.000Z");
  const later = new Date("2026-10-16T14:05:00.000Z");
  assert.equal(formatBackupStatus(null), "Last export: never\nLast download: never");
  assert.match(
    formatBackupStatus({ lastBackupAt: at, lastBackupOk: true, lastBackupError: null, lastDownloadAt: later }),
    /Last export: Oct 16, 2026, 9:53 AM .* — OK\nLast download: Oct 16, 2026, 10:05 AM .* — OK/,
  );
  assert.match(
    formatBackupStatus({ lastBackupAt: at, lastBackupOk: false, lastBackupError: "HTTP 401" }),
    /Last export: Oct 16, 2026, 9:53 AM .* — failed \(HTTP 401\)\nLast download: never/,
  );
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
  const status = await GET(
    new NextRequest("http://localhost/api/admin/backup?view=status", { headers: { cookie: `ptf_session=${adminToken}` } }),
  );
  assert.equal(status.status, 200);
  const line = ((await status.json()) as { line: string }).line;
  assert.match(line, /Last export: never/);
  assert.match(line, /Last download: Oct 16, 2026, .* — OK/);

  const counterStatus = await GET(
    new NextRequest("http://localhost/api/admin/backup?view=status", { headers: { cookie: `ptf_session=${counterToken}` } }),
  );
  assert.equal(counterStatus.status, 401);
});

test("export endpoint rejects a missing or wrong token and returns operational JSON", async () => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../src/app/api/backup/export/route");
  delete process.env.BACKUP_TOKEN;
  const disabled = await GET(new NextRequest("http://localhost/api/backup/export?token=anything"));
  assert.equal(disabled.status, 503);

  process.env.BACKUP_TOKEN = "correct-backup-token";
  const missing = await GET(new NextRequest("http://localhost/api/backup/export"));
  assert.equal(missing.status, 401);
  const wrongQuery = await GET(new NextRequest("http://localhost/api/backup/export?token=nope"));
  assert.equal(wrongQuery.status, 401);
  const wrongBearer = await GET(
    new NextRequest("http://localhost/api/backup/export", { headers: { authorization: "Bearer nope" } }),
  );
  assert.equal(wrongBearer.status, 401);
  assert.match(await backupStatusLine(), /Last export: never/);

  const byQuery = await GET(new NextRequest("http://localhost/api/backup/export?token=correct-backup-token"));
  assert.equal(byQuery.status, 200);
  const queryBody = (await byQuery.json()) as Record<string, unknown>;
  assert.equal(typeof queryBody.exportedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(String(queryBody.exportedAt))));
  assert.equal(Array.isArray(queryBody.farms), true);
  assert.equal(Array.isArray(queryBody.miscounts), true);
  assert.equal("adminAccounts" in queryBody, false);
  assert.equal("counterAccounts" in queryBody, false);
  assert.equal("settings" in queryBody, false);
  const raw = JSON.stringify(queryBody);
  assert.equal(raw.includes(PIN_MARKER), false);
  assert.equal(raw.includes(PIN_KEY_MARKER), false);
  assert.equal(raw.includes(EXCEL_MARKER), false);
  assert.equal(raw.includes("levi@powerstreefarm.com"), false);
  assert.doesNotMatch(raw, /passwordHash|pinHash|pinKey|excelApiKeyHash|countHand/);
  const sizes = queryBody.sizes as { name: string; requireFarm: boolean }[];
  assert.equal(sizes.find((row) => row.name === "Boughs")?.requireFarm, false);
  assert.match(await backupStatusLine(), /Last export: Oct 16, 2026, .* — OK/);
  assert.match(await backupStatusLine(), /Last download: Oct 16, 2026, .* — OK/);

  const byBearer = await GET(
    new NextRequest("http://localhost/api/backup/export", {
      headers: { authorization: "Bearer correct-backup-token" },
    }),
  );
  assert.equal(byBearer.status, 200);
  delete process.env.BACKUP_TOKEN;
});

test("apps script parser writes tabs from a real export and leaves them on a fetch error", async () => {
  const source = readFileSync(join(process.cwd(), "docs/backup-apps-script.gs"), "utf8");
  assert.match(source, /Script Properties/);
  assert.match(source, /everyMinutes\(15\)/);
  assert.match(source, /America\/New_York/);
  assert.match(source, /UrlFetchApp/);
  assert.match(source, /setupBackup/);

  const exported = await buildOperationalExport(new Date("2026-10-16T13:53:00.000Z"));
  const script = loadAppsScript();
  const tables = script.tablesFromExport(exported);
  assert.equal(
    JSON.stringify(tables.map((table) => table.title)),
    JSON.stringify(["Farms", "Customers", "Sizes", "Grades", "Starting inventory", "Sessions", "Counts", "Miscounts"]),
  );
  const sizes = tables.find((table) => table.title === "Sizes")!;
  assert.equal(
    JSON.stringify(sizes.rows[0]),
    JSON.stringify(["SizeID", "Name", "Color", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"]),
  );
  const requireCol = sizes.rows[0].indexOf("RequireFarm");
  const boughs = sizes.rows.slice(1).find((row) => row[1] === "Boughs");
  assert.equal(boughs?.[requireCol], "false");
  const dumped = JSON.stringify(tables);
  assert.equal(dumped.includes(PIN_MARKER), false);
  assert.equal(dumped.includes(EXCEL_MARKER), false);
  assert.doesNotMatch(dumped, /passwordHash|pinHash|pinKey|excelApiKeyHash/);
  assert.throws(() => script.tablesFromExport({ farms: [] }), /Backup payload was not valid/);

  const properties: Record<string, string> = {};
  const triggerCalls: unknown[] = [];
  const spreadsheet = mockSpreadsheet({ Farms: [["keep-me"]] });
  const shared = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({}),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties[key] || "",
        setProperties: (next: Record<string, string>) => Object.assign(properties, next),
      }),
    },
    Utilities: { formatDate: () => "Oct 16, 2026, 9:53 AM EDT" },
    ScriptApp: {
      getProjectTriggers: () => [{ getHandlerFunction: () => "pullBackup" }],
      deleteTrigger: (trigger: unknown) => triggerCalls.push(["delete", trigger]),
      newTrigger: (name: string) => ({
        timeBased: () => ({
          everyMinutes: (minutes: number) => ({
            create: () => triggerCalls.push(["create", name, minutes]),
          }),
        }),
      }),
    },
  };

  const failing = loadAppsScript({
    ...shared,
    UrlFetchApp: {
      fetch: () => {
        throw new Error("network down");
      },
    },
  });
  failing.saveBackupConfig_("  https://example.test/api/backup/export  ", "  token-value  ");
  assert.equal(properties.BACKUP_URL, "https://example.test/api/backup/export");
  assert.equal(properties.BACKUP_TOKEN, "token-value");
  failing.installBackupTrigger();
  assert.equal(JSON.stringify(triggerCalls[1]), JSON.stringify(["create", "pullBackup", 15]));
  failing.pullBackup();
  assert.equal(spreadsheet.sheets.get("Farms")?.clears, 0);
  assert.equal(JSON.stringify(spreadsheet.sheets.get("Farms")?.values), JSON.stringify([["keep-me"]]));
  const failedStatus = spreadsheet.sheets.get("Status")?.values || [];
  assert.equal(failedStatus[0]?.[0], "Last backup");
  assert.match(failedStatus[0]?.[1] || "", /Oct 16, 2026, 9:53 AM EDT — failed \(network down\)/);

  const succeeding = loadAppsScript({
    ...shared,
    UrlFetchApp: {
      fetch: (_url: string, options: { headers: { Authorization: string } }) => {
        assert.equal(options.headers.Authorization, "Bearer token-value");
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(exported),
        };
      },
    },
  });
  succeeding.pullBackup();
  assert.equal(spreadsheet.sheets.get("Farms")?.clears, 1);
  assert.equal(spreadsheet.sheets.get("Farms")?.values[1]?.[1], exported.farms[0]?.name);
  assert.equal(spreadsheet.sheets.get("Miscounts")?.values.length, exported.miscounts.length + 1);
  assert.match(spreadsheet.sheets.get("Status")?.values[0]?.[1] || "", /— OK/);

  const httpError = loadAppsScript({
    ...shared,
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 401,
        getContentText: () => "{\"error\":\"Unauthorized.\"}",
      }),
    },
  });
  const beforeHttp = JSON.stringify(spreadsheet.sheets.get("Farms")?.values);
  httpError.pullBackup();
  assert.equal(JSON.stringify(spreadsheet.sheets.get("Farms")?.values), beforeHttp);
  assert.match(spreadsheet.sheets.get("Status")?.values[0]?.[1] || "", /failed \(HTTP 401\)/);
});

test("cleanup backup database", async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
