import { Router } from "express";
import { db } from "../../../db/client.js";
import { listAliases, getAlias } from "../../../models/registry.js";
import { validateModelBody } from "../../schemas/controlSchema.js";
import { NotFoundError, ValidationError } from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";

const router = Router();

function mapAliasForResponse(a: ReturnType<typeof getAlias>) {
  return {
    alias: a.alias,
    displayName: a.displayName,
    description: a.description,
    enabled: a.enabled,
  };
}

router.get("/", (_req, res, next) => {
  try {
    const aliases = listAliases().map(mapAliasForResponse);
    res.json(aliases);
  } catch (err) {
    next(err);
  }
});

router.put("/:alias", (req, res, next) => {
  try {
    const alias = req.params.alias;
    const existing = getAlias(alias); // throws NotFoundError if missing
    const body = validateModelBody(req.body);

    // Prevent disabling if any mode uses this as primary with no fallback
    if (body.enabled === false && existing.enabled) {
      const modesUsing = db
        .prepare(
          `SELECT mode FROM mode_settings
           WHERE primary_alias = ? AND (fallback_alias IS NULL OR fallback_alias = '')`,
        )
        .all(alias) as Array<{ mode: string }>;

      if (modesUsing.length > 0) {
        throw new ValidationError(
          `Alias '${alias}' is the sole primary for mode(s): ${modesUsing.map((m) => m.mode).join(", ")}. Add a fallback or keep enabled.`,
        );
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.displayName !== undefined) {
      fields.push("display_name = ?");
      values.push(body.displayName.trim());
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      values.push(body.description);
    }
    if (body.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(body.enabled ? 1 : 0);
    }

    if (fields.length > 0) {
      // model_aliases has no updated_at column.
      values.push(alias);

      const sql = `UPDATE model_aliases SET ${fields.join(", ")} WHERE alias = ?`;
      db.prepare(sql).run(...values);
    }

    const updated = getAlias(alias);
    logger.info("model alias updated", { alias, changes: body });
    res.json(mapAliasForResponse(updated));
  } catch (err) {
    if (err instanceof NotFoundError) {
      next(new ValidationError(err.message));
    } else {
      next(err);
    }
  }
});

export default router;
