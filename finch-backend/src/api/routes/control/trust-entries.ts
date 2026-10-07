import { Router } from "express";
import { db } from "../../../db/client.js";
import { validateTrustEntryBody } from "../../schemas/controlSchema.js";
import { ValidationError } from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";
import {
  addTrustEntry,
  removeTrustEntry,
  trustEntryExists,
  type TrustKind,
} from "../../../services/trustList.js";

const router = Router();

const MAX_ENTRIES_PER_LIST = 500;

type TrustEntryRow = {
  id: number;
  value: string;
};

function readId(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError("id must be a positive integer");
  }
  const id = parseInt(raw, 10);
  if (id <= 0) {
    throw new ValidationError("id must be a positive integer");
  }
  return id;
}

// Reads live from the DB; never throws so GET always returns arrays.
function readEntries(kind: TrustKind): TrustEntryRow[] {
  try {
    const rows = db
      .prepare(
        "SELECT id, value FROM trust_entries WHERE kind = ? ORDER BY value ASC",
      )
      .all(kind) as TrustEntryRow[];
    return rows;
  } catch (err) {
    logger.warn("trust entries: failed to load list", {
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function entryCount(kind: TrustKind): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM trust_entries WHERE kind = ?")
    .get(kind) as { count: number };
  return row.count;
}

router.get("/", (_req, res, next) => {
  try {
    res.json({
      high: readEntries("high"),
      suffix: readEntries("suffix"),
      low: readEntries("low"),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", (req, res, next) => {
  try {
    const { kind, value } = validateTrustEntryBody(req.body);

    if (trustEntryExists(kind, value)) {
      throw new ValidationError("Entry already exists in this list");
    }
    if (entryCount(kind) >= MAX_ENTRIES_PER_LIST) {
      throw new ValidationError("Maximum 500 entries per list");
    }

    const created = addTrustEntry(kind, value);

    logger.info("trust entry added", { kind, value });
    res.status(201).json({ id: created.id, kind, value: created.value });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    const id = readId(req.params.id);

    removeTrustEntry(id);

    logger.info("trust entry deleted", { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
