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

const dir = mkdtempSync(join(tmpdir(), "ptf-"));
const dbPath = join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

execSync("npx prisma db push --skip-generate", {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

async function carry(farmId: string, sizeId: string, gradeId: string, quantity = 20) {
  await prisma.startingInventory.upsert({
    where: { farmId_sizeId_gradeId: { farmId, sizeId, gradeId } },
    create: { farmId, sizeId, gradeId, quantity, updatedAt: new Date() },
    update: { quantity, updatedAt: new Date() },
  });
}

type SetupMod = typeof import("../src/server/setup");
type CountsMod = typeof import("../src/server/counts");
type FarmsMod = typeof import("../src/server/farms");
type PinsMod = typeof import("../src/server/pins");
type SecurityMod = typeof import("../src/lib/security");
type ConstantsMod = typeof import("../src/lib/constants");
type SizeColorMod = typeof import("../src/lib/size-color");

let setup: SetupMod;
let counts: CountsMod;
let farmsMod: FarmsMod;
let pins: PinsMod;
let security: SecurityMod;
let constants: ConstantsMod;
let sizeColor: SizeColorMod;

test("load modules against temp database", async () => {
  setup = await import("../src/server/setup");
  counts = await import("../src/server/counts");
  farmsMod = await import("../src/server/farms");
  pins = await import("../src/server/pins");
  security = await import("../src/lib/security");
  constants = await import("../src/lib/constants");
  sizeColor = await import("../src/lib/size-color");
  assert.ok(setup.createFirstAdmin);
});

test("password rules reject short secrets", async () => {
  assert.ok(security.validatePassword("short"));
  assert.equal(security.validatePassword("LongEnough99"), null);
});

test("blank PIN is never valid for login", async () => {
  assert.ok(security.validatePin(""));
  assert.ok(security.validatePin("   "));
  assert.equal(security.validatePin("1234"), null);
});

test("first admin setup locks permanently", async () => {
  assert.equal(await setup.setupLocked(), false);
  const first = await setup.createFirstAdmin({
    name: "Levi Powers",
    email: "levi@powerstreefarm.com",
    password: "FraserFir99!",
  });
  assert.equal(first.ok, true);
  assert.equal(await setup.setupLocked(), true);
  const second = await setup.createFirstAdmin({
    name: "Intruder",
    email: "other@example.com",
    password: "FraserFir99!",
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.status, 403);
  const sizes = await prisma.treeSize.count();
  const grades = await prisma.treeGrade.count();
  assert.equal(sizes, 6);
  assert.equal(grades, 3);
});

test("count sanitizer requires farm for yard and blanks farm for shipping", async () => {
  const yardBad = counts.sanitizeCount({
    clientSyncId: "a",
    timestampLocal: "2026-09-10T12:00:00.000-04:00",
    action: constants.ACTIONS.YARD,
    sizeId: "s",
    sizeName: "7-8",
    gradeId: "g",
    gradeName: "Premium",
    sessionId: "sess",
    quantity: 1,
  });
  assert.ok("error" in yardBad);

  const ship = counts.sanitizeCount({
    clientSyncId: "b",
    timestampLocal: "2026-09-10T12:00:00.000-04:00",
    action: constants.ACTIONS.SHIP,
    farmId: "should-ignore",
    farmName: "should-ignore",
    sizeId: "s",
    sizeName: "7-8",
    gradeId: "g",
    gradeName: "Premium",
    sessionId: "sess",
    quantity: 1,
    counterName: "Worker",
  });
  assert.ok(!("error" in ship));
  if (!("error" in ship)) {
    assert.equal(ship.farmId, null);
    assert.equal(ship.farmName, null);
  }
});

test("identity fields are detected and stripped from counts", async () => {
  assert.equal(counts.countHasIdentity({ sizeId: "s" }), false);
  assert.equal(counts.countHasIdentity({ counterName: "Pat" }), true);
  const clean = counts.sanitizeCount({
    clientSyncId: "c1",
    timestampLocal: "2026-09-10T12:00:00.000-04:00",
    action: constants.ACTIONS.SHIP,
    sizeId: "s",
    sizeName: "7-8",
    gradeId: "g",
    gradeName: "#1",
    sessionId: "sess",
    quantity: 1,
    email: "pat@farm",
    counterId: "abc",
  });
  assert.ok(!("error" in clean));
  if (!("error" in clean)) {
    assert.equal("email" in clean, false);
    assert.equal("counterId" in clean, false);
  }
});

test("sync dedupes by clientSyncId and stores snapshots", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  const farm = await prisma.farm.create({
    data: { name: "Bald Mountain", displayOrder: 0, active: true, updatedAt: new Date() },
  });
  await carry(farm.id, size.id, grade.id);
  const payload = {
    clientSyncId: "dup-1",
    timestampLocal: "2026-09-10T08:01:02.345-04:00",
    action: constants.ACTIONS.YARD,
    farmId: farm.id,
    farmName: farm.name,
    sizeId: size.id,
    sizeName: size.name,
    gradeId: grade.id,
    gradeName: grade.name,
    quantity: 1,
    sessionId: "session-1",
    sessionStartedAt: new Date().toISOString(),
  };
  const session = { role: "admin" as const, access: "admin" as const, name: "Levi", adminId: "x" };
  const first = await counts.syncCounts(session, [payload]);
  const second = await counts.syncCounts(session, [payload]);
  assert.equal(first.accepted.length, 1);
  assert.equal(first.accepted[0]?.duplicate, false);
  assert.equal(first.accepted[0]?.miscount, false);
  assert.equal(second.accepted[0]?.duplicate, true);
  assert.equal(second.accepted[0]?.miscount, false);
  assert.equal(await prisma.countRecord.count(), 1);
  assert.equal(await prisma.miscount.count(), 0);
  const row = await prisma.countRecord.findFirstOrThrow();
  assert.equal(row.farmName, "Bald Mountain");
  assert.equal(row.quantity, 1);
});

test("active PINs cannot collide across admin and counter accounts", async () => {
  const admin = await prisma.adminAccount.findFirstOrThrow();
  const pin = "2468";
  await prisma.adminAccount.update({
    where: { id: admin.id },
    data: { pinHash: await security.hashSecret(pin), pinKey: security.pinKey(pin) },
  });
  assert.equal(await pins.pinInUse(pin), true);
  await prisma.counterAccount.create({
    data: {
      accountLabel: "Yard tablet",
      pinHash: await security.hashSecret("9999"),
      pinKey: security.pinKey("9999"),
      access: "both",
      active: true,
      updatedAt: new Date(),
    },
  });
  assert.equal(await pins.pinInUse("9999"), true);
  const match = await pins.matchPin("2468");
  assert.equal(match?.kind, "admin");
});

test("size color accepts any hex and rejects junk", () => {
  assert.equal(sizeColor.normalizeSizeColor("#3d8a5c"), "#3d8a5c");
  assert.equal(sizeColor.normalizeSizeColor("e0b042"), "#e0b042");
  assert.equal(sizeColor.normalizeSizeColor("#ABC"), "#aabbcc");
  assert.equal(sizeColor.normalizeSizeColor(""), null);
  assert.equal(sizeColor.normalizeSizeColor("not-a-color"), null);
  assert.equal(sizeColor.contrastInk("#FFFFFF"), "#1b1710");
  assert.equal(sizeColor.contrastInk("#21543a"), "#f4efe3");
});

test("parseVoidIds accepts a single id or a batch and rejects empty/too-large lists", () => {
  assert.deepEqual(counts.parseVoidIds({ id: "abc" }), ["abc"]);
  assert.deepEqual(counts.parseVoidIds({ ids: ["a", "b", "a", ""] }), ["a", "b"]);
  assert.equal("error" in counts.parseVoidIds({ ids: [] }), true);
  assert.equal("error" in counts.parseVoidIds({}), true);
  const tooMany = Array.from({ length: 201 }, (_, i) => `id-${i}`);
  const over = counts.parseVoidIds({ ids: tooMany });
  assert.equal("error" in over, true);
});

test("voidCounts soft-voids a batch without requiring a reason", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  const farm = await prisma.farm.findFirstOrThrow();
  await carry(farm.id, size.id, grade.id);
  const session = { role: "admin" as const, access: "admin" as const, name: "Levi", adminId: "x" };
  const payloads = [1, 2, 3].map((n) => ({
    clientSyncId: `batch-${n}`,
    timestampLocal: `2026-09-10T08:0${n}:02.345-04:00`,
    action: constants.ACTIONS.YARD,
    farmId: farm.id,
    farmName: farm.name,
    sizeId: size.id,
    sizeName: size.name,
    gradeId: grade.id,
    gradeName: grade.name,
    quantity: 1,
    sessionId: "session-batch",
    sessionStartedAt: new Date().toISOString(),
  }));
  await counts.syncCounts(session, payloads);
  const rows = await prisma.countRecord.findMany({ where: { sessionId: "session-batch" }, orderBy: { timestampLocal: "asc" } });
  assert.equal(rows.length, 3);

  const first = await counts.voidCounts([rows[0]!.id]);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.voided, 1);
    assert.equal(first.requested, 1);
  }
  const again = await counts.voidCounts([rows[0]!.id, rows[1]!.id, rows[2]!.id]);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.voided, 2);
    assert.equal(again.requested, 3);
  }
  const after = await prisma.countRecord.findMany({ where: { sessionId: "session-batch" } });
  assert.equal(after.every((row) => row.voidedAt != null), true);
  assert.equal(after.every((row) => row.voidReason === "Admin correction"), true);

  const empty = await counts.voidCounts([]);
  assert.equal(empty.ok, false);
});

test("farm delete ignores voided counts and still deactivates farms with active counts", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  const session = { role: "admin" as const, access: "admin" as const, name: "Levi", adminId: "x" };

  const voidedFarm = await prisma.farm.create({
    data: { name: "Voided-only farm", displayOrder: 90, active: true, updatedAt: new Date() },
  });
  const activeFarm = await prisma.farm.create({
    data: { name: "Active-count farm", displayOrder: 91, active: true, updatedAt: new Date() },
  });
  const otherFarm = await prisma.farm.create({
    data: { name: "Keep this farm", displayOrder: 92, active: true, updatedAt: new Date() },
  });

  await prisma.startingInventory.create({
    data: { farmId: voidedFarm.id, sizeId: size.id, gradeId: grade.id, quantity: 12, updatedAt: new Date() },
  });
  await carry(activeFarm.id, size.id, grade.id);
  await carry(otherFarm.id, size.id, grade.id);

  await counts.syncCounts(session, [
    {
      clientSyncId: "void-farm-1",
      timestampLocal: "2026-09-16T08:01:02.345-04:00",
      action: constants.ACTIONS.YARD,
      farmId: voidedFarm.id,
      farmName: voidedFarm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-void-farm",
      sessionStartedAt: new Date().toISOString(),
    },
    {
      clientSyncId: "active-farm-1",
      timestampLocal: "2026-09-16T08:02:02.345-04:00",
      action: constants.ACTIONS.YARD,
      farmId: activeFarm.id,
      farmName: activeFarm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-active-farm",
      sessionStartedAt: new Date().toISOString(),
    },
    {
      clientSyncId: "other-farm-1",
      timestampLocal: "2026-09-16T08:03:02.345-04:00",
      action: constants.ACTIONS.YARD,
      farmId: otherFarm.id,
      farmName: otherFarm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-other-farm",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);

  const voidedRow = await prisma.countRecord.findFirstOrThrow({ where: { farmId: voidedFarm.id } });
  await counts.voidCounts([voidedRow.id]);

  assert.equal(await farmsMod.countActiveFarmCounts(voidedFarm.id), 0);
  assert.equal(await farmsMod.countActiveFarmCounts(activeFarm.id), 1);
  assert.equal(await prisma.countRecord.count({ where: { farmId: voidedFarm.id } }), 1);

  const voidedDelete = await farmsMod.deleteOrDeactivateFarm(voidedFarm.id);
  assert.equal(voidedDelete.ok, true);
  if (voidedDelete.ok) assert.equal("deleted" in voidedDelete && voidedDelete.deleted, true);
  assert.equal(await prisma.farm.findUnique({ where: { id: voidedFarm.id } }), null);
  assert.equal(await prisma.countRecord.count({ where: { farmId: voidedFarm.id } }), 0);
  assert.equal(await prisma.startingInventory.count({ where: { farmId: voidedFarm.id } }), 0);
  assert.equal(await prisma.countSession.findUnique({ where: { id: "session-void-farm" } }), null);

  const activeDelete = await farmsMod.deleteOrDeactivateFarm(activeFarm.id);
  assert.equal(activeDelete.ok, true);
  if (activeDelete.ok) {
    assert.equal("deactivated" in activeDelete && activeDelete.deactivated, true);
  }
  const stillThere = await prisma.farm.findUniqueOrThrow({ where: { id: activeFarm.id } });
  assert.equal(stillThere.active, false);
  assert.equal(await prisma.countRecord.count({ where: { farmId: activeFarm.id, voidedAt: null } }), 1);
  assert.equal(await prisma.farm.findUnique({ where: { id: otherFarm.id } }) != null, true);
  assert.equal(await prisma.countRecord.count({ where: { farmId: otherFarm.id } }), 1);

  const mixedFarm = await prisma.farm.create({
    data: { name: "Mixed farm", displayOrder: 93, active: true, updatedAt: new Date() },
  });
  await carry(mixedFarm.id, size.id, grade.id);
  await counts.syncCounts(session, [
    {
      clientSyncId: "mixed-active",
      timestampLocal: "2026-09-16T09:01:02.345-04:00",
      action: constants.ACTIONS.YARD,
      farmId: mixedFarm.id,
      farmName: mixedFarm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-mixed-farm",
      sessionStartedAt: new Date().toISOString(),
    },
    {
      clientSyncId: "mixed-void",
      timestampLocal: "2026-09-16T09:02:02.345-04:00",
      action: constants.ACTIONS.YARD,
      farmId: mixedFarm.id,
      farmName: mixedFarm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-mixed-farm",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);
  const mixedVoid = await prisma.countRecord.findFirstOrThrow({ where: { clientSyncId: "mixed-void" } });
  await counts.voidCounts([mixedVoid.id]);
  const mixedDelete = await farmsMod.deleteOrDeactivateFarm(mixedFarm.id);
  assert.equal(mixedDelete.ok, true);
  if (mixedDelete.ok) assert.equal("deactivated" in mixedDelete && mixedDelete.deactivated, true);
  assert.equal(await prisma.countRecord.count({ where: { farmId: mixedFarm.id } }), 2);
});

test("yard tap on a farm's starting inventory counts and does not create a miscount", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grades = await prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } });
  const grade = grades[0]!;
  const other = grades[1]!;
  const farm = await prisma.farm.create({
    data: { name: "Listed farm", displayOrder: 40, active: true, updatedAt: new Date() },
  });
  await carry(farm.id, size.id, grade.id, 0);
  const before = await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } });
  const session = { role: "counter" as const, access: "yard" as const, name: "Yard tablet", counterId: "counter-listed" };
  const result = await counts.syncCounts(session, [
    {
      clientSyncId: "listed-ok",
      timestampLocal: "2026-09-25T09:00:00.000-04:00",
      action: constants.ACTIONS.YARD,
      farmId: farm.id,
      farmName: "Wrong snapshot",
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-listed",
      sessionStartedAt: new Date().toISOString(),
      counterName: "Should not be stored on the count",
    },
  ]);
  assert.equal(result.accepted[0]?.miscount, false);
  assert.equal(await prisma.miscount.count({ where: { farmId: farm.id } }), 0);
  assert.equal(await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } }), before + 1);
  assert.equal(other.id.length > 0, true);
});

test("yard tap missing from starting inventory is a miscount and does not change the live count", async () => {
  const sizes = await prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } });
  const grades = await prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } });
  const size = sizes[0]!;
  const otherSize = sizes[1]!;
  const grade = grades[0]!;
  const otherGrade = grades[1]!;
  const farm = await prisma.farm.create({
    data: { name: "Ridge farm", displayOrder: 41, active: true, updatedAt: new Date() },
  });
  await carry(farm.id, size.id, grade.id, 8);
  const liveBefore = await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } });
  const session = { role: "counter" as const, access: "yard" as const, name: "Ridge crew", counterId: "counter-ridge" };

  const valid = await counts.syncCounts(session, [
    {
      clientSyncId: "ridge-valid",
      timestampLocal: "2026-09-25T10:00:00.000-04:00",
      action: constants.ACTIONS.YARD,
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-ridge",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(valid.accepted[0]?.miscount, false);

  const invalid = await counts.syncCounts(session, [
    {
      clientSyncId: "ridge-bad",
      timestampLocal: "2026-09-25T10:01:00.000-04:00",
      action: constants.ACTIONS.YARD,
      farmId: farm.id,
      farmName: "Client farm name",
      sizeId: otherSize.id,
      sizeName: "client-size",
      gradeId: otherGrade.id,
      gradeName: "client-grade",
      quantity: 1,
      sessionId: "session-ridge",
      sessionStartedAt: new Date().toISOString(),
      counterName: "Spoofed",
      counterId: "spoof",
    },
  ]);
  assert.equal(invalid.accepted.length, 1);
  assert.equal(invalid.accepted[0]?.miscount, true);
  assert.equal(invalid.rejected.length, 0);
  assert.equal(await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } }), liveBefore + 1);
  assert.equal(await prisma.countRecord.count({ where: { clientSyncId: "ridge-bad" } }), 0);

  const again = await counts.syncCounts(session, [
    {
      clientSyncId: "ridge-bad",
      timestampLocal: "2026-09-25T10:01:00.000-04:00",
      action: constants.ACTIONS.YARD,
      farmId: farm.id,
      farmName: farm.name,
      sizeId: otherSize.id,
      sizeName: otherSize.name,
      gradeId: otherGrade.id,
      gradeName: otherGrade.name,
      quantity: 1,
      sessionId: "session-ridge",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(again.accepted[0]?.duplicate, true);
  assert.equal(again.accepted[0]?.miscount, true);
  assert.equal(await prisma.miscount.count({ where: { clientSyncId: "ridge-bad" } }), 1);

  const row = await prisma.miscount.findFirstOrThrow({ where: { clientSyncId: "ridge-bad" } });
  assert.equal(row.farmId, farm.id);
  assert.equal(row.farmName, "Ridge farm");
  assert.equal(row.sizeName, otherSize.name);
  assert.equal(row.gradeName, otherGrade.name);
  assert.equal(row.counterId, "counter-ridge");
  assert.equal(row.counterName, "Ridge crew");
  assert.equal(row.counterRole, "counter");
});

test("shipping taps are not checked against farm inventory", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  const before = await prisma.countRecord.count({ where: { action: constants.ACTIONS.SHIP, voidedAt: null } });
  const misBefore = await prisma.miscount.count();
  const session = { role: "counter" as const, access: "shipping" as const, name: "Ship crew", counterId: "counter-ship" };
  const result = await counts.syncCounts(session, [
    {
      clientSyncId: "ship-free",
      timestampLocal: "2026-09-25T11:00:00.000-04:00",
      action: constants.ACTIONS.SHIP,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-ship-free",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(result.accepted[0]?.miscount, false);
  assert.equal(await prisma.countRecord.count({ where: { action: constants.ACTIONS.SHIP, voidedAt: null } }), before + 1);
  assert.equal(await prisma.miscount.count(), misBefore);
});

test("admin delete removes only the miscount row", async () => {
  const miscounts = await import("../src/server/miscounts");
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  const farm = await prisma.farm.create({
    data: { name: "Delete farm", displayOrder: 42, active: true, updatedAt: new Date() },
  });
  await carry(farm.id, size.id, grade.id, 3);
  const session = { role: "admin" as const, access: "admin" as const, name: "Levi", adminId: "admin-levi" };
  await counts.syncCounts(session, [
    {
      clientSyncId: "keep-live",
      timestampLocal: "2026-09-25T12:00:00.000-04:00",
      action: constants.ACTIONS.YARD,
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: "session-delete-mis",
      sessionStartedAt: new Date().toISOString(),
    },
  ]);
  const live = await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } });
  await prisma.miscount.create({
    data: {
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      counterId: "counter-x",
      counterName: "Pat",
      counterRole: "counter",
      timestampLocal: "2026-09-25T12:05:00.000-04:00",
      timestampUtc: new Date("2026-09-25T16:05:00.000Z"),
      clientSyncId: "drop-miscount",
    },
  });
  const older = await prisma.miscount.create({
    data: {
      farmId: farm.id,
      farmName: farm.name,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      counterId: "counter-y",
      counterName: "Sam",
      counterRole: "counter",
      timestampLocal: "2026-09-25T08:00:00.000-04:00",
      timestampUtc: new Date("2026-09-25T12:00:00.000Z"),
      clientSyncId: "older-miscount",
    },
  });
  const listed = await miscounts.listMiscounts();
  const ids = listed.filter((row) => row.farmId === farm.id).map((row) => row.id);
  assert.equal(ids[0] !== older.id, true);
  assert.ok(listed.findIndex((row) => row.clientSyncId === undefined || row.farmName === farm.name) >= 0);
  const farmRows = listed.filter((row) => row.farmId === farm.id);
  assert.equal(farmRows[0]?.counterName, "Pat");
  assert.equal(farmRows[1]?.counterName, "Sam");

  const removed = await miscounts.deleteMiscount(farmRows[0]!.id);
  assert.equal(removed.ok, true);
  assert.equal(await prisma.miscount.count({ where: { clientSyncId: "drop-miscount" } }), 0);
  assert.equal(await prisma.miscount.count({ where: { clientSyncId: "older-miscount" } }), 1);
  assert.equal(await prisma.countRecord.count({ where: { farmId: farm.id, voidedAt: null } }), live);
  const missing = await miscounts.deleteMiscount("nope");
  assert.equal(missing.ok, false);
});

test("non-admin cannot list or delete miscounts", async () => {
  const { NextRequest } = await import("next/server");
  const { signSession } = await import("../src/lib/session-edge");
  const { GET, DELETE } = await import("../src/app/api/admin/miscounts/route");
  const miscounts = await import("../src/server/miscounts");

  assert.equal(miscounts.canReviewMiscounts(null), false);
  assert.equal(
    miscounts.canReviewMiscounts({ role: "counter", access: "both", name: "Pat", counterId: "c" }),
    false,
  );
  assert.equal(miscounts.canReviewMiscounts({ role: "admin", access: "admin", name: "Levi", adminId: "a" }), true);

  const counterToken = await signSession({
    role: "counter",
    counterId: "counter-nope",
    access: "both",
    name: "Pat",
  });
  const counterReq = new NextRequest("http://localhost/api/admin/miscounts", {
    headers: { cookie: `ptf_session=${counterToken}` },
  });
  const listed = await GET(counterReq);
  assert.equal(listed.status, 401);
  const deleted = await DELETE(
    new NextRequest("http://localhost/api/admin/miscounts", {
      method: "DELETE",
      headers: { cookie: `ptf_session=${counterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "any" }),
    }),
  );
  assert.equal(deleted.status, 401);

  const anon = await GET(new NextRequest("http://localhost/api/admin/miscounts"));
  assert.equal(anon.status, 401);

  const before = await prisma.miscount.count();
  const adminToken = await signSession({ role: "admin", adminId: "admin-1", access: "admin", name: "Levi" });
  const adminList = await GET(
    new NextRequest("http://localhost/api/admin/miscounts", {
      headers: { cookie: `ptf_session=${adminToken}` },
    }),
  );
  assert.equal(adminList.status, 200);
  const body = (await adminList.json()) as { miscounts: { id: string }[] };
  assert.ok(Array.isArray(body.miscounts));
  if (body.miscounts[0]) {
    const liveBefore = await prisma.countRecord.count();
    const adminDelete = await DELETE(
      new NextRequest("http://localhost/api/admin/miscounts", {
        method: "DELETE",
        headers: { cookie: `ptf_session=${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ id: body.miscounts[0].id }),
      }),
    );
    assert.equal(adminDelete.status, 200);
    assert.equal(await prisma.miscount.count(), before - 1);
    assert.equal(await prisma.countRecord.count(), liveBefore);
  }
});

test("tree sizes store optional color without touching grades", async () => {
  const size = await prisma.treeSize.findFirstOrThrow();
  const grade = await prisma.treeGrade.findFirstOrThrow();
  await prisma.treeSize.update({ where: { id: size.id }, data: { color: "#e0b042" } });
  const again = await prisma.treeSize.findUniqueOrThrow({ where: { id: size.id } });
  assert.equal(again.color, "#e0b042");
  assert.equal("color" in grade, false);
});

test("cleanup temp database", async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
