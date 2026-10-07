const BASE_URL = "http://localhost:3001";

// Shared per-voice-turn id; the backend tags its timing logs with it so all
// stages of one voice turn (transcribe -> turn -> speak) can be matched.
const VOICE_TURN_HEADER = "x-voice-turn-id";

// Intent generation was removed: every turn is an "answer" (mode switching
// happens via the mode indicator / keyboard, never by voice command).
export type TurnAction = "answer";
export type Mode = "conversation" | "plan" | "search" | "research";

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  trust: "high" | "medium" | "low";
  image?: string;
};
export type SearchSourceKind = "local" | "online";
export type TopicCard = { headline: string; summary: string; category?: string };

export type TurnRequest = {
  transcript: string;
  currentMode: Mode;
  modelOverride?: string | undefined;
  researchPath?: string[] | undefined;
  researchCategory?: string | undefined;
};

export type TurnResponse = {
  action: TurnAction;
  mode: Mode;
  request: string;
  reply: string;
  source: "qwen" | "fallback";
  conversationId: number;
  webSources?: WebSource[];
  searchSource?: SearchSourceKind;
  topicCards?: TopicCard[];
  directions?: TopicCard[];
};

export async function postTurn(
  transcript: string,
  currentMode: Mode,
  modelOverride?: string,
  researchPath?: string[],
  researchCategory?: string,
  voiceTurnId?: string,
): Promise<TurnResponse> {
  const body: TurnRequest = { transcript, currentMode, modelOverride, researchPath };
  if (researchCategory !== undefined) {
    body.researchCategory = researchCategory;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (voiceTurnId) {
    headers[VOICE_TURN_HEADER] = voiceTurnId;
  }
  const res = await fetch(`${BASE_URL}/api/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Turn request failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<TurnResponse>;
}

export type TurnStreamOptions = {
  signal?: AbortSignal | undefined;
  // `pipeline` is "sequential" when the backend runs VOICE_PIPELINE_MODE=
  // sequential (reply arrives as ONE delta; hold speech until onEnd/done and
  // send a single full-text TTS request). Undefined in streaming mode.
  onDelta?: ((delta: string, pipeline?: string) => void) | undefined;
  // Fired when the reply TEXT is complete (backend "end" event). Safe point
  // to flush a speech buffer.
  onEnd?: ((pipeline?: string) => void) | undefined;
};

// Streaming turn (POST /api/turn/stream): an NDJSON stream of events —
//   {"type":"delta","text":...} reply fragments, in order
//   {"type":"end"}              reply text complete
//   {"type":"done", ...}        the full TurnResponse payload (same shape as POST /)
//   {"type":"error","message":...}
// onDelta fires as fragments arrive; the returned promise resolves with the
// final TurnResponse when the "done" event lands.
export async function postTurnStream(
  transcript: string,
  currentMode: Mode,
  modelOverride?: string,
  voiceTurnId?: string,
  options: TurnStreamOptions = {},
): Promise<TurnResponse> {
  const body: TurnRequest = { transcript, currentMode, modelOverride };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (voiceTurnId) {
    headers[VOICE_TURN_HEADER] = voiceTurnId;
  }

  const res = await fetch(`${BASE_URL}/api/turn/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal ?? null,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Turn request failed (${res.status}): ${text}`);
  }
  if (!res.body) {
    throw new Error("Turn stream failed: response has no body");
  }

  // Holder object so the value assigned from inside the line handler is seen
  // with its full type after the read loop.
  const out: { result: TurnResponse | null } = { result: null };

  const handleLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (line.length === 0) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return; // tolerate a torn line; subsequent lines still parse
    }
    if (event === null || typeof event !== "object") return;
    const e = event as {
      type?: unknown;
      text?: unknown;
      message?: unknown;
      error?: unknown;
      pipeline?: unknown;
    };
    const pipeline = typeof e.pipeline === "string" ? e.pipeline : undefined;
    if (e.type === "delta" && typeof e.text === "string") {
      options.onDelta?.(e.text, pipeline);
      return;
    }
    if (e.type === "end") {
      options.onEnd?.(pipeline);
      return;
    }
    if (e.type === "done") {
      out.result = event as TurnResponse;
      return;
    }
    if (e.type === "error") {
      throw new Error(
        typeof e.message === "string" && e.message.length > 0 ? e.message : "Turn stream failed",
      );
    }
    // Plain JSON error produced before streaming started (validation, etc.).
    if (typeof e.message === "string") throw new Error(e.message);
    if (typeof e.error === "string") throw new Error(e.error);
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let index = buffered.indexOf("\n");
    while (index !== -1) {
      handleLine(buffered.slice(0, index));
      buffered = buffered.slice(index + 1);
      index = buffered.indexOf("\n");
    }
  }
  handleLine(buffered);

  if (out.result === null) {
    throw new Error("Turn stream ended without a done event");
  }
  return out.result;
}

export async function postVoiceTranscribe(
  wav: Blob,
  voiceTurnId: string,
): Promise<{ text: string }> {
  const res = await fetch(`${BASE_URL}/api/voice/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", [VOICE_TURN_HEADER]: voiceTurnId },
    body: wav,
  });
  if (!res.ok) throw new Error(await readApiError(res, `Transcription failed (${res.status})`));
  return res.json() as Promise<{ text: string }>;
}

export type VoiceEngine = "kokoro" | "kitten" | "piper";

export async function postVoiceSpeak(
  text: string,
  voiceTurnId: string,
  engine?: VoiceEngine,
): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [VOICE_TURN_HEADER]: voiceTurnId },
    // Omit `engine` when the conversation has no explicit pick so the backend
    // keeps using its configured default (pre-picker behaviour).
    body: JSON.stringify(engine ? { text, engine } : { text }),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Speech synthesis failed (${res.status})`));
  return res.blob();
}

// Only the fields the engine picker needs from /api/voice/health.
export type VoiceHealthBrief = { ttsEngine: VoiceEngine };

export async function getVoiceHealth(): Promise<VoiceHealthBrief> {
  const res = await fetch(`${BASE_URL}/api/voice/health`);
  if (!res.ok) throw new Error(await readApiError(res, `Voice health failed (${res.status})`));
  const json = (await res.json()) as { ttsEngine?: unknown };
  const raw = json.ttsEngine;
  return { ttsEngine: raw === "piper" || raw === "kitten" ? raw : "kokoro" };
}

export type ControlModel = {
  alias: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
};

// GET /api/control/models does not include paramSize (the modes route derives
// it from the ollama tag), so derive a display size from the alias instead:
// "finch-1.5" -> "1.5". ModelPicker only uses it for its label.
function paramSizeFromAlias(alias: string): string {
  return alias.startsWith("finch-") ? alias.slice("finch-".length) : alias;
}

export async function getControlModels(): Promise<ModeModelOption[]> {
  const res = await fetch(`${BASE_URL}/api/control/models`);
  if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
  const rows = (await res.json()) as ControlModel[];
  return rows
    .filter((row) => row.enabled)
    .map((row, index) => ({
      id: index,
      alias: row.alias,
      displayName: row.displayName,
      paramSize: paramSizeFromAlias(row.alias),
      enabled: row.enabled,
    }));
}

export type ModeModelOption = {
  id: number;
  alias: string;
  displayName: string;
  paramSize: string;
  enabled: boolean;
};

export type ModeModelConfig = {
  mode: Mode;
  defaultAlias: string;
  allowedAliases: string[];
  allowedModels: ModeModelOption[];
};

export async function getControlModes(): Promise<ModeModelConfig[]> {
  const res = await fetch(`${BASE_URL}/api/control/modes`);
  if (!res.ok) throw new Error(`Failed to load modes (${res.status})`);
  return res.json() as Promise<ModeModelConfig[]>;
}

/**
 * Writes the full allowed-model set for one mode (a set, not a single model).
 * The response is the mode's refreshed config, so callers can read the new
 * allowed list without a second round trip.
 */
export async function setModeAllowedModels(
  mode: Mode,
  aliases: string[],
): Promise<ModeModelConfig> {
  const res = await fetch(`${BASE_URL}/api/control/modes/${encodeURIComponent(mode)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowedAliases: aliases }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Could not update ${mode} models (${res.status})`));
  }
  return res.json() as Promise<ModeModelConfig>;
}

// One entry of the dynamic model library: a model Ollama really has installed,
// plus whether the user lets it be picked in the mode selectors.
export type LibraryModel = {
  alias: string;
  ollamaModel: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
};

export type ModelLibrary = {
  // false when Ollama did not answer — the list is then empty, not stale.
  ollamaReachable: boolean;
  models: LibraryModel[];
};

export async function getModelLibrary(): Promise<ModelLibrary> {
  const res = await fetch(`${BASE_URL}/api/control/library`);
  if (!res.ok) throw new Error(await readApiError(res, `Model library failed (${res.status})`));
  return res.json() as Promise<ModelLibrary>;
}

// Tick/untick. Unticking never deletes the model — it only hides it from the
// mode pickers until it is ticked again.
export async function setLibraryModelEnabled(
  alias: string,
  enabled: boolean,
): Promise<LibraryModel> {
  const res = await fetch(`${BASE_URL}/api/control/library`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, enabled }),
  });
  if (!res.ok) throw new Error(await readApiError(res, `Could not update model (${res.status})`));
  return res.json() as Promise<LibraryModel>;
}

export type ControlPrompt = {
  mode: Mode;
  systemPrompt: string;
  updatedAt: string | null;
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed: { message?: string; error?: string } = JSON.parse(text);
    return (parsed.message ?? parsed.error ?? text) || fallback;
  } catch {
    return text || fallback;
  }
}

export async function getControlPrompts(): Promise<ControlPrompt[]> {
  const res = await fetch(`${BASE_URL}/api/control/prompts`);
  if (!res.ok) throw new Error(`Failed to load prompts (${res.status})`);
  return res.json() as Promise<ControlPrompt[]>;
}

export async function putControlPrompt(mode: Mode, systemPrompt: string): Promise<ControlPrompt> {
  const res = await fetch(`${BASE_URL}/api/control/prompts/${mode}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to save prompt (${res.status})`));
  }
  return res.json() as Promise<ControlPrompt>;
}

export async function resetControlPrompt(mode: Mode): Promise<ControlPrompt> {
  const res = await fetch(`${BASE_URL}/api/control/prompts/${mode}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to reset prompt (${res.status})`));
  }
  return res.json() as Promise<ControlPrompt>;
}

export type ResearchResourceSite = { id: number; url: string };
export type ResearchResourceCategory = { id: number; name: string; sites: ResearchResourceSite[] };

export async function getResearchResources(): Promise<{ categories: ResearchResourceCategory[] }> {
  const res = await fetch(`${BASE_URL}/api/control/research-resources`);
  if (!res.ok)
    throw new Error(await readApiError(res, `Failed to load research resources (${res.status})`));
  return res.json() as Promise<{ categories: ResearchResourceCategory[] }>;
}

export async function createResearchResourceCategory(
  name: string,
): Promise<ResearchResourceCategory> {
  const res = await fetch(`${BASE_URL}/api/control/research-resources/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to create category (${res.status})`));
  }
  return res.json() as Promise<ResearchResourceCategory>;
}

export async function deleteResearchResourceCategory(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/control/research-resources/categories/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to delete category (${res.status})`));
  }
}

export async function addResearchResourceSite(
  categoryId: number,
  url: string,
): Promise<ResearchResourceSite> {
  const res = await fetch(
    `${BASE_URL}/api/control/research-resources/categories/${categoryId}/sites`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
  );
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to add site (${res.status})`));
  }
  return res.json() as Promise<ResearchResourceSite>;
}

export async function deleteResearchResourceSite(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/control/research-resources/sites/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to delete site (${res.status})`));
  }
}

export type TrustEntryKind = "high" | "suffix" | "low";
export type TrustEntry = { id: number; value: string };
export type TrustEntriesResponse = {
  high: TrustEntry[];
  suffix: TrustEntry[];
  low: TrustEntry[];
};

export async function getTrustEntries(): Promise<TrustEntriesResponse> {
  const res = await fetch(`${BASE_URL}/api/control/trust-entries`);
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to load trust list (${res.status})`));
  }
  return res.json() as Promise<TrustEntriesResponse>;
}

export async function addTrustEntry(
  kind: TrustEntryKind,
  value: string,
): Promise<{ id: number; kind: TrustEntryKind; value: string }> {
  const res = await fetch(`${BASE_URL}/api/control/trust-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to add entry (${res.status})`));
  }
  return res.json() as Promise<{ id: number; kind: TrustEntryKind; value: string }>;
}

export async function deleteTrustEntry(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/control/trust-entries/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to delete entry (${res.status})`));
  }
}

export type RecentTurn = {
  conversationId: number;
  request: string;
  reply: string;
  payload: {
    webSources?: WebSource[];
    topicCards?: TopicCard[];
    directions?: TopicCard[];
    searchSource?: SearchSourceKind | null;
    researchPath?: string[];
  };
  createdAt: string;
};

export async function getRecentTurn(
  mode: "search" | "research",
  hours = 24,
): Promise<RecentTurn | null> {
  const res = await fetch(`${BASE_URL}/api/control/turns/recent?mode=${mode}&hours=${hours}`);
  if (!res.ok) {
    // Loading prior content is a best-effort convenience. Do NOT throw.
    return null;
  }
  const body = (await res.json()) as { turn: RecentTurn | null };
  return body.turn;
}

export type PlanMessage = {
  id: number;
  mode: string;
  role: "user" | "finch";
  content: string;
  created_at: string;
};

export async function getPlanMessages(hours = 24, limit = 50): Promise<PlanMessage[]> {
  const res = await fetch(
    `${BASE_URL}/api/control/memory/messages?mode=plan&hours=${hours}&limit=${limit}`,
  );
  if (!res.ok) {
    // Same rationale: never throw for a reload attempt.
    return [];
  }
  const body = (await res.json()) as PlanMessage[] | { messages?: PlanMessage[] };
  return Array.isArray(body) ? body : (body.messages ?? []);
}

export type MemorySummarizeEntry = {
  title: string;
  modes: string | string[];
  date_start: string;
  date_end: string;
  summary_text: string;
  source_message_ids: string;
};

export type MemorySummarizePreview = {
  id: number;
  days_range: number;
  period_start: string;
  period_end: string;
  source_msg_count: number;
  entries: MemorySummarizeEntry[];
};

export type MemorySummarizeStatus = {
  jobId: string;
  status: string;
  startedAt?: string;
  batchId: number | null;
  error: string | null;
  preview?: MemorySummarizePreview | null;
  skippedIds?: number;
  failedChunks?: number;
};

export async function postMemorySummarize(days: 7 | 30, model: string): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE_URL}/api/control/memory/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days, model }),
  });
  if (res.status === 409) {
    throw new Error("A summarize job is already running.");
  }
  if (!res.ok) throw new Error(`Failed to start summarize (${res.status})`);
  return res.json() as Promise<{ jobId: string }>;
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export async function getMemorySummarizeStatus(jobId: string): Promise<MemorySummarizeStatus> {
  const res = await fetch(`${BASE_URL}/api/control/memory/summarize/status/${jobId}`);
  if (!res.ok)
    throw new ApiRequestError(`Failed to load summarize status (${res.status})`, res.status);
  return res.json() as Promise<MemorySummarizeStatus>;
}

export type ConfirmMemoryBatchResult = {
  deletedTotal: number;
  deletedByMode: Record<string, number>;
};

export type DiscardMemoryBatchResult = {
  discarded: boolean;
  batchId: number;
};

export type SavedMemoryEntry = {
  id: number;
  batch_id: number;
  title: string;
  modes: string;
  date_start: string;
  date_end: string;
  summary_text: string;
  confirmed_at: string | null;
};

export async function confirmMemoryBatch(batchId: number): Promise<ConfirmMemoryBatchResult> {
  const res = await fetch(`${BASE_URL}/api/control/memory/summarize/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId }),
  });
  if (res.status === 404) throw new ApiRequestError("Batch not found", 404);
  if (res.status === 409) throw new ApiRequestError("This batch was already handled", 409);
  if (!res.ok) throw new Error(`Failed to confirm batch (${res.status})`);
  return res.json() as Promise<ConfirmMemoryBatchResult>;
}

export async function discardMemoryBatch(batchId: number): Promise<DiscardMemoryBatchResult> {
  const res = await fetch(`${BASE_URL}/api/control/memory/summarize/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId }),
  });
  if (res.status === 404) throw new ApiRequestError("Batch not found", 404);
  if (res.status === 409) throw new ApiRequestError("This batch was already handled", 409);
  if (!res.ok) throw new Error(`Failed to discard batch (${res.status})`);
  return res.json() as Promise<DiscardMemoryBatchResult>;
}

export async function getMemoryBox(): Promise<SavedMemoryEntry[]> {
  const res = await fetch(`${BASE_URL}/api/control/memory/box`);
  if (!res.ok) throw new Error(`Failed to load memory box (${res.status})`);
  return res.json() as Promise<SavedMemoryEntry[]>;
}

export type ModeMessage = {
  id: number;
  mode: string;
  role: string;
  content: string;
  created_at: string;
};

export async function getModeMessages(mode: Mode, limit = 200): Promise<ModeMessage[]> {
  const params = new URLSearchParams({ mode, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/api/control/memory/messages?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = "";
    try {
      const parsed: { message?: string; error?: string } = JSON.parse(text);
      detail = parsed.message ?? parsed.error ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || text || `Failed to load messages (${res.status})`);
  }
  return res.json() as Promise<ModeMessage[]>;
}

export async function deleteModeMessage(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/control/memory/messages/${id}`, {
    method: "DELETE",
  });
  if (res.status === 404) throw new ApiRequestError("Message not found", 404);
  if (!res.ok) throw new Error(await readApiError(res, `Failed to delete message (${res.status})`));
}
