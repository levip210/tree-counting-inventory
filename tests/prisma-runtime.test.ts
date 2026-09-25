import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import {
  SIZE_COLOR_MIGRATION,
  MISCOUNT_MIGRATION,
  sqlitePathFromDatabaseUrl,
  ensureSqliteSchema,
} from "../scripts/ensure-sqlite-schema.cjs";

const copyScript = join(process.cwd(), "scripts/copy-prisma-runtime.cjs");
const migrateScript = join(process.cwd(), "scripts/prisma-migrate.cjs");
const srcModules = join(process.cwd(), "node_modules");

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("sqlite path parsing matches Prisma file: URLs", () => {
  assert.equal(sqlitePathFromDatabaseUrl("file:/app/data/app.db"), "/app/data/app.db");
  assert.equal(sqlitePathFromDatabaseUrl("file:///app/data/app.db"), "/app/data/app.db");
  assert.equal(
    sqlitePathFromDatabaseUrl("file:./data/app.db", "/workspace"),
    join("/workspace", "data/app.db"),
  );
  assert.equal(sqlitePathFromDatabaseUrl("postgres://x"), null);
});

test("copy-prisma-runtime nests packages so ESM c12 resolves", () => {
  const dest = mkdtempSync(join(tmpdir(), "ptf-prisma-copy-"));
  try {
    execFileSync(process.execPath, [copyScript, srcModules, dest], { stdio: "pipe" });
    const cli = join(dest, "node_modules/prisma/build/index.js");
    const c12 = join(dest, "node_modules/c12/package.json");
    const configJs = join(dest, "node_modules/@prisma/config/dist/index.js");
    assert.equal(existsSync(cli), true, "prisma CLI");
    assert.equal(existsSync(c12), true, "c12 package");
    assert.equal(existsSync(join(dest, "c12")), false, "must not flatten c12 at dest root");

    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(configJs).href)});`],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr + result.stdout, /Cannot find package 'c12'/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("flat prisma copy reproduces the production c12 ESM failure", () => {
  const dest = mkdtempSync(join(tmpdir(), "ptf-prisma-flat-"));
  const dbPath = join(dest, "app.db");
  try {
    execFileSync(process.execPath, [copyScript, srcModules, join(dest, "node_modules"), "--no-verify"], {
      stdio: "pipe",
    });
    // Hoist packages one level up — the layout that shipped to Railway.
    execFileSync("cp", ["-a", join(dest, "node_modules") + "/.", dest]);
    rmSync(join(dest, "node_modules"), { recursive: true, force: true });

    const cli = join(dest, "prisma/build/index.js");
    const result = spawnSync(
      process.execPath,
      [cli, "migrate", "deploy", "--schema", join(process.cwd(), "prisma/schema.prisma")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          DATABASE_URL: `file:${dbPath}`,
          NODE_PATH: dest,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /Cannot find package 'c12'/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("schema ensure adds TreeSize.color without wiping farm rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptf-ensure-"));
  const dbPath = join(dir, "app.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE "TreeSize" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "displayOrder" INTEGER NOT NULL DEFAULT 0,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Farm" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL
    );
    INSERT INTO "TreeSize" VALUES ('size-1', '6-7 ft', 0, 1, datetime('now'), datetime('now'));
    INSERT INTO "Farm" VALUES ('farm-1', 'Home farm');
  `);
  db.close();

  const first = ensureSqliteSchema(`file:${dbPath}`);
  assert.equal(first.ok, true);
  assert.equal(first.added, true);

  const again = new DatabaseSync(dbPath);
  const cols = again.prepare(`PRAGMA table_info("TreeSize")`).all().map((c: { name: string }) => c.name);
  assert.ok(cols.includes("color"));
  const size = again.prepare(`SELECT id, name, color FROM "TreeSize"`).get() as {
    id: string;
    name: string;
    color: string | null;
  };
  const farm = again.prepare(`SELECT id, name FROM "Farm"`).get() as { id: string; name: string };
  assert.equal(size.id, "size-1");
  assert.equal(size.name, "6-7 ft");
  assert.equal(size.color, null);
  assert.equal(farm.name, "Home farm");

  const migration = again
    .prepare(`SELECT checksum, migration_name FROM "_prisma_migrations" WHERE migration_name = ?`)
    .get(SIZE_COLOR_MIGRATION) as { checksum: string; migration_name: string };
  assert.equal(migration.migration_name, SIZE_COLOR_MIGRATION);
  assert.equal(
    migration.checksum,
    sha256File(join(process.cwd(), "prisma/migrations", SIZE_COLOR_MIGRATION, "migration.sql")),
  );
  const miscount = again
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Miscount'`)
    .get() as { name: string } | undefined;
  assert.equal(miscount?.name, "Miscount");
  const miscountMigration = again
    .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?`)
    .get(MISCOUNT_MIGRATION) as { migration_name: string };
  assert.equal(miscountMigration.migration_name, MISCOUNT_MIGRATION);
  again.close();

  const second = ensureSqliteSchema(`file:${dbPath}`);
  assert.equal(second.ok, true);
  assert.equal(second.added, false);
  assert.equal(second.recorded, false);
  assert.equal(second.miscountAdded, false);

  rmSync(dir, { recursive: true, force: true });
});

test("prisma-migrate.cjs still adds TreeSize.color when the CLI cannot start", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptf-fallback-"));
  const dbPath = join(dir, "app.db");
  const fakeModules = join(dir, "empty-modules");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE "TreeSize" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "displayOrder" INTEGER NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO "TreeSize" VALUES ('keep', '6-7 ft', 0, 1, datetime('now'), datetime('now'));
    `);
    db.close();

    const result = spawnSync(process.execPath, [migrateScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
        PRISMA_NODE_MODULES: fakeModules,
      },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout + result.stderr, /TreeSize\.color missing/);

    const check = new DatabaseSync(dbPath);
    const cols = check.prepare(`PRAGMA table_info("TreeSize")`).all().map((c: { name: string }) => c.name);
    const row = check.prepare(`SELECT id, name FROM "TreeSize"`).get() as { id: string; name: string };
    const miscount = check
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Miscount'`)
      .get() as { name: string } | undefined;
    assert.ok(cols.includes("color"));
    assert.equal(row.id, "keep");
    assert.equal(miscount?.name, "Miscount");
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prisma-migrate.cjs applies size_color on a prod-like volume db", () => {
  const dest = mkdtempSync(join(tmpdir(), "ptf-migrate-"));
  const dbPath = join(dest, "app.db");
  try {
    execFileSync(process.execPath, [copyScript, srcModules, dest], { stdio: "pipe" });

    const db = new DatabaseSync(dbPath);
    db.exec(readFileSync(join(process.cwd(), "prisma/migrations/20260910120000_init/migration.sql"), "utf8"));
    const initChecksum = sha256File(join(process.cwd(), "prisma/migrations/20260910120000_init/migration.sql"));
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    );`);
    db.prepare(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        VALUES ('init-id', ?, datetime('now'), '20260910120000_init', NULL, NULL, datetime('now'), 1)`,
    ).run(initChecksum);
    db.exec(`INSERT INTO "Farm" ("id","name","displayOrder","active","createdAt","updatedAt")
      VALUES ('farm-keep','Home farm',0,1,datetime('now'),datetime('now'))`);
    db.exec(`INSERT INTO "TreeSize" ("id","name","displayOrder","active","createdAt","updatedAt")
      VALUES ('size-keep','6-7 ft',0,1,datetime('now'),datetime('now'))`);
    db.close();

    const result = spawnSync(process.execPath, [migrateScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
        PRISMA_NODE_MODULES: join(dest, "node_modules"),
      },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.doesNotMatch(result.stdout + result.stderr, /Cannot find package 'c12'/);

    const check = new DatabaseSync(dbPath);
    const cols = check.prepare(`PRAGMA table_info("TreeSize")`).all().map((c: { name: string }) => c.name);
    assert.ok(cols.includes("color"));
    const farm = check.prepare(`SELECT name FROM "Farm" WHERE id = 'farm-keep'`).get() as { name: string };
    assert.equal(farm.name, "Home farm");
    const applied = check
      .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?`)
      .get(SIZE_COLOR_MIGRATION);
    const miscountApplied = check
      .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?`)
      .get(MISCOUNT_MIGRATION);
    const miscount = check
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Miscount'`)
      .get() as { name: string } | undefined;
    assert.ok(applied);
    assert.ok(miscountApplied);
    assert.equal(miscount?.name, "Miscount");
    const farmStill = check.prepare(`SELECT name FROM "Farm" WHERE id = 'farm-keep'`).get() as { name: string };
    assert.equal(farmStill.name, "Home farm");
    check.close();
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
