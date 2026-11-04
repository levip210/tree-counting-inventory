import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test-secret-value-at-least-16";
process.env.PIN_PEPPER = "pepper";
process.env.APP_TIMEZONE = "America/New_York";

const dir = mkdtempSync(join(tmpdir(), "ptf-adjust-"));
const dbPath = join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

execSync("npx prisma db push --skip-generate", {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

type AdjustMod = typeof import("../src/server/adjustments");
type DashMod = typeof import("../src/server/dashboard");
type CustomerMod = typeof import("../src/server/customers");
type CountsMod = typeof import("../src/server/counts");
type BackupMod = typeof import("../src/server/backup-document");

let adjust: AdjustMod;
let dashboard: DashMod;
let customers: CustomerMod;
let counts: CountsMod;
let backup: BackupMod;

const adminSession = {
  role: "admin" as const,
  adminId: "",
  access: "admin" as const,
  name: "Levi Powers",
};
const counterSession = {
  role: "counter" as const,
  counterId: "counter-1",
  access: "both" as const,
  name: "Yard tablet",
};

test("load adjustment modules", async () => {
  adjust = await import("../src/server/adjustments");
  dashboard = await import("../src/server/dashboard");
  customers = await import("../src/server/customers");
  counts = await import("../src/server/counts");
  backup = await import("../src/server/backup-document");
  assert.equal(typeof adjust.adminAdjustment, "function");
});

test("taps still reject a typed quantity", () => {
  const rejected = counts.sanitizeCount({
    clientSyncId: "bulk-try",
    timestampLocal: "2026-11-03T12:00:00.000-05:00",
    action: "Yard Received",
    farmId: "farm",
    farmName: "Kilby",
    sizeId: "size",
    sizeName: "6-7",
    gradeId: "grade",
    gradeName: "#1",
    quantity: 37,
    sessionId: "sess",
  });
  assert.equal("error" in rejected, true);
  if ("error" in rejected) assert.equal(rejected.error, "Quantity must be 1.");
});

test("admin number pad adds and takes away through totals, piles, and shipping", async () => {
  const admin = await prisma.adminAccount.create({
    data: { name: "Levi Powers", email: "levi@example.com", passwordHash: "hash", updatedAt: new Date() },
  });
  adminSession.adminId = admin.id;
  const farm = await prisma.farm.create({
    data: { name: "Kilby", displayOrder: 0, active: true, updatedAt: new Date() },
  });
  const bare = await prisma.farm.create({
    data: { name: "Bare", displayOrder: 1, active: true, updatedAt: new Date() },
  });
  const customer = await prisma.customer.create({
    data: { name: "North Ridge", displayOrder: 0, active: true },
  });
  const size = await prisma.treeSize.create({
    data: { name: "6-7", requireFarm: true, displayOrder: 0, active: true, updatedAt: new Date() },
  });
  const boughs = await prisma.treeSize.create({
    data: { name: "Boughs", requireFarm: false, displayOrder: 1, active: true, updatedAt: new Date() },
  });
  const grade = await prisma.treeGrade.create({
    data: { name: "#1", requireFarm: true, displayOrder: 0, active: true, updatedAt: new Date() },
  });
  const scale = await prisma.treeGrade.create({
    data: {
      name: "Scale free",
      requireFarm: true,
      drawsFromGradeId: grade.id,
      displayOrder: 1,
      active: true,
      updatedAt: new Date(),
    },
  });
  await prisma.startingInventory.create({
    data: { farmId: farm.id, sizeId: size.id, gradeId: grade.id, quantity: 100, updatedAt: new Date() },
  });
  await prisma.countSession.create({
    data: { id: "tap-yard", action: "Yard Received", farmId: farm.id, farmName: "Kilby", startedAt: new Date("2026-10-01T14:00:00.000Z") },
  });
  await prisma.countSession.create({
    data: {
      id: "tap-ship",
      action: "Shipped",
      customerId: customer.id,
      customerName: "North Ridge",
      startedAt: new Date("2026-10-01T15:00:00.000Z"),
    },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.countRecord.create({
      data: {
        timestampLocal: "2026-10-01T10:00:00.000-04:00",
        timestampUtc: new Date("2026-10-01T14:00:00.000Z"),
        action: "Yard Received",
        farmId: farm.id,
        farmName: "Kilby",
        sizeId: size.id,
        sizeName: "6-7",
        gradeId: grade.id,
        gradeName: "#1",
        quantity: 1,
        sessionId: "tap-yard",
        clientSyncId: `yard-tap-${i}`,
      },
    });
  }
  for (let i = 0; i < 2; i++) {
    await prisma.countRecord.create({
      data: {
        timestampLocal: "2026-10-01T11:00:00.000-04:00",
        timestampUtc: new Date("2026-10-01T15:00:00.000Z"),
        action: "Shipped",
        customerId: customer.id,
        customerName: "North Ridge",
        sizeId: size.id,
        sizeName: "6-7",
        gradeId: grade.id,
        gradeName: "#1",
        quantity: 1,
        sessionId: "tap-ship",
        clientSyncId: `ship-tap-${i}`,
      },
    });
  }

  const yard = { action: "Yard Received", farmId: farm.id, sizeId: size.id, gradeId: grade.id };
  const ship = { action: "Shipped", customerId: customer.id, sizeId: size.id, gradeId: grade.id };

  const blockedCounter = await adjust.adminAdjustment(counterSession, { ...yard, mode: "commit", direction: "add", amount: 5, clientRequestId: "counter-try-1" });
  assert.equal(blockedCounter.ok, false);
  if (!blockedCounter.ok) assert.equal(blockedCounter.status, 403);
  assert.equal(await prisma.countRecord.count({ where: { clientSyncId: "counter-try-1" } }), 0);

  const status = await adjust.adminAdjustment(adminSession, { ...yard, mode: "status" });
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.current, 3);

  const beforePreview = await prisma.countRecord.count();
  const preview = await adjust.adminAdjustment(adminSession, { ...yard, mode: "preview", direction: "add", amount: 37 });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.summary, "Add 37 × 6-7 #1 at Kilby?");
    assert.match(preview.detail, /goes from 3 to 40/);
    assert.match(preview.detail, /60 of 100 are still not received/);
    assert.equal(preview.overPile, false);
  }
  assert.equal(await prisma.countRecord.count(), beforePreview);

  const over = await adjust.adminAdjustment(adminSession, { ...yard, mode: "preview", direction: "add", amount: 98 });
  assert.equal(over.ok, true);
  if (over.ok) {
    assert.match(over.detail, /over the starting 100/);
    assert.equal(over.overPile, true);
  }

  const added = await adjust.adminAdjustment(adminSession, {
    ...yard,
    mode: "commit",
    direction: "add",
    amount: 37,
    clientRequestId: "add-kilby-37",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.saved?.duplicate, false);

  const again = await adjust.adminAdjustment(adminSession, {
    ...yard,
    mode: "commit",
    direction: "add",
    amount: 37,
    clientRequestId: "add-kilby-37",
  });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.saved?.duplicate, true);
  assert.equal(await prisma.countRecord.count({ where: { clientSyncId: "add-kilby-37" } }), 1);

  let stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 40);
  assert.equal(stats.shipped, 2);
  assert.equal(stats.inventory, 38);
  let progress = await dashboard.farmProgress();
  const pile = progress.find((row) => row.farmId === farm.id && row.sizeId === size.id && row.gradeId === grade.id);
  assert.equal(pile?.received, 40);
  assert.equal(pile?.starting, 100);
  assert.equal(pile?.exceeded, false);
  assert.equal(pile?.notYetReceived, 60);

  const tap = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "yard-tap-0" } });
  assert.equal(tap.quantity, 1);
  assert.equal(tap.adjustmentDirection, null);
  assert.equal(tap.adjustedByName, null);
  const pad = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "add-kilby-37" } });
  assert.equal(pad.quantity, 37);
  assert.equal(pad.adjustmentDirection, "add");
  assert.equal(pad.adjustedByAdminId, admin.id);
  assert.equal(pad.adjustedByName, "Levi Powers");
  assert.match(pad.correctionNote || "", /Admin number pad · add 37 · Levi Powers/);

  const tooMany = await adjust.adminAdjustment(adminSession, { ...yard, mode: "commit", direction: "remove", amount: 100, clientRequestId: "take-too-many" });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.error, /Only 40/);
  assert.equal(await prisma.countRecord.count({ where: { clientSyncId: "take-too-many" } }), 0);

  const taken = await adjust.adminAdjustment(adminSession, { ...yard, mode: "commit", direction: "remove", amount: 10, clientRequestId: "take-kilby-10" });
  assert.equal(taken.ok, true);
  if (taken.ok) assert.equal(taken.summary, "Take away 10 × 6-7 #1 at Kilby?");
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 30);
  assert.equal(stats.shipped, 2);

  const shipped = await adjust.adminAdjustment(adminSession, { ...ship, mode: "commit", direction: "add", amount: 4, clientRequestId: "ship-add-4" });
  assert.equal(shipped.ok, true);
  if (shipped.ok) assert.equal(shipped.summary, "Add 4 × 6-7 #1 shipped to North Ridge?");
  const report = await customers.customerShippingReport();
  const north = report.customers.find((row) => row.id === customer.id);
  assert.equal(north?.totalTrees, 6);
  assert.equal(north?.bySizeGrade.find((row) => row.gradeId === grade.id)?.quantity, 6);
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 30);
  assert.equal(stats.shipped, 6);
  assert.equal(stats.inventory, 24);
  const shipTooMany = await adjust.adminAdjustment(adminSession, { ...ship, mode: "preview", direction: "remove", amount: 20 });
  assert.equal(shipTooMany.ok, false);
  if (!shipTooMany.ok) assert.match(shipTooMany.error, /Only 6/);

  const drawn = await adjust.adminAdjustment(adminSession, {
    action: "Yard Received",
    farmId: farm.id,
    sizeId: size.id,
    gradeId: scale.id,
    mode: "commit",
    direction: "add",
    amount: 5,
    clientRequestId: "scale-add-5",
  });
  assert.equal(drawn.ok, true);
  if (drawn.ok) {
    assert.equal(drawn.summary, "Add 5 × 6-7 Scale free at Kilby?");
    assert.match(drawn.detail, /draw from the #1 pile/);
  }
  progress = await dashboard.farmProgress();
  const pileAfterDraw = progress.find((row) => row.farmId === farm.id && row.sizeId === size.id && row.gradeId === grade.id);
  assert.equal(pileAfterDraw?.received, 35);
  assert.equal(pileAfterDraw?.exceeded, false);
  const scaleStatus = await adjust.adminAdjustment(adminSession, {
    action: "Yard Received",
    farmId: farm.id,
    sizeId: size.id,
    gradeId: scale.id,
    mode: "status",
  });
  assert.equal(scaleStatus.ok, true);
  if (scaleStatus.ok) assert.equal(scaleStatus.current, 5);
  const numberOne = await adjust.adminAdjustment(adminSession, { ...yard, mode: "status" });
  assert.equal(numberOne.ok, true);
  if (numberOne.ok) assert.equal(numberOne.current, 30);

  const missing = await adjust.adminAdjustment(adminSession, {
    action: "Yard Received",
    farmId: bare.id,
    sizeId: size.id,
    gradeId: grade.id,
    mode: "commit",
    direction: "add",
    amount: 8,
    clientRequestId: "bare-blocked",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /Bare does not list 6-7 #1/);
  assert.equal(await prisma.countRecord.count({ where: { clientSyncId: "bare-blocked" } }), 0);

  const loose = await adjust.adminAdjustment(adminSession, {
    action: "Yard Received",
    farmId: bare.id,
    sizeId: boughs.id,
    gradeId: grade.id,
    mode: "commit",
    direction: "add",
    amount: 2,
    clientRequestId: "boughs-add-2",
  });
  assert.equal(loose.ok, true);
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 37);

  const addRow = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "add-kilby-37" } });
  const takeRow = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "take-kilby-10" } });
  const voidAddFirst = await counts.voidCounts([addRow.id], "Void admin adjustment");
  assert.equal(voidAddFirst.ok, false);
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 37);

  const voidTake = await counts.voidCounts([takeRow.id], "Void admin adjustment");
  assert.equal(voidTake.ok, true);
  if (voidTake.ok) assert.equal(voidTake.voided, 1);
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 47);
  const voidAdd = await counts.voidCounts([addRow.id], "Void admin adjustment");
  assert.equal(voidAdd.ok, true);
  stats = await dashboard.dashboardStats();
  assert.equal(stats.received, 10);

  const doc = await backup.buildBackupDocument();
  const exportedAdd = doc.counts.find((row) => row.clientSyncId === "add-kilby-37");
  const exportedTap = doc.counts.find((row) => row.clientSyncId === "yard-tap-0");
  assert.equal(exportedAdd?.adjustmentDirection, "add");
  assert.equal(exportedAdd?.quantity, 37);
  assert.equal(exportedAdd?.adjustedByName, "Levi Powers");
  assert.equal(exportedAdd?.voidedAt == null, false);
  assert.equal(exportedTap?.quantity, 1);
  assert.equal(exportedTap?.adjustmentDirection, null);
  assert.equal(exportedTap?.adjustedByAdminId, null);

  const legacy = JSON.parse(JSON.stringify(doc)) as BackupMod["BackupDocument"] extends never ? never : import("../src/server/backup-document").BackupDocument;
  for (const row of legacy.counts) {
    delete (row as { adjustmentDirection?: unknown }).adjustmentDirection;
    delete (row as { adjustedByAdminId?: unknown }).adjustedByAdminId;
    delete (row as { adjustedByName?: unknown }).adjustedByName;
  }
  const parsedLegacy = backup.parseBackupDocument(legacy);
  assert.equal(parsedLegacy.ok, true);
  if (parsedLegacy.ok) assert.equal(parsedLegacy.doc.counts.every((row) => row.adjustmentDirection === null), true);

  const bad = JSON.parse(JSON.stringify(doc)) as typeof legacy;
  const badRow = bad.counts.find((row) => row.clientSyncId === "add-kilby-37");
  if (badRow) badRow.adjustmentDirection = "sideways" as "add";
  const parsedBad = backup.parseBackupDocument(bad);
  assert.equal(parsedBad.ok, false);

  const parsed = backup.parseBackupDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await backup.restoreBackupDocument(parsed.doc);
  const restored = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "add-kilby-37" } });
  assert.equal(restored.quantity, 37);
  assert.equal(restored.adjustmentDirection, "add");
  assert.equal(restored.adjustedByName, "Levi Powers");
  const restoredTap = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "yard-tap-0" } });
  assert.equal(restoredTap.quantity, 1);
  assert.equal(restoredTap.adjustmentDirection, null);
  const restoredTake = await prisma.countRecord.findUniqueOrThrow({ where: { clientSyncId: "take-kilby-10" } });
  assert.equal(restoredTake.quantity, -10);
  assert.equal(restoredTake.adjustmentDirection, "remove");
  assert.equal(await prisma.farm.findFirstOrThrow({ where: { name: "Kilby" } }).then((row) => row.name), "Kilby");

  const script = readFileSync(join(process.cwd(), "docs/backup-apps-script.gs"), "utf8");
  assert.match(
    script,
    /"id", "timestampLocal", "timestampUtc", "action", "farmId", "farmName", "customerId", "customerName", "sizeId", "sizeName", "gradeId", "gradeName", "quantity", "sessionId", "clientSyncId", "createdAt", "syncedAt", "voidedAt", "voidReason", "correctionNote", "correctedAt"/,
  );
  assert.doesNotMatch(script, /adjustmentDirection/);
});
