import { db } from "../db/client.js";
import { logger } from "./logger.js";

type SettingRow = {
  key: string;
  value: string;
  updated_at: string;
};

export function getSetting<T>(key: string, fallback: T): T {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as SettingRow | undefined;

  if (!row) return fallback;

  try {
    return JSON.parse(row.value) as T;
  } catch (err) {
    logger.warn("settings: parse failed", { key, err });
    return fallback;
  }
}

export function setSetting<T>(key: string, value: T): void {
  const json = JSON.stringify(value);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, json);
}
