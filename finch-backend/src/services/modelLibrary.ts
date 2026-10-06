import { db } from "../db/client.js";
import { listInstalledOllamaModels } from "../models/ollamaLibrary.js";
import { parseAllowed } from "../modes/manager.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { logger } from "./logger.js";

export type LibraryModel = {
  alias: string;
  ollamaModel: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
};

export type ModelLibrary = {
  ollamaReachable: boolean;
  models: LibraryModel[];
};

type AliasRow = {
  alias: string;
  display_name: string;
  ollama_model: string;
  description: string | null;
  enabled: number;
};

const SELECT_ALIAS =
  "SELECT alias, display_name, ollama_model, description, enabled FROM model_aliases";

function mapRow(row: AliasRow): LibraryModel {
  return {
    alias: row.alias,
    ollamaModel: row.ollama_model,
    displayName: row.display_name,
    description: row.description,
    enabled: row.enabled === 1,
  };
}

/**
 * Asks Ollama what is actually installed and mirrors that into model_aliases,
 * so the pickers show exactly the machine's models and a newly pulled model
 * appears with no code change. Rows are never deleted — a model that disappears
 * from Ollama simply stops being listed.
 */
export async function syncModelLibrary(): Promise<ModelLibrary> {
  let installed: string[];
  try {
    installed = (await listInstalledOllamaModels({ force: true })).map((m) => m.name);
  } catch (err) {
    logger.warn("library: Ollama unreachable, returning an empty library", { err });
    return { ollamaReachable: false, models: [] };
  }

  const rows = db.prepare(SELECT_ALIAS).all() as AliasRow[];
  const byOllamaModel = new Map(rows.map((r) => [r.ollama_model, r]));
  const byAlias = new Map(rows.map((r) => [r.alias, r]));

  const insert = db.prepare(
    "INSERT OR IGNORE INTO model_aliases (alias, display_name, ollama_model, description, enabled) VALUES (?, ?, ?, NULL, 1)",
  );

  const merged = new Map<string, AliasRow>();
  const pending: AliasRow[] = [];
  for (const name of installed) {
    const existing = byOllamaModel.get(name) ?? byAlias.get(name);
    if (existing) {
      merged.set(name, existing);
      continue;
    }
    const row: AliasRow = {
      alias: name,
      display_name: name,
      ollama_model: name,
      description: null,
      enabled: 1,
    };
    pending.push(row);
    merged.set(name, row);
  }

  if (pending.length > 0) {
    const register = db.transaction((rows: AliasRow[]) => {
      for (const row of rows) insert.run(row.alias, row.display_name, row.ollama_model);
    });
    register(pending);
    logger.info("library: registered newly installed models", {
      models: pending.map((r) => r.alias),
    });
  }

  const models: LibraryModel[] = [];
  for (const name of installed) {
    const row = merged.get(name);
    if (row) models.push(mapRow(row));
  }
  return { ollamaReachable: true, models };
}

/**
 * Enable/disable a model. Disabling only hides it from the mode pickers: the
 * alias row (and anything in history that references it) is kept, and every
 * mode that was pointing at it is moved to another enabled model.
 */
export function setModelLibraryEnabled(alias: string, enabled: boolean): LibraryModel {
  const row = db.prepare(`${SELECT_ALIAS} WHERE alias = ?`).get(alias) as AliasRow | undefined;
  if (!row) throw new NotFoundError(`Model '${alias}' not found`);

  if (enabled) {
    db.prepare("UPDATE model_aliases SET enabled = 1 WHERE alias = ?").run(alias);
    logger.info("library: model enabled", { alias });
    return mapRow({ ...row, enabled: 1 });
  }

  const remaining = db
    .prepare("SELECT alias FROM model_aliases WHERE enabled = 1 AND alias <> ? ORDER BY id")
    .all(alias) as Array<{ alias: string }>;
  if (remaining.length === 0) {
    throw new ValidationError("At least one model must stay enabled.");
  }
  const nextDefault = remaining[0]!.alias;

  const modes = db
    .prepare("SELECT mode, primary_alias, fallback_alias, allowed_aliases FROM mode_settings")
    .all() as Array<{
    mode: string;
    primary_alias: string;
    fallback_alias: string | null;
    allowed_aliases: string;
  }>;

  const apply = db.transaction(() => {
    db.prepare("UPDATE model_aliases SET enabled = 0 WHERE alias = ?").run(alias);
    for (const m of modes) {
      if (m.primary_alias === alias) {
        const preferred =
          m.fallback_alias !== null &&
          m.fallback_alias !== alias &&
          remaining.some((r) => r.alias === m.fallback_alias)
            ? m.fallback_alias
            : nextDefault;
        db.prepare(
          "UPDATE mode_settings SET primary_alias = ?, updated_at = datetime('now') WHERE mode = ?",
        ).run(preferred, m.mode);
      }
      if (m.fallback_alias === alias) {
        db.prepare(
          "UPDATE mode_settings SET fallback_alias = NULL, updated_at = datetime('now') WHERE mode = ?",
        ).run(m.mode);
      }
      // Pull the model out of every mode's explicit allowed set. A set that
      // empties out is stored as '[]', which resolveAllowedAliases reads as
      // "every enabled model" rather than "no models".
      const stored = parseAllowed(m.allowed_aliases);
      if (stored.length > 0) {
        const pruned = stored.filter((a) => a !== alias);
        db.prepare(
          "UPDATE mode_settings SET allowed_aliases = ?, updated_at = datetime('now') WHERE mode = ?",
        ).run(JSON.stringify(pruned), m.mode);
      }
    }
  });
  apply();

  logger.info("library: model disabled, modes re-pointed", { alias, nextDefault });
  return mapRow({ ...row, enabled: 0 });
}
