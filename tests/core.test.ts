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

let setup: SetupMod;
let counts: CountsMod;
let pins: PinsMod;
let security: SecurityMod;
let constants: ConstantsMod;

test("load modules against temp database", async () => {
  setup = await import("../src/server/setup");
  counts = await import("../src/server/counts");
  pins = await import("../src/server/pins");
  security = await import("../src/lib/security");
  constants = await import("../src/lib/constants");
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

test("cleanup temp database", async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
