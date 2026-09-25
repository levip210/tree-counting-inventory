"use strict";

/**
 * Run `prisma migrate deploy` in a child process that is guaranteed to exit.
 *
 * Invoking `node node_modules/prisma/build/index.js` as PID 1 (or as the left
 * side of `cmd && node server.js`) often never returns after a successful
 * SQLite migrate: the CLI prints "No pending migrations" then leaves the
 * Node event loop open (stdin / query engine handles). Railway then reports
 * SUCCESS with nothing listening → 502.
 *
 * Prisma 6 resolves ESM deps (c12) from a real node_modules tree. NODE_PATH
 * is not enough — keep the CLI under /opt/prisma-node_modules/node_modules.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ensureSqliteSchema } = require("./ensure-sqlite-schema.cjs");

function prismaCliPath() {
  const roots = [
    process.env.PRISMA_NODE_MODULES,
    "/opt/prisma-node_modules/node_modules",
    "/opt/prisma-node_modules",
  ].filter(Boolean);
  for (const root of roots) {
    const cli = path.join(root, "prisma", "build", "index.js");
    if (fs.existsSync(cli)) return { root, cli };
  }
  return { root: null, cli: null };
}

const successRe =
  /No pending migrations to apply|All migrations have been successfully applied|The following migration\(s\) have been applied/i;

function runMigrate() {
  return new Promise((resolve) => {
    const { root, cli } = prismaCliPath();
    if (!cli) {
      console.error("[start] prisma CLI not found under /opt/prisma-node_modules");
      resolve(1);
      return;
    }

    console.log("[start] prisma migrate deploy");

    const schema = path.join(process.cwd(), "prisma", "schema.prisma");
    const args = [cli, "migrate", "deploy"];
    if (fs.existsSync(schema)) args.push("--schema", schema);

    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_PATH: [root, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
      },
    });

    let buf = "";
    let settled = false;

    function finish(code) {
      if (settled) return;
      settled = true;
      resolve(code);
    }

    function sawSuccess() {
      return successRe.test(buf);
    }

    function killCli() {
      if (child.killed || settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1500);
    }

    for (const stream of ["stdout", "stderr"]) {
      child[stream].on("data", (chunk) => {
        const text = chunk.toString();
        buf += text;
        process.stdout.write(text);
        if (sawSuccess()) {
          setTimeout(killCli, 400);
        }
      });
    }

    child.on("error", (err) => {
      console.error("[start] failed to spawn prisma CLI", err);
      finish(1);
    });

    child.on("exit", (code, signal) => {
      if (sawSuccess() || code === 0 || signal === "SIGTERM" || signal === "SIGKILL") {
        finish(0);
        return;
      }
      finish(code || 1);
    });

    setTimeout(() => {
      if (settled) return;
      console.error("[start] prisma migrate deploy timed out after 60s");
      killCli();
      finish(sawSuccess() ? 0 : 1);
    }, 60_000);
  });
}

async function main() {
  let migrateCode = 1;
  try {
    migrateCode = await runMigrate();
  } catch (err) {
    console.error("[start] prisma migrate deploy crashed", err);
    migrateCode = 1;
  }

  let ensured = { ok: false };
  try {
    ensured = ensureSqliteSchema(process.env.DATABASE_URL);
  } catch (err) {
    console.error("[start] schema ensure crashed", err);
    ensured = { ok: false, reason: "crashed" };
  }

  if (ensured.ok) {
    if (migrateCode !== 0) {
      console.log("[start] migrate reported failure; schema ensure left TreeSize.color and Miscount in place");
    }
    process.exit(0);
  }
  process.exit(migrateCode || 1);
}

main();
