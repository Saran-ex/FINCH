import { db } from "../db/client.js";
import type { ModelAlias } from "../types/mode.js";
import { ollamaAdapter } from "./ollamaAdapter.js";
import type { ModelAdapter } from "./adapter.js";
import { NotFoundError } from "../services/errors.js";

type AliasRow = {
  alias: string;
  display_name: string;
  ollama_model: string;
  description: string | null;
  enabled: number;
};

export function listAliases(): ModelAlias[] {
  const rows = db.prepare(
    "SELECT alias, display_name, ollama_model, description, enabled FROM model_aliases ORDER BY id"
  ).all() as AliasRow[];

  return rows.map((r) => ({
    alias: r.alias,
    displayName: r.display_name,
    ollamaModel: r.ollama_model,
    description: r.description,
    enabled: r.enabled === 1,
  }));
}

export function getAlias(alias: string): ModelAlias {
  const row = db.prepare(
    "SELECT alias, display_name, ollama_model, description, enabled FROM model_aliases WHERE alias = ?"
  ).get(alias) as AliasRow | undefined;

  if (!row) throw new NotFoundError(`Model alias '${alias}' not found`);

  return {
    alias: row.alias,
    displayName: row.display_name,
    ollamaModel: row.ollama_model,
    description: row.description,
    enabled: row.enabled === 1,
  };
}

export function getAdapter(_alias: string): ModelAdapter {
  // Only Ollama for now. Future: return different adapters based on alias.
  return ollamaAdapter;
}
