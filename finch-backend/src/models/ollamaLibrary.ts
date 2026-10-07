import { config } from "../config/index.js";
import { logger } from "../services/logger.js";

export type InstalledOllamaModel = {
  name: string;
  size: number;
  modifiedAt: string;
};

type CacheEntry = { at: number; models: InstalledOllamaModel[] };

// Short-lived cache so /api/control/modes and the library route do not hammer
// Ollama; the library route asks for a forced refresh so a freshly pulled model
// shows up immediately.
const TTL_MS = 5000;
let cache: CacheEntry | null = null;

export async function listInstalledOllamaModels(options?: {
  force?: boolean;
}): Promise<InstalledOllamaModel[]> {
  const force = options?.force === true;
  if (!force && cache !== null && Date.now() - cache.at < TTL_MS)
    return cache.models;

  const res = await fetch(`${config.ollamaUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Ollama /api/tags failed (${res.status})`);

  const json = (await res.json()) as { models?: unknown };
  const rows = Array.isArray(json.models) ? json.models : [];
  const models: InstalledOllamaModel[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    if (typeof m.name !== "string" || m.name.length === 0) continue;
    models.push({
      name: m.name,
      size: typeof m.size === "number" ? m.size : 0,
      modifiedAt: typeof m.modified_at === "string" ? m.modified_at : "",
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  return models;
}

/**
 * Installed model names, or null when Ollama cannot be reached. Callers treat
 * null as "unknown" and skip install-filtering instead of failing the request.
 */
export async function tryListInstalledModelNames(): Promise<string[] | null> {
  try {
    const models = await listInstalledOllamaModels();
    return models.map((m) => m.name);
  } catch (err) {
    logger.warn("ollama: listing installed models failed", { err });
    return null;
  }
}
