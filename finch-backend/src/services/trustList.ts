import { db } from "../db/client.js";
import { NotFoundError } from "./errors.js";
import { logger } from "./logger.js";

export type TrustKind = "high" | "suffix" | "low";

export function getHighTrustDomains(): string[] {
  try {
    const rows = db
      .prepare("SELECT value FROM trust_entries WHERE kind = ? ORDER BY value ASC")
      .all("high") as Array<{ value: string }>;
    return rows.map((row) => row.value);
  } catch (err) {
    logger.warn("trust list: failed to load high trust domains", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function getHighTrustSuffixes(): string[] {
  try {
    const rows = db
      .prepare("SELECT value FROM trust_entries WHERE kind = ? ORDER BY value ASC")
      .all("suffix") as Array<{ value: string }>;
    return rows.map((row) => row.value);
  } catch (err) {
    logger.warn("trust list: failed to load high trust suffixes", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function getLowTrustDomains(): string[] {
  try {
    const rows = db
      .prepare("SELECT value FROM trust_entries WHERE kind = ? ORDER BY value ASC")
      .all("low") as Array<{ value: string }>;
    return rows.map((row) => row.value);
  } catch (err) {
    logger.warn("trust list: failed to load low trust domains", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function addTrustEntry(kind: TrustKind, value: string): { id: number; value: string } {
  const result = db
    .prepare("INSERT INTO trust_entries (kind, value) VALUES (?, ?)")
    .run(kind, value);
  return { id: Number(result.lastInsertRowid), value };
}

export function removeTrustEntry(id: number): void {
  const existing = db
    .prepare("SELECT 1 FROM trust_entries WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new NotFoundError("Entry not found");
  }
  db.prepare("DELETE FROM trust_entries WHERE id = ?").run(id);
}

export function trustEntryExists(kind: TrustKind, value: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM trust_entries WHERE kind = ? AND value = ?")
    .get(kind, value);
  return row !== undefined;
}
