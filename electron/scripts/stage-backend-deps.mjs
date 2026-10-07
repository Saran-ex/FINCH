import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The installer must ship ONLY the production dependencies of finch-backend.
// Pruning the dev checkout would break `npm run dev`, and a fresh
// `npm ci --omit=dev` cannot run here (better-sqlite3 has no Visual Studio to
// fall back to when its prebuilt download is unavailable), so the production
// closure is copied out of the existing dev node_modules instead:
// `npm ls --omit=dev --parseable --all` lists exactly the prod packages, and
// each one is cloned (natives included) into staging/backend/node_modules.
// The stage is reused while package.json + lockfile stay unchanged.

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(electronRoot, "..");
const backendDir = path.join(repoRoot, "finch-backend");
const backendPkg = path.join(backendDir, "package.json");
const backendLock = path.join(backendDir, "package-lock.json");
const stagingDir = path.join(electronRoot, "staging", "backend");
const stagingModules = path.join(stagingDir, "node_modules");
const stampFile = path.join(stagingDir, ".stamp");
// Native artifacts that must survive the copy (their absence would only show
// up as a runtime crash on the installed app): better-sqlite3 ships per-platform
// prebuilds inside its own package, sherpa's native .node + DLLs live in the
// platform-specific optional package.
const nativeProbe = path.join(
  stagingModules,
  "better-sqlite3",
  "prebuilds",
  "win32-x64.node",
);

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function stagedAndFresh() {
  return (
    existsSync(stagingModules) &&
    existsSync(nativeProbe) &&
    existsSync(stampFile) &&
    readFileSync(stampFile, "utf-8") === currentStamp
  );
}

const currentStamp = `${digest(backendPkg)}:${digest(backendLock)}`;

if (stagedAndFresh()) {
  console.log("[stage] backend production node_modules already staged (lockfile unchanged)");
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const listing = spawnSync(npm, ["ls", "--omit=dev", "--all", "--parseable"], {
  cwd: backendDir,
  encoding: "utf-8",
  shell: true,
});
if (!listing.stdout) {
  console.error(`[stage] npm ls failed: ${listing.stderr || `exit ${listing.status}`}`);
  process.exit(1);
}

const nodeModulesPrefix = path.join(backendDir, "node_modules") + path.sep;
const packages = listing.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith(nodeModulesPrefix));

if (packages.length === 0) {
  console.error("[stage] npm ls returned no production packages");
  process.exit(1);
}

// Start clean: an interrupted earlier stage (or a failed npm ci attempt)
// must not leave stale packages mixed into the tree.
rmSync(stagingModules, { recursive: true, force: true });
mkdirSync(stagingModules, { recursive: true });
let copied = 0;
for (const packageDir of packages) {
  // Optional deps for other platforms (sherpa-onnx-darwin-arm64, ...) are
  // listed by npm ls but never installed on this machine.
  if (!existsSync(packageDir)) continue;
  const relative = path.relative(backendDir, packageDir);
  cpSync(packageDir, path.join(stagingDir, relative), { recursive: true });
  copied += 1;
}

const requiredArtifacts = [
  nativeProbe,
  path.join(stagingModules, "sherpa-onnx-node", "package.json"),
  path.join(stagingModules, "sherpa-onnx-win-x64", "sherpa-onnx.node"),
  path.join(stagingModules, "sherpa-onnx-win-x64", "onnxruntime.dll"),
  path.join(stagingModules, "express", "package.json"),
];
for (const artifact of requiredArtifacts) {
  if (!existsSync(artifact)) {
    console.error(`[stage] production package missing after copy: ${artifact}`);
    process.exit(1);
  }
}

writeFileSync(stampFile, currentStamp);
console.log(`[stage] copied ${copied} production package(s) to staging/backend/node_modules`);
