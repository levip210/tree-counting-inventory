"use strict";

/**
 * Copy prisma CLI + @prisma/client and their transitive dependencies into a
 * dest directory so `node …/prisma/build/index.js migrate deploy` works in the
 * slim Next.js standalone image without a network install.
 *
 * The dest must be a real node_modules tree (dest/node_modules/<pkg>). Prisma 6
 * loads ESM packages such as c12 via `import`, which ignores NODE_PATH. A flat
 * copy at /opt/prisma-node_modules/c12 therefore fails with:
 *   Cannot find package 'c12' imported from …/@prisma/config/dist/index.js
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");

const srcRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "node_modules"));
const destRoot = path.resolve(process.argv[3] || "/prisma-node-modules");
const skipVerify = process.argv.includes("--no-verify");
const modulesRoot =
  path.basename(destRoot) === "node_modules" ? destRoot : path.join(destRoot, "node_modules");
const seen = new Set();

function resolvePkgDir(fromPkgJson, dep) {
  const req = createRequire(fromPkgJson);
  try {
    return path.dirname(req.resolve(`${dep}/package.json`));
  } catch {
    // Many packages omit "./package.json" from "exports".
  }
  try {
    let dir = path.dirname(req.resolve(dep));
    for (let i = 0; i < 20; i++) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (pkg.name === dep) return dir;
        } catch {
          // keep walking
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // optional / unmet optional native deps
  }
  const hoisted = path.join(srcRoot, dep);
  if (fs.existsSync(path.join(hoisted, "package.json"))) return hoisted;
  return null;
}

function addPkg(pkgDir) {
  if (!pkgDir || !fs.existsSync(pkgDir)) return;
  const real = fs.realpathSync(pkgDir);
  if (seen.has(real)) return;
  seen.add(real);
  if (real !== srcRoot && !real.startsWith(srcRoot + path.sep)) return;

  const rel = path.relative(srcRoot, real);
  if (!rel || rel.startsWith("..")) return;
  fs.cpSync(real, path.join(modulesRoot, rel), { recursive: true });

  const pkgJson = path.join(real, "package.json");
  if (!fs.existsSync(pkgJson)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  for (const dep of Object.keys(deps)) {
    addPkg(resolvePkgDir(pkgJson, dep));
  }
}

fs.mkdirSync(modulesRoot, { recursive: true });
addPkg(path.join(srcRoot, "prisma"));
addPkg(path.join(srcRoot, "@prisma/client"));
// ESM packages Prisma loads by name (NODE_PATH does not help import()).
for (const extra of ["@prisma/config", "@prisma/engines", "c12", "effect"]) {
  addPkg(path.join(srcRoot, extra));
}

const cli = path.join(modulesRoot, "prisma", "build", "index.js");
if (!fs.existsSync(cli)) {
  console.error("prisma CLI was not copied to", cli);
  process.exit(1);
}

if (!skipVerify) {
  const configJs = path.join(modulesRoot, "@prisma/config", "dist", "index.js");
  if (!fs.existsSync(configJs)) {
    console.error("@prisma/config was not copied to", configJs);
    process.exit(1);
  }
  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(configJs).href)});`,
      ],
      { stdio: "inherit" },
    );
  } catch {
    console.error(
      "ESM import of @prisma/config failed (c12/effect will not resolve at migrate time).",
      "Expected packages under",
      modulesRoot,
    );
    process.exit(1);
  }
}

console.log(`copied ${seen.size} prisma-related packages to ${modulesRoot}`);
