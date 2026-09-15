"use strict";

/**
 * Production safety net for SQLite on the Railway volume.
 *
 * If `prisma migrate deploy` hiccups, the Next app still starts (CMD uses `;`)
 * and then P2022s on TreeSize.color. This adds the column when missing without
 * dropping tables or rewriting farm data, and records the Prisma migration so a
 * later successful migrate does not try ADD COLUMN twice.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SIZE_COLOR_MIGRATION = "20260915180000_size_color";

const PRISMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);`;

function sqlitePathFromDatabaseUrl(databaseUrl, cwd = process.cwd()) {
  if (!databaseUrl) return null;
  const raw = String(databaseUrl).trim();
  if (!raw.startsWith("file:")) return null;
  let rest = raw.slice("file:".length);
  if (rest.startsWith("///")) rest = rest.slice(2);
  if (path.isAbsolute(rest)) return rest;
  return path.resolve(cwd, rest);
}

function openSqlite(filePath) {
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(filePath);
}

function tableExists(db, name) {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return Boolean(row);
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all().map((c) => c.name);
}

function fileChecksum(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function recordMigration(db, { name, sqlPath }) {
  if (!tableExists(db, "_prisma_migrations")) {
    db.exec(PRISMA_MIGRATIONS_DDL);
  }
  const existing = db
    .prepare(`SELECT 1 AS ok FROM "_prisma_migrations" WHERE "migration_name" = ?`)
    .get(name);
  if (existing) return { recorded: false };
  if (!fs.existsSync(sqlPath)) {
    console.error("[start] migration sql missing, cannot record", sqlPath);
    return { recorded: false };
  }
  const checksum = fileChecksum(sqlPath);
  db.prepare(
    `INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
      VALUES (?, ?, datetime('now'), ?, NULL, NULL, datetime('now'), 1)`,
  ).run(crypto.randomUUID(), checksum, name);
  return { recorded: true };
}

function ensureSqliteSchema(databaseUrl, options = {}) {
  const cwd = options.cwd || process.cwd();
  const migrationsDir = options.migrationsDir || path.join(cwd, "prisma", "migrations");
  const dbPath = sqlitePathFromDatabaseUrl(databaseUrl, cwd);
  if (!dbPath) {
    return { ok: false, reason: "unsupported-database-url" };
  }
  if (!fs.existsSync(dbPath)) {
    console.error("[start] sqlite file not found, skip schema ensure:", dbPath);
    return { ok: false, reason: "missing-db", dbPath };
  }

  const db = openSqlite(dbPath);
  try {
    if (!tableExists(db, "TreeSize")) {
      console.error("[start] TreeSize table missing; not creating tables (refusing to wipe/rebuild).");
      return { ok: false, reason: "missing-table", dbPath };
    }

    const cols = columnNames(db, "TreeSize");
    let added = false;
    if (!cols.includes("color")) {
      console.log('[start] TreeSize.color missing; ALTER TABLE "TreeSize" ADD COLUMN "color" TEXT');
      db.exec(`ALTER TABLE "TreeSize" ADD COLUMN "color" TEXT`);
      added = true;
    }

    const sqlPath = path.join(migrationsDir, SIZE_COLOR_MIGRATION, "migration.sql");
    const { recorded } = recordMigration(db, { name: SIZE_COLOR_MIGRATION, sqlPath });
    if (added) console.log("[start] added TreeSize.color without touching existing rows");
    if (recorded) console.log("[start] recorded prisma migration", SIZE_COLOR_MIGRATION);

    const again = columnNames(db, "TreeSize");
    if (!again.includes("color")) {
      return { ok: false, reason: "color-still-missing", dbPath, added, recorded };
    }
    return { ok: true, dbPath, added, recorded };
  } finally {
    db.close();
  }
}

module.exports = {
  SIZE_COLOR_MIGRATION,
  sqlitePathFromDatabaseUrl,
  ensureSqliteSchema,
};

if (require.main === module) {
  const result = ensureSqliteSchema(process.env.DATABASE_URL);
  if (!result.ok) {
    console.error("[start] schema ensure failed", result.reason || "");
    process.exit(1);
  }
  process.exit(0);
}
