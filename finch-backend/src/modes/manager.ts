import { db } from "../db/client.js";
import type { Mode } from "../config/constants.js";
import { NotFoundError } from "../services/errors.js";
import { listAliases } from "../models/registry.js";

export type ModeConfig = {
  mode: Mode;
  primaryAlias: string;
  fallbackAlias: string | null;
  useMemory: boolean;
  useSummaries: boolean;
  enabled: boolean;
  /** Raw stored list; empty array means "all enabled aliases". */
  allowedAliases: string[];
};

type ModeRow = {
  mode: string;
  primary_alias: string;
  fallback_alias: string | null;
  use_memory: number;
  use_summaries: number;
  enabled: number;
  allowed_aliases: string | null;
};

const SELECT_COLUMNS =
  "mode, primary_alias, fallback_alias, use_memory, use_summaries, enabled, allowed_aliases";

export function parseAllowed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((a): a is string => typeof a === "string")
      : [];
  } catch {
    return [];
  }
}

function toModeConfig(row: ModeRow): ModeConfig {
  return {
    mode: row.mode as Mode,
    primaryAlias: row.primary_alias,
    fallbackAlias: row.fallback_alias,
    useMemory: row.use_memory === 1,
    useSummaries: row.use_summaries === 1,
    enabled: row.enabled === 1,
    allowedAliases: parseAllowed(row.allowed_aliases),
  };
}

export function getModeConfig(mode: Mode): ModeConfig {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM mode_settings WHERE mode = ?`)
    .get(mode) as ModeRow | undefined;

  if (!row) throw new NotFoundError(`Mode '${mode}' not configured`);

  return toModeConfig(row);
}

export function listModes(): ModeConfig[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM mode_settings ORDER BY mode`)
    .all() as ModeRow[];

  return rows.map(toModeConfig);
}

/**
 * Effective allowed aliases for a mode, always restricted to enabled aliases.
 * - Stored list (e.g. conversation/search/research) → that list.
 * - Empty stored list (plan) → all enabled aliases, so new aliases are picked up automatically.
 */
export function resolveAllowedAliases(mode: Mode): string[] {
  const config = getModeConfig(mode);
  const enabled = listAliases()
    .filter((a) => a.enabled)
    .map((a) => a.alias);

  const stored = config.allowedAliases.filter((alias) =>
    enabled.includes(alias),
  );
  if (stored.length > 0) return stored;
  return enabled;
}

/** Default alias for a mode (its primary), guaranteed to be allowed. */
export function getDefaultAlias(mode: Mode): string {
  const config = getModeConfig(mode);
  const allowed = resolveAllowedAliases(mode);
  if (allowed.includes(config.primaryAlias)) return config.primaryAlias;
  return allowed[0] ?? config.primaryAlias;
}
