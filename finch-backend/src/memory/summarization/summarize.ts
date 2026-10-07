import { selectMessages } from "./selectMessages.js";
import { ollamaAdapter } from "../../models/ollamaAdapter.js";
import { getAlias } from "../../models/registry.js";
import {
  listTurnResultsInRange,
  projectTurnForSummary,
  type CompactTurn,
} from "../../services/turnResults.js";
import { logger } from "../../services/logger.js";

const NUM_PREDICT = 1024;
const TEMPERATURE = 0.2;
const MAX_CHUNK_MESSAGES = 40;
const MAX_CHUNK_CHARS = 6000;
const ASSISTANT_PROMPT_LIMIT = 200;
const ASSISTANT_ROLES = new Set(["assistant", "finch"]);
const MODES_WITHOUT_ASSISTANT = new Set(["plan", "search", "research"]);
const GENERATE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const MAX_TURN_RESULT_TURNS = 40;
const MAX_CHUNK_TURNS = 8;
const FORMAT_REQUEST_MAX = 160;

const SYSTEM_PROMPT = `You build a personal memory for an AI companion called Finch, from chat logs between the user and Finch.
Record only what is worth remembering about the USER: their interests, questions they explored, plans, preferences, decisions, and things they said about themselves.
Do NOT summarize Finch's general-knowledge explanations. If the user asked about a topic, write that the user asked about it, plus the key point in one sentence at most.
Do NOT create entries for simple greetings, mode-switch requests, or empty exchanges. If a chunk contains no lasting user facts, preferences, or technical topics, output NONE.
Ignore filler, error messages, and text that looks like a speech-recognition mistake.
Write at most 5 entries. Merge repeated requests about the same thing into one entry. Keep different topics separate.
Only use what is in the messages. Do not invent facts, names or dates.
Every entry must describe what the USER asked, said or wanted. Start every SUMMARY with 'The user'. Never describe what Finch explained.
If nothing is worth remembering, output exactly: NONE
For each entry output exactly:
### ENTRY
TITLE: <short title>
SUMMARY: <1-3 sentences>`;

const STRUCTURED_SYSTEM_PROMPT = `You build a personal memory for an AI companion called Finch, from search and research activity logs.
Each input block describes one search or research turn: the request, the direction chosen, the directions that were offered, the top sources (title and domain) and the top card headlines.
Record what is worth remembering about the USER: what they searched or researched, what they were trying to find out, their interests, questions they explored, decisions, and preferences they expressed.
Use only the titles, domains and headlines given. Do not invent facts, names, dates, URLs or links. Never output image links.
Do NOT describe what Finch did or said.
Every entry must describe what the USER searched for or wanted to know. Start every SUMMARY with 'The user'.
Do NOT create entries for trivial lookups, greetings, or repeated searches about the same thing. If a chunk contains nothing worth remembering, output NONE.
Write at most 5 entries. Keep different topics separate.
For each entry output exactly:
### ENTRY
TITLE: <short title>
SUMMARY: <1-3 sentences>`;

interface ChunkMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

interface Chunk {
  mode: string;
  date: string;
  messages: ChunkMessage[];
}

export interface MemoryEntryDraft {
  mode: string;
  title: string;
  summary_text: string;
  date_start: string;
  date_end: string;
  source_message_ids: number[];
}

export interface FailedChunk {
  mode: string;
  date: string;
  messageIds: number[];
  error: string;
}

export interface SummarizeBatchResult {
  entries: MemoryEntryDraft[];
  skippedIds: number[];
  failedChunks: FailedChunk[];
}

type SelectResult = ReturnType<typeof selectMessages>;

function splitByLimits(
  messages: ChunkMessage[],
  mode: string,
): ChunkMessage[][] {
  // plan/search/research: no message-count cap, size measured only on the
  // text actually sent to the model (user messages), so one mode+day stays
  // one chunk unless the sent text exceeds MAX_CHUNK_CHARS.
  const userTextOnly = MODES_WITHOUT_ASSISTANT.has(mode);
  const parts: ChunkMessage[][] = [];
  let current: ChunkMessage[] = [];
  let currentChars = 0;

  for (const msg of messages) {
    const counted = !userTextOnly || !isAssistantRole(msg.role);
    const msgChars = counted ? msg.content.length : 0;
    const fits =
      (userTextOnly || current.length < MAX_CHUNK_MESSAGES) &&
      currentChars + msgChars <= MAX_CHUNK_CHARS;
    if (current.length > 0 && !fits) {
      parts.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(msg);
    currentChars += msgChars;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function buildChunks(grouped: SelectResult): Chunk[] {
  const byModeDay = new Map<string, ChunkMessage[]>();

  for (const modeGroup of grouped) {
    for (const conv of modeGroup.conversations) {
      for (const msg of conv.messages) {
        const date = msg.created_at.slice(0, 10);
        const key = `${modeGroup.mode}|${date}`;
        const list = byModeDay.get(key);
        if (list) {
          list.push(msg);
        } else {
          byModeDay.set(key, [msg]);
        }
      }
    }
  }

  const chunks: Chunk[] = [];
  for (const [key, messages] of byModeDay) {
    const sep = key.indexOf("|");
    const mode = key.slice(0, sep);
    const date = key.slice(sep + 1);
    for (const part of splitByLimits(messages, mode)) {
      chunks.push({ mode, date, messages: part });
    }
  }
  return chunks;
}

function isAssistantRole(role: string): boolean {
  return ASSISTANT_ROLES.has(role.toLowerCase());
}

function truncateForPrompt(msg: ChunkMessage): string {
  if (!isAssistantRole(msg.role)) {
    return msg.content;
  }
  if (msg.content.length <= ASSISTANT_PROMPT_LIMIT) {
    return msg.content;
  }
  return `${msg.content.slice(0, ASSISTANT_PROMPT_LIMIT)}...`;
}

const USER_ONLY_NOTE =
  "Only the user's messages are shown. Do not mention Finch or what Finch did.";

function buildPrompt(messages: ChunkMessage[], mode: string): string {
  const includeAssistant = !MODES_WITHOUT_ASSISTANT.has(mode);
  const lines = messages
    .filter((m) => includeAssistant || !isAssistantRole(m.role))
    .map((m) => `[${m.created_at}] ${m.role}: ${truncateForPrompt(m)}`)
    .join("\n");
  if (includeAssistant) {
    return lines;
  }
  return `${USER_ONLY_NOTE}\n${lines}`;
}

function elapsedSeconds(startedAt: number): number {
  return Number(((Date.now() - startedAt) / 1000).toFixed(2));
}

const NON_SUBSTANTIVE_LABELS = new Set([
  "none",
  "n a",
  "nothing",
  "no entries",
  "no entry",
  "no meaningful content",
  "no substantive content",
  "greeting",
  "greetings",
  "repeated greeting",
  "repeated greetings",
  "greeting and introduction",
  "greetings and introduction",
  "greeting and mode switches",
  "greetings and mode switches",
  "mode switch",
  "mode switches",
  "mode switching",
  "mode switch request",
  "mode switch requests",
  "plan mode request",
  "plan mode switch",
  "research mode request",
  "search mode request",
  "empty exchange",
  "empty exchanges",
  "small talk",
  "chit chat",
  "filler",
]);

const FLUFF_WORDS = new Set([
  "a",
  "an",
  "and",
  "or",
  "the",
  "of",
  "to",
  "in",
  "for",
  "with",
  "about",
  "no",
  "none",
  "nothing",
  "greeting",
  "greetings",
  "hello",
  "hi",
  "hey",
  "mode",
  "modes",
  "switch",
  "switches",
  "switching",
  "request",
  "requests",
  "repeated",
  "repeat",
  "small",
  "talk",
  "chit",
  "empty",
  "exchange",
  "exchanges",
  "filler",
  "misc",
  "miscellaneous",
  "content",
  "substantive",
  "meaningful",
  "introduction",
  "introductions",
]);

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFluffOnly(value: string): boolean {
  const words = normalizeLabel(value)
    .split(" ")
    .filter((w) => w.length > 0);
  if (words.length === 0) {
    return true;
  }
  return words.every((w) => FLUFF_WORDS.has(w));
}

function isNonSubstantiveLabel(value: string): boolean {
  const label = normalizeLabel(value);
  if (label.length === 0) {
    return true;
  }
  if (NON_SUBSTANTIVE_LABELS.has(label)) {
    return true;
  }
  if (isFluffOnly(label)) {
    return true;
  }
  // titles such as "Plan Mode Switch" / "Research Mode Request"
  if (
    /(^|\s)(mode switches?|switching modes?|mode requests?|mode changes?)$/.test(
      label,
    )
  ) {
    return true;
  }
  return false;
}

function isSubstantiveEntry(entry: {
  title: string;
  summary: string;
}): boolean {
  if (isNonSubstantiveLabel(entry.title)) {
    return false;
  }
  if (isNonSubstantiveLabel(entry.summary)) {
    return false;
  }
  return true;
}

// Safety net for plan/search/research: entries that talk about Finch or
// about modes are dropped the same way non-substantive entries are.
function passesSafetyNet(entry: { title: string; summary: string }): boolean {
  return (
    !/\bfinch\b/i.test(entry.title) &&
    !/\bfinch\b/i.test(entry.summary) &&
    !/\bmodes?\b/i.test(entry.title) &&
    !/\bmodes?\b/i.test(entry.summary)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type ChunkOutcome =
  | { status: "entries"; entries: Array<{ title: string; summary: string }> }
  | { status: "none" }
  | { status: "unparseable"; raw: string }
  | { status: "error"; error: string };

// The ollama adapter has a fixed per-call timeout with no override option,
// so transient failures are handled here with bounded retries.
async function generateChunk(
  prompt: string,
  systemPrompt: string,
  modelAlias: string,
): Promise<ChunkOutcome> {
  let lastError = "";
  let lastRaw = "";
  const alias = getAlias(modelAlias);

  for (let attempt = 1; attempt <= GENERATE_ATTEMPTS; attempt++) {
    try {
      const result = await ollamaAdapter.generate(
        modelAlias,
        alias.ollamaModel,
        prompt,
        {
          systemPrompt,
          temperature: TEMPERATURE,
          maxTokens: NUM_PREDICT,
        },
      );
      const raw = result.text.trim();
      if (/^NONE\b/i.test(raw)) {
        return { status: "none" };
      }
      const parsed = parseEntries(raw);
      if (parsed.length > 0) {
        return { status: "entries", entries: parsed };
      }
      lastRaw = raw;
      logger.warn("summarize chunk unparseable", {
        attempt,
        maxAttempts: GENERATE_ATTEMPTS,
        willRetry: attempt < GENERATE_ATTEMPTS,
        raw: raw.slice(0, 300),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("summarize chunk attempt failed", {
        attempt,
        maxAttempts: GENERATE_ATTEMPTS,
        willRetry: attempt < GENERATE_ATTEMPTS,
        error: lastError,
      });
    }

    if (attempt < GENERATE_ATTEMPTS) {
      await delay(RETRY_DELAY_MS * attempt);
    }
  }

  if (lastRaw.length > 0) {
    return { status: "unparseable", raw: lastRaw };
  }
  return { status: "error", error: lastError || "unknown error" };
}

function parseEntries(text: string): Array<{ title: string; summary: string }> {
  const entries: Array<{ title: string; summary: string }> = [];
  const blocks = text.split(/###\s*ENTRY/).slice(1);

  for (const block of blocks) {
    const titleMatch = block.match(/TITLE:\s*(.+)/);
    const summaryMatch = block.match(/SUMMARY:\s*([\s\S]+)/);
    if (!titleMatch || !summaryMatch) {
      continue;
    }
    entries.push({
      title: titleMatch[1].trim(),
      summary: summaryMatch[1].trim(),
    });
  }
  return entries;
}

export async function summarizeBatch(
  days: 7 | 30,
  modelAlias: string,
): Promise<SummarizeBatchResult> {
  const grouped = selectMessages(days);
  const chunks = buildChunks(grouped);

  const entries: MemoryEntryDraft[] = [];
  const skippedIds: number[] = [];
  const failedChunks: FailedChunk[] = [];

  for (const chunk of chunks) {
    const messageIds = chunk.messages.map((m) => m.id);
    const prompt = buildPrompt(chunk.messages, chunk.mode);
    const startedAt = Date.now();
    const logBase = {
      mode: chunk.mode,
      date: chunk.date,
      messageCount: chunk.messages.length,
      promptChars: prompt.length,
    };

    const outcome = await generateChunk(prompt, SYSTEM_PROMPT, modelAlias);
    const seconds = elapsedSeconds(startedAt);

    if (outcome.status === "error") {
      logger.error("summarize chunk", {
        ...logBase,
        seconds,
        outcome: "failed",
        error: outcome.error,
      });
      failedChunks.push({
        mode: chunk.mode,
        date: chunk.date,
        messageIds,
        error: outcome.error,
      });
      continue;
    }

    if (outcome.status === "none") {
      logger.info("summarize chunk", { ...logBase, seconds, outcome: "NONE" });
      skippedIds.push(...messageIds);
      continue;
    }

    if (outcome.status === "unparseable") {
      logger.error("summarize chunk", {
        ...logBase,
        seconds,
        outcome: "failed",
        error: "unparseable model output",
        raw: outcome.raw.slice(0, 300),
      });
      failedChunks.push({
        mode: chunk.mode,
        date: chunk.date,
        messageIds,
        error: "unparseable model output",
      });
      continue;
    }

    const applySafetyNet = MODES_WITHOUT_ASSISTANT.has(chunk.mode);
    const keptEntries = outcome.entries.filter(
      (entry) =>
        isSubstantiveEntry(entry) &&
        (!applySafetyNet || passesSafetyNet(entry)),
    );
    const droppedCount = outcome.entries.length - keptEntries.length;

    if (keptEntries.length === 0) {
      logger.info("summarize chunk", {
        ...logBase,
        seconds,
        outcome: "NONE",
        droppedCount,
      });
      skippedIds.push(...messageIds);
      continue;
    }

    logger.info("summarize chunk", {
      ...logBase,
      seconds,
      outcome: "entries",
      entryCount: keptEntries.length,
      droppedCount,
    });

    // Chunk-level grouping of source_message_ids is intentional: the model
    // returns entries without per-entry message ids, so every entry produced
    // from a chunk references exactly the ids of the messages processed for
    // that chunk (chunks never share messages, and ids are never invented).
    for (const parsedEntry of keptEntries) {
      entries.push({
        mode: chunk.mode,
        title: parsedEntry.title,
        summary_text: parsedEntry.summary,
        date_start: chunk.date,
        date_end: chunk.date,
        source_message_ids: messageIds,
      });
    }
  }

  return { entries, skippedIds, failedChunks };
}

function formatTurnBlock(turn: CompactTurn): string {
  const when = turn.createdAt.slice(0, 16).replace("T", " ");
  const label = turn.mode === "research" ? "RESEARCH" : "SEARCH";
  const request =
    turn.request.length > FORMAT_REQUEST_MAX
      ? `${turn.request.slice(0, FORMAT_REQUEST_MAX)}...`
      : turn.request;
  const lines = [`${when} ${label} "${request}"`];
  if (turn.direction !== null) {
    lines.push(`direction: ${turn.direction}`);
  }
  if (turn.directionsOnly && turn.directionCards.length > 0) {
    lines.push(`offered directions: ${turn.directionCards.join(" | ")}`);
  }
  if (turn.topSources.length > 0) {
    const sources = turn.topSources.map((s) => `${s.title} (${s.domain})`);
    lines.push(`sources: ${sources.join(" | ")}`);
  }
  if (turn.topCards.length > 0) {
    lines.push(`cards: ${turn.topCards.join(" | ")}`);
  }
  return lines.join("\n");
}

type TurnChunk = { mode: string; date: string; blocks: string[] };

function buildTurnChunks(turns: CompactTurn[]): TurnChunk[] {
  const groups = new Map<string, TurnChunk>();
  for (const turn of turns) {
    const date = turn.createdAt.slice(0, 10);
    const key = `${turn.mode}|${date}`;
    const existing = groups.get(key);
    const block = formatTurnBlock(turn);
    if (existing) {
      existing.blocks.push(block);
    } else {
      groups.set(key, { mode: turn.mode, date, blocks: [block] });
    }
  }

  const chunks: TurnChunk[] = [];
  for (const group of groups.values()) {
    let current: string[] = [];
    let currentChars = 0;
    for (const block of group.blocks) {
      const fits =
        current.length < MAX_CHUNK_TURNS &&
        currentChars + block.length + 1 <= MAX_CHUNK_CHARS;
      if (current.length > 0 && !fits) {
        chunks.push({ mode: group.mode, date: group.date, blocks: current });
        current = [];
        currentChars = 0;
      }
      current.push(block);
      currentChars += block.length + 1;
    }
    if (current.length > 0) {
      chunks.push({ mode: group.mode, date: group.date, blocks: current });
    }
  }
  return chunks;
}

// Second, independent pass: summarizes structured Search/Research activity
// from turn_results. Entries carry no source_message_ids, so they never
// affect deletion counts or the messages-based selection. Any failure here
// returns an empty result instead of breaking the messages pass.
export async function summarizeTurnResults(
  days: 7 | 30,
  modelAlias: string,
): Promise<SummarizeBatchResult> {
  const entries: MemoryEntryDraft[] = [];
  const failedChunks: FailedChunk[] = [];

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const fromIso = cutoff.toISOString().split("T")[0];
    const toIso = new Date().toISOString();
    const rows = listTurnResultsInRange(fromIso, toIso);
    const compact = rows
      .slice(-MAX_TURN_RESULT_TURNS)
      .map(projectTurnForSummary);
    const chunks = buildTurnChunks(compact);

    for (const chunk of chunks) {
      const messageIds: number[] = [];
      const prompt = chunk.blocks.join("\n");
      const startedAt = Date.now();
      const logBase = {
        mode: chunk.mode,
        date: chunk.date,
        turnCount: chunk.blocks.length,
        promptChars: prompt.length,
      };

      const outcome = await generateChunk(
        prompt,
        STRUCTURED_SYSTEM_PROMPT,
        modelAlias,
      );
      const seconds = elapsedSeconds(startedAt);

      if (outcome.status === "error") {
        logger.error("summarize turn results chunk", {
          ...logBase,
          seconds,
          outcome: "failed",
          error: outcome.error,
        });
        failedChunks.push({
          mode: chunk.mode,
          date: chunk.date,
          messageIds,
          error: outcome.error,
        });
        continue;
      }

      if (outcome.status === "unparseable") {
        logger.error("summarize turn results chunk", {
          ...logBase,
          seconds,
          outcome: "failed",
          error: "unparseable model output",
          raw: outcome.raw.slice(0, 300),
        });
        failedChunks.push({
          mode: chunk.mode,
          date: chunk.date,
          messageIds,
          error: "unparseable model output",
        });
        continue;
      }

      if (outcome.status === "none") {
        logger.info("summarize turn results chunk", {
          ...logBase,
          seconds,
          outcome: "NONE",
        });
        continue;
      }

      const keptEntries = outcome.entries.filter(isSubstantiveEntry);
      const droppedCount = outcome.entries.length - keptEntries.length;

      if (keptEntries.length === 0) {
        logger.info("summarize turn results chunk", {
          ...logBase,
          seconds,
          outcome: "NONE",
          droppedCount,
        });
        continue;
      }

      logger.info("summarize turn results chunk", {
        ...logBase,
        seconds,
        outcome: "entries",
        entryCount: keptEntries.length,
        droppedCount,
      });

      for (const parsedEntry of keptEntries) {
        entries.push({
          mode: chunk.mode,
          title: parsedEntry.title,
          summary_text: parsedEntry.summary,
          date_start: chunk.date,
          date_end: chunk.date,
          source_message_ids: [],
        });
      }
    }
  } catch (err) {
    logger.error("summarize turn results pass failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { entries, skippedIds: [], failedChunks };
}
