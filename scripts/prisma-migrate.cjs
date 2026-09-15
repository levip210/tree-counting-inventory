"use strict";

/**
 * Run `prisma migrate deploy` in a child process that is guaranteed to exit.
 *
 * Invoking `node node_modules/prisma/build/index.js` as PID 1 (or as the left
 * side of `cmd && node server.js`) often never returns after a successful
 * SQLite migrate: the CLI prints "No pending migrations" then leaves the
 * Node event loop open (stdin / query engine handles). Railway then reports
 * SUCCESS with nothing listening → 502.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PRISMA_ROOT = "/opt/prisma-node_modules";
const cli = path.join(PRISMA_ROOT, "prisma", "build", "index.js");
if (!fs.existsSync(cli)) {
  console.error("[start] prisma CLI not found at", cli);
  process.exit(1);
}
const successRe =
  /No pending migrations to apply|All migrations have been successfully applied|The following migration\(s\) have been applied/i;

console.log("[start] prisma migrate deploy");

const child = spawn(process.execPath, [cli, "migrate", "deploy"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    // /opt/prisma-node_modules is a node_modules-shaped tree (prisma, c12, effect, …).
    NODE_PATH: [PRISMA_ROOT, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  },
});

let buf = "";
let settled = false;

function finish(code) {
  if (settled) return;
  settled = true;
  process.exit(code);
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
      // Give a clean exit a moment, then force the hung CLI off the event loop.
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
