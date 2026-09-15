"use strict";

/**
 * Copy prisma CLI + @prisma/client and their transitive dependencies into a
 * dest directory so `node node_modules/prisma/build/index.js migrate deploy`
 * works in the slim Next.js standalone image without a network install.
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const srcRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "node_modules"));
const destRoot = path.resolve(process.argv[3] || "/prisma-node-modules");
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
  fs.cpSync(real, path.join(destRoot, rel), { recursive: true });

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

fs.mkdirSync(destRoot, { recursive: true });
addPkg(path.join(srcRoot, "prisma"));
addPkg(path.join(srcRoot, "@prisma/client"));

const cli = path.join(destRoot, "prisma", "build", "index.js");
if (!fs.existsSync(cli)) {
  console.error("prisma CLI was not copied to", cli);
  process.exit(1);
}

console.log(`copied ${seen.size} prisma-related packages to ${destRoot}`);
