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

type SetupMod = typeof import("../src/server/setup");
type CountsMod = typeof import("../src/server/counts");
type PinsMod = typeof import("../src/server/pins");
type SecurityMod = typeof import("../src/lib/security");
type ConstantsMod = typeof import("../src/lib/constants");
type SizeColorMod = typeof import("../src/lib/size-color");

let setup: SetupMod;
let counts: CountsMod;
let pins: PinsMod;
let security: SecurityMod;
let constants: ConstantsMod;
let sizeColor: SizeColorMod;

test("load modules against temp database", async () => {
  setup = await import("../src/server/setup");
  counts = await import("../src/server/counts");
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
  assert.equal(second.accepted[0]?.duplicate, true);
  assert.equal(await prisma.countRecord.count(), 1);
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
