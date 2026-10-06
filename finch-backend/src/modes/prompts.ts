import { db } from "../db/client.js";
import type { Mode } from "../config/constants.js";
import { NotFoundError } from "../services/errors.js";

export function loadPrompt(mode: Mode): string {
  const row = db.prepare(
    "SELECT system_prompt FROM prompts WHERE mode = ?"
  ).get(mode) as { system_prompt: string } | undefined;

  if (!row) throw new NotFoundError(`Prompt for mode '${mode}' not found`);
  return row.system_prompt;
}

export function savePrompt(mode: Mode, systemPrompt: string): void {
  db.prepare(
    `INSERT INTO prompts (mode, system_prompt, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(mode) DO UPDATE SET
       system_prompt = excluded.system_prompt,
       updated_at    = excluded.updated_at`
  ).run(mode, systemPrompt);
}