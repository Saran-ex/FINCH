import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(backendRoot, "src", "db", "migrations");
const distDir = path.join(backendRoot, "dist", "db", "migrations");

const sqlFiles = existsSync(srcDir)
  ? readdirSync(srcDir).filter((name) => name.endsWith(".sql"))
  : [];

if (sqlFiles.length === 0) {
  console.error(`[build] no migration .sql files found in ${srcDir}`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });

for (const name of sqlFiles) {
  copyFileSync(path.join(srcDir, name), path.join(distDir, name));
}

console.log(`[build] copied ${sqlFiles.length} migration .sql file(s) to dist/db/migrations`);
