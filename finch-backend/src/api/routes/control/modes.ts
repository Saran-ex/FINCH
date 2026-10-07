import { Router } from "express";
import { db } from "../../../db/client.js";
import {
  listModes,
  getModeConfig,
  resolveAllowedAliases,
  getDefaultAlias,
} from "../../../modes/manager.js";
import { getAlias } from "../../../models/registry.js";
import { tryListInstalledModelNames } from "../../../models/ollamaLibrary.js";
import { validateModeBody } from "../../schemas/controlSchema.js";
import { ensureValidMode } from "../../../modes/validation.js";
import type { Mode } from "../../../config/constants.js";
import { NotFoundError, ValidationError } from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";

const router = Router();

type AliasRow = {
  id: number;
  alias: string;
  display_name: string;
  ollama_model: string;
  enabled: number;
};

// "1.5b" from "qwen2.5:1.5b", "4b" from "gemma3:4b"
function paramSizeOf(ollamaModel: string): string {
  const tag = ollamaModel.includes(":")
    ? ollamaModel.slice(ollamaModel.lastIndexOf(":") + 1)
    : ollamaModel;
  return tag.split("-")[0];
}

export function mapModeForResponse(
  m: ReturnType<typeof getModeConfig>,
  installed: string[] | null,
) {
  const primaryDisplayName = getAlias(m.primaryAlias).displayName;
  const fallbackDisplayName = m.fallbackAlias
    ? getAlias(m.fallbackAlias).displayName
    : null;

  const allowedAliases = resolveAllowedAliases(m.mode);
  const rows = db
    .prepare(
      "SELECT id, alias, display_name, ollama_model, enabled FROM model_aliases ORDER BY id",
    )
    .all() as AliasRow[];
  const byAlias = new Map(rows.map((r) => [r.alias, r]));

  // `installed === null` means Ollama did not answer: keep the database view
  // rather than emptying every picker. Otherwise only models that really are
  // on the machine are offered.
  const allowedModels = allowedAliases
    .map((alias) => byAlias.get(alias))
    .filter((r): r is AliasRow => r !== undefined && r.enabled === 1)
    .filter((r) => installed === null || installed.includes(r.ollama_model))
    .map((r) => ({
      id: r.id,
      alias: r.alias,
      displayName: r.display_name,
      paramSize: paramSizeOf(r.ollama_model),
      enabled: r.enabled === 1,
    }));

  return {
    mode: m.mode,
    primaryAlias: m.primaryAlias,
    primaryDisplayName,
    fallbackAlias: m.fallbackAlias,
    fallbackDisplayName,
    useMemory: m.useMemory,
    useSummaries: m.useSummaries,
    enabled: m.enabled,
    defaultAlias: getDefaultAlias(m.mode),
    allowedAliases,
    allowedModels,
  };
}

router.get("/", async (_req, res, next) => {
  try {
    const installed = await tryListInstalledModelNames();
    const modes = listModes().map((m) => mapModeForResponse(m, installed));
    res.json(modes);
  } catch (err) {
    next(err);
  }
});

router.put("/:mode", async (req, res, next) => {
  try {
    const mode = ensureValidMode(req.params.mode);
    const body = validateModeBody(req.body);
    updateModeSettings(mode, body);
    logger.info("mode updated", { mode, changes: body });
    res.json(
      mapModeForResponse(
        getModeConfig(mode),
        await tryListInstalledModelNames(),
      ),
    );
  } catch (err) {
    if (err instanceof NotFoundError) {
      next(new ValidationError(err.message));
    } else {
      next(err);
    }
  }
});

/**
 * Applies a validated field patch to mode_settings. Kept out of the route so
 * the allowed-set write can be exercised without standing up an HTTP server.
 */
export function updateModeSettings(
  mode: Mode,
  body: ReturnType<typeof validateModeBody>,
): void {
  // Check enabled=false won't leave zero enabled modes
  if (body.enabled === false) {
    const current = getModeConfig(mode);
    if (current.enabled) {
      const enabledCount = listModes().filter((m) => m.enabled).length;
      if (enabledCount <= 1) {
        throw new ValidationError("Cannot disable the last enabled mode");
      }
    }
  }

  // Validate aliases if provided
  if (body.primaryAlias) getAlias(body.primaryAlias);
  if (body.fallbackAlias) getAlias(body.fallbackAlias);

  // The allowed set must reference real, currently usable models. An unknown
  // or disabled alias here would silently vanish from every picker.
  if (body.allowedAliases) {
    for (const alias of body.allowedAliases) {
      const info = getAlias(alias);
      if (!info.enabled) {
        throw new ValidationError(
          `Model '${alias}' is disabled and cannot be allowed`,
        );
      }
    }
  }

  // Build dynamic UPDATE
  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.primaryAlias !== undefined) {
    fields.push("primary_alias = ?");
    values.push(body.primaryAlias);
  }
  if (body.allowedAliases !== undefined) {
    fields.push("allowed_aliases = ?");
    values.push(JSON.stringify(body.allowedAliases));
  }
  if (body.useMemory !== undefined) {
    fields.push("use_memory = ?");
    values.push(body.useMemory ? 1 : 0);
  }
  if (body.useSummaries !== undefined) {
    fields.push("use_summaries = ?");
    values.push(body.useSummaries ? 1 : 0);
  }
  if (body.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(mode);

  const sql = `UPDATE mode_settings SET ${fields.join(", ")} WHERE mode = ?`;
  db.prepare(sql).run(...values);
}

export default router;
