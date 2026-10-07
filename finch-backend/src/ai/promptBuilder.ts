import type { Mode } from "../config/constants.js";
import { getModeConfig } from "../config/modeConfig.js";
import { db } from "../db/client.js";
import { loadPrompt } from "../modes/prompts.js";
import { logger } from "../services/logger.js";

type ConfirmedMemoryRow = {
  title: string;
  summary_text: string;
};

function loadConfirmedMemory(): ConfirmedMemoryRow[] {
  try {
    return db
      .prepare(
        `SELECT e.title, e.summary_text
           FROM memory_entries e
           JOIN memory_batches b ON b.id = e.batch_id
          WHERE b.status = 'confirmed'
          ORDER BY b.confirmed_at DESC, e.id DESC`,
      )
      .all() as ConfirmedMemoryRow[];
  } catch (err) {
    logger.warn("prompt: failed to load confirmed memory", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function buildLongTermMemoryBlock(): string {
  const rows = loadConfirmedMemory();
  if (rows.length === 0) {
    return "";
  }
  const bullets = rows.map((row) => `- ${row.title}: ${row.summary_text}`);
  return `## User Long-Term Memory & Preferences
The following facts and preferences are saved from past conversations with this user:
${bullets.join("\n")}`;
}

// Reads the live prompt from the `prompts` table on every turn (no caching),
// so an edit saved in Settings > Prompts applies to the very next message.
function loadSystemPromptText(currentMode: Mode): string {
  const fallback = getModeConfig(currentMode).systemPrompt;
  try {
    const dbPrompt = loadPrompt(currentMode).trim();
    return dbPrompt.length > 0 ? dbPrompt : fallback;
  } catch (err) {
    logger.warn("prompt: failed to load prompt from database, using fallback", {
      mode: currentMode,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

export function buildSystemPrompt(currentMode: Mode): string {
  const systemPrompt = loadSystemPromptText(currentMode);
  if (currentMode !== "conversation") {
    return systemPrompt;
  }
  const memoryBlock = buildLongTermMemoryBlock();
  if (!memoryBlock) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n${memoryBlock}`;
}

// Appended to the system prompt when the reply is streamed as plain prose.
// Keeps the streamed text TTS-friendly (there is no JSON router contract on
// this call; intent generation was removed).
export const STREAM_REPLY_GUIDANCE = `Reply constraints for this response:
- Output ONLY the reply itself as plain prose: no JSON, no markdown, no labels, no preamble.
- Keep it under 40 words unless the user explicitly asked for detail.`;
