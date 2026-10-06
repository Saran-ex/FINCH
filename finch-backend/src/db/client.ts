import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { logger } from "../services/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendRoot = path.resolve(__dirname, "../..");
const dbAbsolutePath = path.resolve(backendRoot, config.dbPath);

fs.mkdirSync(path.dirname(dbAbsolutePath), { recursive: true });

export const db = new Database(dbAbsolutePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

logger.info(`[db] SQLite database at: ${dbAbsolutePath}`);

export function closeDb(): void {
  try { db.close(); } catch { /* ignore */ }
}