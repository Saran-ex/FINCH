// Finch CPU / latency contention diagnostic benchmark.
//
// Read-only with respect to production: creates no production files, changes
// no production config, starts no servers. All output goes to scripts/benchmark/out/.
// The only Finch code it executes is the existing production functions
// (transcribeWav, synthesizeKokoro, promptBuilder) via dynamic import.
//
// Usage:
//   npx tsx scripts/benchmark/bench.ts        run everything (baseline, A-F, S)
//   npx tsx scripts/benchmark/bench.ts CSF    run a subset, IN THE GIVEN ORDER
//                                             (resource windows only cover the
//                                             tests you run)
// Tests: 0=baseline A=whisper B=qwen C=kokoro D=whisper+qwen E=qwen+kokoro
//        F=streaming voice pipeline, Kokoro TTS (sentence chunks, TTS overlaps LLM)
//        P=streaming voice pipeline, Piper TTS (identical flow, engine swapped)
//        S=sequential voice pipeline (single full-reply TTS after intent)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "E:/Finch/finch-backend";
const OUT = path.join(ROOT, "scripts/benchmark", "out");
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const QWEN_MODEL = "qwen2.5:1.5b"; // conversation default alias finch-1.5 (DB model_aliases)
// Subset selector: "all" runs every test in default order; any letters run in
// the exact order given (e.g. "CSF", "CFS") so A/B pairs can be interleaved.
const WANTED = (process.argv[2] || "all").toUpperCase();

fs.mkdirSync(OUT, { recursive: true });

// Isolate DB/config-sensitive imports from the production database before any
// Finch module loads. bench.db is created fresh under out/.
process.env.DB_PATH = path.join(OUT, "bench.db");
process.env.TTS_ENGINE = process.env.TTS_ENGINE || "kokoro";

const voice = await import(pathToFileURL(path.join(ROOT, "src/services/voice.ts")).href);
const { synthesizeKokoro } = await import(
  pathToFileURL(path.join(ROOT, "src/services/tts-kokoro.ts")).href
);
const pb = await import(pathToFileURL(path.join(ROOT, "src/ai/promptBuilder.ts")).href);
const { runMigrations } = await import(pathToFileURL(path.join(ROOT, "src/db/migrate.ts")).href);
runMigrations();

const r2 = (n: number): number => Math.round(n * 100) / 100;
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Representative prompts (mirror production turnService phase 1 / phase 2)
// ---------------------------------------------------------------------------
const TRANSCRIPT = "Can you explain how photosynthesis works and why plants need it, covering the light reactions and the Calvin cycle in simple terms?";
const SYNTHETIC_MEMORY = `--- MEMORY CONTEXT ---
Known facts about the user:
- Prefers concise, friendly answers with concrete examples
- Interested in ocean, space and science topics
- Uses Finch mainly in conversation mode with voice

Recent conversation:
User: Tell me something interesting about the ocean.
Finch: The ocean covers most of our planet, and coral reefs alone shelter a quarter of all marine species.
User: Why do whales matter to that ecosystem?
Finch: Whales recycle nutrients through the water column, which helps plankton grow and feeds the whole food web.
--- END MEMORY ---`;
const streamSystem = [pb.buildSystemPrompt("conversation"), SYNTHETIC_MEMORY, pb.STREAM_REPLY_GUIDANCE]
  .filter((s: string) => s.length > 0)
  .join("\n\n");
// Phase-2 intent call — HISTORICAL prompt, kept verbatim in this file because
// intent generation was removed from production (src/ai no longer exports
// buildRouterPrompt). The harness still issues this call where the old
// pipeline did, so its load profile stays comparable to earlier runs.
const ROUTER_INSTRUCTIONS_SNAPSHOT = `You are Finch's intent router. Given a user message and the current mode, decide what Finch should do.

Return ONLY a valid JSON object with this exact schema:
{
  "action": "answer" | "change_mode",
  "mode": "conversation" | "plan" | "search" | "research",
  "request": "the user's actual request, preserved verbatim if they asked for something specific, otherwise empty string",
  "reply": "a reply that follows the persona and style rules given below (only for conversation mode)"
}

Rules:
- Explicit Command Rule: Only output action="change_mode" if the user gives a CLEAR INSTRUCTION to switch modes (e.g., "switch to search mode", "change to plan mode", "turn on research mode", "go to conversation mode").
- Conversational Context Rule: Do NOT trigger a mode switch just because keywords like "plan", "search", "research" appear inside a casual sentence or story (e.g., "I was searching my room", "I plan to go later", "This requires research"). Treat these as standard conversation within currentMode.
- Same-Mode Rule: If the target mode matches currentMode, ALWAYS keep action="answer" and answer directly in the "reply" field. Never output change_mode to the same mode.
- For standard conversation, questions, or task requests within the current mode, set action="answer" and answer directly.
- Preserve the user's request in "request" whenever they asked for something specific.
- Never include explanation outside the JSON.`;

const intentPrompt =
  `${ROUTER_INSTRUCTIONS_SNAPSHOT}

Mode-specific guidance for the current context:
${pb.buildSystemPrompt("conversation")}

Current mode: conversation
User message: ${TRANSCRIPT}

Return only the JSON object.

IMPORTANT OVERRIDE: The reply is produced separately. Set "reply" to "" (empty string) and output only the minimal JSON with action, mode and request.`;

// ---------------------------------------------------------------------------
// Fixed audio fixtures: same 16 kHz mono 16-bit WAV shape the browser sends.
// Source heyfinch.wav is 22.05 kHz, so it is resampled to 16 kHz here.
// ---------------------------------------------------------------------------
function resample16kMono(src: Buffer): Buffer {
  const rate = src.readUInt32LE(24);
  const channels = src.readUInt16LE(22);
  const dataSize = src.readUInt32LE(40);
  const pcm = src.subarray(44, 44 + dataSize);
  const frames = Math.floor(pcm.length / 2 / channels);
  const outFrames = Math.floor((frames * 16000) / rate);
  const out = Buffer.alloc(44 + outFrames * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + outFrames * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24);
  out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(outFrames * 2, 40);
  for (let i = 0; i < outFrames; i++) {
    const pos = (i * rate) / 16000;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const s0 = pcm.readInt16LE(Math.min(i0, frames - 1) * 2 * channels);
    const s1 = pcm.readInt16LE(Math.min(i0 + 1, frames - 1) * 2 * channels);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac))), 44 + i * 2);
  }
  return out;
}

function doubleWav(wav: Buffer): Buffer {
  const dataSize = wav.readUInt32LE(40);
  const pcm = wav.subarray(44, 44 + dataSize);
  const out = Buffer.alloc(44 + dataSize * 2);
  wav.copy(out, 0, 0, 44);
  out.writeUInt32LE(dataSize * 2, 4);
  out.writeUInt32LE(36 + dataSize * 2, 4);
  pcm.copy(out, 44);
  pcm.copy(out, 44 + dataSize);
  return out;
}

const sourceWav = fs.readFileSync("C:/Users/Saran/AppData/Local/Temp/opencode/heyfinch.wav");
const wakeFixture = resample16kMono(sourceWav); // ~3.2 s (wake-word segment scale)
const realFixture = doubleWav(wakeFixture); // ~6.4 s (manual mic turn scale)
fs.writeFileSync(path.join(OUT, "fixture-real-16k.wav"), realFixture);
fs.writeFileSync(path.join(OUT, "fixture-wake-16k.wav"), wakeFixture);
const wavSec = (w: Buffer): number =>
  r2(w.readUInt32LE(40) / (w.readUInt32LE(24) * w.readUInt16LE(22) * (w.readUInt16LE(34) / 8)));

// ---------------------------------------------------------------------------
// Resource sampler (Windows built-in perf classes, 1 Hz CSV)
// ---------------------------------------------------------------------------
type Sampler = { proc: import("node:child_process").ChildProcess; csv: string };
function startSampler(): Sampler {
  const csv = path.join(OUT, `resources-${Date.now()}.csv`);
  const proc = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(ROOT, "scripts/benchmark/sample-resources.ps1"),
      "-OutFile",
      csv,
      "-TrackPids",
      String(process.pid),
      "-IntervalMs",
      "1000",
    ],
    { stdio: "ignore" }
  );
  return { proc, csv };
}

// ---------------------------------------------------------------------------
// Test helpers (all production code paths)
// ---------------------------------------------------------------------------
type WhisperRun = { ms: number; chars: number; text: string };
async function whisperRun(fixture: Buffer, kind: "real" | "wake"): Promise<WhisperRun> {
  const t0 = Date.now();
  const text = await voice.transcribeWav(fixture, kind);
  return { ms: Date.now() - t0, chars: text.length, text };
}

type QwenRun = {
  label: string;
  ttftMs: number;
  totalMs: number;
  chars: number;
  tokensIn: number;
  tokensOut: number;
  doneReason: string;
};
async function qwenStream(
  label: string,
  opts?: { onDelta?: (delta: string, full: string) => void; onFirstToken?: () => void }
): Promise<QwenRun & { text: string }> {
  const t0 = Date.now();
  let ttft = -1;
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let doneReason = "";
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QWEN_MODEL,
      prompt: TRANSCRIPT,
      system: streamSystem,
      stream: true,
      think: false,
      options: { temperature: 0.7, num_predict: 512, num_ctx: 4096 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const handleLine = (line: string): void => {
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof chunk.prompt_eval_count === "number") tokensIn = chunk.prompt_eval_count;
    if (typeof chunk.eval_count === "number") tokensOut = chunk.eval_count;
    if (typeof chunk.done_reason === "string") doneReason = chunk.done_reason;
    if (typeof chunk.response === "string" && chunk.response.length > 0) {
      if (ttft < 0) {
        ttft = Date.now() - t0;
        opts?.onFirstToken?.();
      }
      text += chunk.response;
      opts?.onDelta?.(chunk.response, text);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    for (let idx = buffered.indexOf("\n"); idx !== -1; idx = buffered.indexOf("\n")) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (line.length > 0) handleLine(line);
    }
  }
  if (buffered.trim().length > 0) handleLine(buffered.trim());
  return {
    label,
    ttftMs: ttft,
    totalMs: Date.now() - t0,
    chars: text.length,
    tokensIn,
    tokensOut,
    doneReason,
    text,
  };
}

async function qwenIntent(): Promise<{ ms: number; chars: number; tokensOut: number }> {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QWEN_MODEL,
      prompt: intentPrompt,
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0.7, num_predict: 512, num_ctx: 4096 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const json = (await res.json()) as { response?: string; eval_count?: number };
  return { ms: Date.now() - t0, chars: (json.response || "").length, tokensOut: json.eval_count ?? 0 };
}

// Non-streaming full-reply call: the sequential pipeline's phase 1 (production
// uses adapter.generate with the same system prompt + temperature 0.7).
type QwenGenRun = { ms: number; chars: number; tokensIn: number; tokensOut: number; doneReason: string; text: string };
async function qwenGenerate(label: string): Promise<QwenGenRun> {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QWEN_MODEL,
      prompt: TRANSCRIPT,
      system: streamSystem,
      stream: false,
      think: false,
      options: { temperature: 0.7, num_predict: 512, num_ctx: 4096 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const json = (await res.json()) as {
    response?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
  };
  const text = json.response || "";
  const ms = Date.now() - t0;
  console.log(`[${label}] generate: ms=${ms} chars=${text.length} tokens=${json.eval_count ?? 0} reason=${json.done_reason || ""}`);
  return {
    ms,
    chars: text.length,
    tokensIn: json.prompt_eval_count ?? 0,
    tokensOut: json.eval_count ?? 0,
    doneReason: json.done_reason || "",
    text,
  };
}

type KokoroRun = { chars: number; ms: number; audioSec: number; rtf: number; charsPerSec: number; bytes: number };
async function kokoroRun(text: string): Promise<KokoroRun> {
  const t0 = Date.now();
  const wav = await synthesizeKokoro(text);
  const ms = Date.now() - t0;
  const rate = wav.readUInt32LE(24);
  const audioSec = wav.readUInt32LE(40) / (rate * 2);
  return {
    chars: text.length,
    ms,
    audioSec: r2(audioSec),
    rtf: r2(ms / 1000 / audioSec),
    charsPerSec: r2(text.length / audioSec),
    bytes: wav.length,
  };
}

// Piper synthesis through the production /speak service path (explicit engine
// selection; no Kokoro involved). Same metrics shape as kokoroRun.
async function piperRun(text: string): Promise<KokoroRun> {
  const t0 = Date.now();
  const result = await voice.synthesizeSpeech(text, "piper");
  const ms = Date.now() - t0;
  if (result.engine !== "piper") throw new Error(`expected engine=piper, got ${result.engine}`);
  const wav = result.wav;
  const rate = wav.readUInt32LE(24);
  const audioSec = wav.readUInt32LE(40) / (rate * 2);
  return {
    chars: text.length,
    ms,
    audioSec: r2(audioSec),
    rtf: r2(ms / 1000 / audioSec),
    charsPerSec: r2(text.length / audioSec),
    bytes: wav.length,
  };
}

// Kokoro test chunks (character targets from the task spec).
const CHUNKS = {
  short: "Hello there. I am Finch, your assistant for today.", // ~50
  medium:
    "The ocean covers most of our planet, and we have mapped only a small part of its floor in detail so far.", // ~104
  long:
    "Photosynthesis happens in two stages. The light reactions capture sunlight and make energy, while the Calvin cycle uses that energy to build sugar from carbon dioxide. Plants need the whole process to grow.", // ~197
};

// Sentence-boundary speech buffer mirroring the production SpeechBuffer rule.
class MiniSpeechBuffer {
  private buf = "";
  feed(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    const re = /[.!?][)"'’”]*[ \t]+|\n+/g;
    let scan = 0;
    for (;;) {
      re.lastIndex = scan;
      const m = re.exec(this.buf);
      if (!m) break;
      const cut = m.index + m[0].length;
      if (this.buf.slice(0, cut).trim().length < 20) {
        scan = cut; // merge a too-short piece with the next sentence
        continue;
      }
      out.push(this.buf.slice(0, cut).trim());
      this.buf = this.buf.slice(cut);
      scan = 0;
    }
    while (this.buf.length >= 240) {
      const slice = this.buf.slice(0, 240);
      const sp = slice.lastIndexOf(" ");
      const cut = sp > 100 ? sp : 240;
      out.push(this.buf.slice(0, cut).trim());
      this.buf = this.buf.slice(cut);
    }
    return out;
  }
  flush(): string | null {
    const t = this.buf.trim();
    this.buf = "";
    return t.length > 0 ? t : null;
  }
}

async function ollamaPs(): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`);
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (json.models ?? []).map((m) => m.name);
    return names.length ? names.join(",") : "none-loaded";
  } catch {
    return "unreachable";
  }
}

// ---------------------------------------------------------------------------
// Test windows + results
// ---------------------------------------------------------------------------
type TestWindow = Record<string, unknown> & { name: string; start: string; end: string };
const results: { meta: Record<string, unknown>; tests: TestWindow[] } = {
  meta: {},
  tests: [],
};

async function runWindow<T extends Record<string, unknown>>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = new Date().toISOString();
  const metrics = await fn();
  const end = new Date().toISOString();
  results.tests.push({ name, start, end, ...metrics });
  return metrics;
}

function msStats(xs: number[]): { avg: number; min: number; max: number } {
  return { avg: Math.round(avg(xs)), min: Math.round(Math.min(...xs)), max: Math.round(Math.max(...xs)) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
async function testBaseline(): Promise<Record<string, unknown>> {
  await sleep(10_000);
  return { note: "idle system, sampler warm-up" };
}

async function testA(): Promise<Record<string, unknown>> {
  const real: WhisperRun[] = [];
  for (let i = 0; i < 3; i++) {
    real.push(await whisperRun(realFixture, "real"));
    console.log(`[A] real run${i + 1}: ms=${real[i].ms} chars=${real[i].chars} text="${real[i].text}"`);
    await sleep(300);
  }
  const wake: WhisperRun[] = [];
  for (let i = 0; i < 2; i++) {
    wake.push(await whisperRun(wakeFixture, "wake"));
    console.log(`[A] wake run${i + 1}: ms=${wake[i].ms} chars=${wake[i].chars} text="${wake[i].text}"`);
    await sleep(300);
  }
  const realMs = real.map((r) => r.ms);
  const wakeMs = wake.map((r) => r.ms);
  return {
    model_real: "ggml-small.en-q5_1.bin",
    model_wake: "ggml-base.en-q5_1.bin",
    fixtureSec: wavSec(realFixture),
    real_runs: real.map((r) => ({ ms: r.ms, chars: r.chars })),
    real_stats: msStats(realMs),
    wake_runs: wake.map((r) => ({ ms: r.ms, chars: r.chars })),
    wake_stats: msStats(wakeMs),
  };
}

async function testB(): Promise<Record<string, unknown>> {
  const psBefore = await ollamaPs();
  const runs: (QwenRun & { text: string })[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await qwenStream(`B${i + 1}`);
    runs.push(r);
    console.log(
      `[B] run${i + 1}: ttft=${r.ttftMs}ms total=${r.totalMs}ms tokens=${r.tokensOut} in=${r.tokensIn} chars=${r.chars}`
    );
    await sleep(500);
  }
  const psAfter = await ollamaPs();
  return {
    model: QWEN_MODEL,
    systemLen: streamSystem.length,
    transcriptLen: TRANSCRIPT.length,
    ollamaPsBefore: psBefore,
    ollamaPsAfter: psAfter,
    runs: runs.map(({ label, ttftMs, totalMs, chars, tokensIn, tokensOut, doneReason }) => ({
      label,
      ttftMs,
      totalMs,
      chars,
      tokensIn,
      tokensOut,
      doneReason,
    })),
    ttft_stats: msStats(runs.map((r) => r.ttftMs)),
    total_stats: msStats(runs.map((r) => r.totalMs)),
  };
}

async function testC(): Promise<Record<string, unknown>> {
  const cold = await kokoroRun(CHUNKS.medium);
  console.log(
    `[C] COLD (spawn+load+gen): ms=${cold.ms} chars=${cold.chars} audio=${cold.audioSec}s rtf=${cold.rtf}`
  );
  const bySize: Record<string, KokoroRun[]> = { short: [], medium: [], long: [] };
  for (let i = 0; i < 3; i++) {
    for (const size of ["short", "medium", "long"] as const) {
      const r = await kokoroRun(CHUNKS[size]);
      bySize[size].push(r);
      console.log(
        `[C] ${size} run${i + 1}: ms=${r.ms} chars=${r.chars} audio=${r.audioSec}s rtf=${r.rtf} cps=${r.charsPerSec}`
      );
      await sleep(200);
    }
  }
  const rtfOf = (size: string): { avg: number; min: number; max: number } => {
    const xs = bySize[size].map((r) => r.rtf);
    return { avg: r2(avg(xs)), min: Math.min(...xs), max: Math.max(...xs) };
  };
  return {
    voice: "am_santa",
    numThreads: 4,
    cold,
    short: { chars: CHUNKS.short.length, runs: bySize.short, ms_stats: msStats(bySize.short.map((r) => r.ms)), rtf: rtfOf("short") },
    medium: { chars: CHUNKS.medium.length, runs: bySize.medium, ms_stats: msStats(bySize.medium.map((r) => r.ms)), rtf: rtfOf("medium") },
    long: { chars: CHUNKS.long.length, runs: bySize.long, ms_stats: msStats(bySize.long.map((r) => r.ms)), rtf: rtfOf("long") },
  };
}

async function testD(): Promise<Record<string, unknown>> {
  const psBefore = await ollamaPs();
  const t0 = Date.now();
  const [whisper, qwen] = await Promise.all([whisperRun(realFixture, "real"), qwenStream("D")]);
  const wall = Date.now() - t0;
  console.log(
    `[D] concurrent: whisper=${whisper.ms}ms qwen ttft=${qwen.ttftMs}ms total=${qwen.totalMs}ms wall=${wall}ms`
  );
  return {
    ollamaPsBefore: psBefore,
    wallMs: wall,
    whisper: { ms: whisper.ms, chars: whisper.chars },
    qwen: { ttftMs: qwen.ttftMs, totalMs: qwen.totalMs, chars: qwen.chars, tokensOut: qwen.tokensOut },
  };
}

async function testE(): Promise<Record<string, unknown>> {
  const psBefore = await ollamaPs();
  let fireFirst = (): void => {};
  const firstToken = new Promise<void>((resolve) => {
    fireFirst = resolve;
  });
  const qwenP = qwenStream("E", { onFirstToken: () => fireFirst() });
  await firstToken;
  const tTts = Date.now();
  const chunks: KokoroRun[] = [];
  chunks.push(await kokoroRun(CHUNKS.medium));
  chunks.push(await kokoroRun(CHUNKS.medium));
  chunks.push(await kokoroRun(CHUNKS.medium));
  const ttsWall = Date.now() - tTts;
  const qwen = await qwenP;
  console.log(
    `[E] qwen ttft=${qwen.ttftMs} total=${qwen.totalMs} | tts chunks ${chunks.map((c) => c.ms).join("/")}ms rtf=${chunks.map((c) => c.rtf).join("/")}`
  );
  return {
    ollamaPsBefore: psBefore,
    qwen: { ttftMs: qwen.ttftMs, totalMs: qwen.totalMs, chars: qwen.chars, tokensOut: qwen.tokensOut },
    tts_started_after_first_token: true,
    tts_wall_ms: ttsWall,
    chunks,
    overlap_note: "tts ran while qwen was still generating",
  };
}

async function testF(engine: "kokoro" | "piper" = "kokoro"): Promise<Record<string, unknown>> {
  const psBefore = await ollamaPs();
  const t0 = Date.now();
  const synthRun = engine === "piper" ? piperRun : kokoroRun;

  // 1. Whisper transcription (production real-turn path).
  const whisper = await whisperRun(realFixture, "real");
  const whisperEnd = Date.now() - t0;
  const whisperEndIso = new Date().toISOString();
  console.log(`[F] whisper: ${whisper.ms}ms chars=${whisper.chars}`);

  // 2. Qwen stream with production-style sentence chunking feeding a serial
  //    Kokoro pump (one TTS job at a time, exactly like the production queue).
  const buffer = new MiniSpeechBuffer();
  const chunkQueue: string[] = [];
  const chunksOut: Array<KokoroRun & { finishedAtMs: number }> = [];
  let streamEnded = false;
  let firstAudioAt = 0;
  let ttsStartIso = "";
  let firstTtsStarted = (): void => {};
  const firstTtsSignal = new Promise<void>((resolve) => {
    firstTtsStarted = resolve;
  });

  const consumer = (async (): Promise<void> => {
    for (;;) {
      if (chunkQueue.length > 0) {
        const text = chunkQueue.shift() as string;
        if (chunksOut.length === 0) {
          firstTtsStarted();
          ttsStartIso = new Date().toISOString();
        }
        const r = await synthRun(text);
        chunksOut.push({ ...r, finishedAtMs: Date.now() - t0 });
        if (firstAudioAt === 0) firstAudioAt = Date.now() - t0;
        console.log(
          `[F/${engine}] tts chunk${chunksOut.length}: ms=${r.ms} chars=${r.chars} audio=${r.audioSec}s rtf=${r.rtf}`
        );
        continue;
      }
      if (streamEnded) break;
      await sleep(15);
    }
  })();

  // 4. Background wake-word whisper checks during speech (production runs
  //    them every few seconds while a reply is playing).
  const wakePhase = (async (): Promise<WhisperRun[]> => {
    // Guard: if the stream produced no chunks at all, do not wait forever.
    await Promise.race([firstTtsSignal, sleep(60_000)]);
    const w1 = await whisperRun(wakeFixture, "wake");
    console.log(`[F] wake#1 during TTS: ms=${w1.ms} chars=${w1.chars}`);
    await sleep(4000);
    const w2 = await whisperRun(wakeFixture, "wake");
    console.log(`[F] wake#2 during TTS: ms=${w2.ms} chars=${w2.chars}`);
    return [w1, w2];
  })();

  const streamStart = Date.now() - t0;
  const streamStartIso = new Date().toISOString();
  const stream = await qwenStream("F", {
    onDelta: (delta) => {
      for (const c of buffer.feed(delta)) chunkQueue.push(c);
    },
  });
  const streamEnd = Date.now() - t0;
  const streamEndIso = new Date().toISOString();
  console.log(`[F] stream: ttft=${stream.ttftMs} total=${stream.totalMs} chars=${stream.chars}`);

  // 3. Phase-2 intent call starts as soon as the stream ends (production) —
  //    it overlaps the still-running TTS pump by design in streaming mode.
  const intentStartIso = new Date().toISOString();
  const intentP = qwenIntent();

  // Flush the buffer (single-sentence tail) and drain the pump.
  const rest = buffer.flush();
  if (rest !== null) chunkQueue.push(rest);
  streamEnded = true;
  await consumer;
  const ttsEndIso = new Date().toISOString();

  const intent = await intentP;
  const intentEndIso = new Date().toISOString();
  console.log(`[F] intent: ${intent.ms}ms tokens=${intent.tokensOut}`);
  const wakes = await wakePhase;
  const totalTurn = Date.now() - t0;

  // Playback model: chunk 1 starts when its synthesis finishes; each later
  // chunk starts at max(its synth finish, previous clip end) — production
  // prefetches chunk N+1 while chunk N plays.
  let playbackCursor = 0;
  for (const c of chunksOut) {
    playbackCursor = Math.max(playbackCursor, c.finishedAtMs) + Math.round(c.audioSec * 1000);
  }
  const playbackFinishMs = playbackCursor;

  return {
    ttsEngine: engine,
    ollamaPsBefore: psBefore,
    whisper: { ms: whisper.ms, chars: whisper.chars, endMs: whisperEnd },
    qwen_stream: {
      startMs: streamStart,
      ttftMs: stream.ttftMs,
      totalMs: stream.totalMs,
      endMs: streamEnd,
      chars: stream.chars,
      tokensOut: stream.tokensOut,
    },
    intent: { ms: intent.ms, tokensOut: intent.tokensOut },
    tts_chunks: chunksOut,
    firstAudioMs: firstAudioAt,
    timeToFirstAudio_fromTurnStart: firstAudioAt,
    timeToFirstAudio_fromWhisperEnd: firstAudioAt - whisperEnd,
    timeToFirstAudio_fromStreamStart: firstAudioAt - streamStart,
    playbackFinishMs,
    timeToPlaybackFinish_fromWhisperEnd: playbackFinishMs - whisperEnd,
    wake_during_tts: wakes.map((w) => ({ ms: w.ms, chars: w.chars })),
    totalTurnMs: totalTurn,
    phases: {
      generation: { start: streamStartIso, end: streamEndIso },
      intent: { start: intentStartIso, end: intentEndIso },
      synthesis: { start: ttsStartIso || whisperEndIso, end: ttsEndIso },
    },
  };
}

// Sequential pipeline test (VOICE_PIPELINE_MODE=sequential structure, mirrors
// F's methodology): whisper → non-streaming full reply (Qwen exclusive) →
// intent BEFORE any TTS → ONE full-reply Kokoro call → single clip playback.
// Wake checks run during synthesis (Change B gates them off while TTS runs).
async function testS(): Promise<Record<string, unknown>> {
  const psBefore = await ollamaPs();
  const t0 = Date.now();

  // 1. Whisper (identical to F).
  const whisper = await whisperRun(realFixture, "real");
  const whisperEnd = Date.now() - t0;
  console.log(`[S] whisper: ${whisper.ms}ms chars=${whisper.chars}`);

  // 2. Non-streaming full reply: nothing else may run during this call.
  const genStartIso = new Date().toISOString();
  const gen = await qwenGenerate("S");
  const genEnd = Date.now() - t0;
  const genEndIso = new Date().toISOString();

  // 3. Intent BEFORE the client may start any TTS (sequential order), so the
  //    following synthesis call gets the CPU entirely to itself.
  const intent = await qwenIntent();
  const intentEnd = Date.now() - t0;
  const intentEndIso = new Date().toISOString();
  console.log(`[S] generate: ${gen.ms}ms chars=${gen.chars} | intent: ${intent.ms}ms tokens=${intent.tokensOut}`);

  // 4. ONE synthesis call for the ENTIRE reply (capped like production).
  const fullText = gen.text.slice(0, 1500);
  const synthStartIso = new Date().toISOString();
  const synthP = kokoroRun(fullText);

  // 5. Wake-word checks during synthesis (production re-arms the wake mic
  //    while a reply is in flight; Change B answers them instantly during TTS).
  const wakePhase = (async (): Promise<WhisperRun[]> => {
    const w1 = await whisperRun(wakeFixture, "wake");
    console.log(`[S] wake#1 during synth: ms=${w1.ms} chars=${w1.chars}`);
    await sleep(4000);
    const w2 = await whisperRun(wakeFixture, "wake");
    console.log(`[S] wake#2 during synth: ms=${w2.ms} chars=${w2.chars}`);
    return [w1, w2];
  })();

  const synth = await synthP;
  const firstAudio = Date.now() - t0;
  const synthEndIso = new Date().toISOString();
  console.log(`[S] synth: ms=${synth.ms} chars=${synth.chars} audio=${synth.audioSec}s rtf=${synth.rtf}`);
  const wakes = await wakePhase;

  // 6. Playback model: the single clip starts when synthesis finishes and
  //    plays straight through (one clip, no pipelining).
  const playbackFinishMs = firstAudio + Math.round(synth.audioSec * 1000);
  const totalTurn = Date.now() - t0;

  return {
    ollamaPsBefore: psBefore,
    whisper: { ms: whisper.ms, chars: whisper.chars, endMs: whisperEnd },
    qwen_generate: {
      ms: gen.ms,
      chars: gen.chars,
      tokensIn: gen.tokensIn,
      tokensOut: gen.tokensOut,
      doneReason: gen.doneReason,
      endMs: genEnd,
    },
    intent: { ms: intent.ms, tokensOut: intent.tokensOut, endMs: intentEnd },
    tts_single: synth,
    firstAudioMs: firstAudio,
    timeToFirstAudio_fromTurnStart: firstAudio,
    timeToFirstAudio_fromWhisperEnd: firstAudio - whisperEnd,
    timeToTextReady_fromWhisperEnd: genEnd - whisperEnd,
    timeToTextReadyInclIntent_fromWhisperEnd: intentEnd - whisperEnd,
    playbackFinishMs,
    timeToPlaybackFinish_fromWhisperEnd: playbackFinishMs - whisperEnd,
    wake_during_synth: wakes.map((w) => ({ ms: w.ms, chars: w.chars })),
    totalTurnMs: totalTurn,
    phases: {
      generation: { start: genStartIso, end: genEndIso },
      intent: { start: genEndIso, end: intentEndIso },
      synthesis: { start: synthStartIso, end: synthEndIso },
    },
  };
}

// ---------------------------------------------------------------------------
// Resource-window analysis
// ---------------------------------------------------------------------------
type CsvRow = {
  ts: number;
  kind: string;
  name: string;
  pid: number;
  cpu: number | null;
  ws: number | null;
  priv: number | null;
  pf: number | null;
  sysCpu: number | null;
  avail: number | null;
  pagefile: number | null;
  pageIn: number | null;
  maxFreq: number | null;
  commitPct: number | null;
};

function parseCsv(csvPath: string): CsvRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).slice(1);
  const num = (s: string): number | null => (s === "" || s == null || Number.isNaN(Number(s)) ? null : Number(s));
  const rows: CsvRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = line.split(",");
    const ts = Date.parse(c[0]);
    if (Number.isNaN(ts)) continue;
    rows.push({
      ts,
      kind: c[1] || "",
      name: c[2] || "",
      pid: Number(c[3] || 0),
      cpu: num(c[4]),
      ws: num(c[5]),
      priv: num(c[6]),
      pf: num(c[7]),
      sysCpu: num(c[8]),
      avail: num(c[9]),
      pagefile: num(c[10]),
      pageIn: num(c[11]),
      maxFreq: num(c[13]),
      commitPct: num(c[14]),
    });
  }
  return rows;
}

function classifyProc(name: string, pid: number): string {
  if (pid === process.pid) return "bench-node (kokoro worker)";
  if (/^llama-server/i.test(name)) return "ollama-runner (llama-server)";
  if (/^ollama/i.test(name)) return "ollama-server";
  if (/^whisper-cli/i.test(name)) return "whisper-cli";
  if (/^piper/i.test(name)) return "piper";
  if (/^node/i.test(name)) return "node-other (dev servers etc)";
  return `other:${name}`;
}

function windowResources(rows: CsvRow[], startIso: string, endIso: string): Record<string, unknown> {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const win = rows.filter((r) => r.ts >= start && r.ts <= end);
  const sys = win.filter((r) => r.kind === "sys");
  const sysCpu = sys.map((r) => r.sysCpu).filter((x): x is number => x !== null);
  const avail = sys.map((r) => r.avail).filter((x): x is number => x !== null);
  const pageIn = sys.map((r) => r.pageIn).filter((x): x is number => x !== null);
  const pagefile = sys.map((r) => r.pagefile).filter((x): x is number => x !== null);
  const freq = sys.map((r) => r.maxFreq).filter((x): x is number => x !== null);
  const commit = sys.map((r) => r.commitPct).filter((x): x is number => x !== null);

  const groups = new Map<string, { cpu: number[]; ws: number[]; priv: number[]; pf: number[] }>();
  for (const r of win) {
    if (r.kind !== "proc") continue;
    const key = classifyProc(r.name, r.pid);
    let g = groups.get(key);
    if (!g) {
      g = { cpu: [], ws: [], priv: [], pf: [] };
      groups.set(key, g);
    }
    if (r.cpu !== null) g.cpu.push(r.cpu);
    if (r.ws !== null) g.ws.push(r.ws);
    if (r.priv !== null) g.priv.push(r.priv);
    if (r.pf !== null) g.pf.push(r.pf);
  }
  const procs: Record<string, Record<string, number>> = {};
  for (const [key, g] of groups) {
    procs[key] = {
      cpuAvg: r2(avg(g.cpu)),
      cpuMax: g.cpu.length ? Math.max(...g.cpu) : 0,
      wsMaxMB: g.ws.length ? Math.max(...g.ws) : 0,
      privMaxMB: g.priv.length ? Math.max(...g.priv) : 0,
      pageFaultsPerSecMax: g.pf.length ? Math.max(...g.pf) : 0,
    };
  }
  return {
    samples: win.length,
    sysCpuAvg: r2(avg(sysCpu)),
    sysCpuMax: sysCpu.length ? Math.max(...sysCpu) : 0,
    maxFreqPctAvg: freq.length ? r2(avg(freq)) : 0,
    maxFreqPctMin: freq.length ? Math.min(...freq) : 0,
    commitPctMax: commit.length ? Math.max(...commit) : 0,
    availMBMin: avail.length ? Math.min(...avail) : 0,
    availMBAvg: r2(avg(avail)),
    pageInPerSecAvg: r2(avg(pageIn)),
    pagefileMBMax: pagefile.length ? Math.max(...pagefile) : 0,
    procs,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function printReport(): void {
  const rows: CsvRow[] = parseCsv(results.meta.samplerCsv as string);
  for (const t of results.tests) {
    const rec = t as Record<string, unknown>;
    rec.resources = windowResources(rows, t.start, t.end);
    // Per-phase windows (generation / intent / synthesis) for peak-CPU notes.
    const phases = rec.phases as Record<string, { start: string; end: string }> | undefined;
    if (phases && typeof phases === "object") {
      const phaseResources: Record<string, unknown> = {};
      for (const [phaseName, window] of Object.entries(phases)) {
        if (window && typeof window.start === "string" && typeof window.end === "string") {
          phaseResources[phaseName] = windowResources(rows, window.start, window.end);
        }
      }
      rec.phaseResources = phaseResources;
    }
  }

  const out: Record<string, unknown> = results;
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(out, null, 2));

  console.log("\n================ FINCH BENCHMARK RESULTS ================");
  console.log(JSON.stringify(results.meta, null, 2));
  for (const t of results.tests) {
    const { name, start, end, resources, phaseResources, ...metrics } = t as Record<string, unknown>;
    void start;
    void end;
    console.log(`\n--- ${name} ---`);
    console.log(JSON.stringify(metrics, null, 2));
    console.log("resources: " + JSON.stringify(resources));
    if (phaseResources) console.log("phaseResources: " + JSON.stringify(phaseResources));
  }
  console.log(`\nRaw CSV: ${results.meta.samplerCsv}`);
  console.log(`JSON:    ${path.join(OUT, "results.json")}`);

  // Head-to-head comparisons (section 10 evidence).
  const byName = (n: string): TestWindow | undefined => results.tests.find((t) => t.name === n);
  const b = byName("B") as Record<string, unknown> | undefined;
  const d = byName("D") as Record<string, unknown> | undefined;
  const e = byName("E") as Record<string, unknown> | undefined;
  const c = byName("C") as Record<string, unknown> | undefined;
  if (b && d && e && c) {
    const bRuns = b.runs as Array<{ ttftMs: number; totalMs: number }>;
    const bWarm = bRuns.slice(1);
    const dQ = d.qwen as { ttftMs: number; totalMs: number };
    const eQ = e.qwen as { ttftMs: number; totalMs: number };
    const cMed = c.medium as { rtf: { avg: number }; ms_stats: { avg: number } };
    const eChunks = e.chunks as KokoroRun[];
    console.log("\n================ COMPARISONS ================");
    console.log(
      `Qwen TTFT warm-alone avg=${Math.round(avg(bWarm.map((r) => r.ttftMs)))}ms  with-whisper=${dQ.ttftMs}ms  with-kokoro=${eQ.ttftMs}ms`
    );
    console.log(
      `Qwen total warm-alone avg=${Math.round(avg(bWarm.map((r) => r.totalMs)))}ms  with-whisper=${dQ.totalMs}ms  with-kokoro=${eQ.totalMs}ms`
    );
    console.log(
      `Kokoro medium alone avg=${cMed.ms_stats.avg}ms rtf=${cMed.rtf.avg}  under-qwen avg=${Math.round(
        avg(eChunks.map((x) => x.ms))
      )}ms rtf=${r2(avg(eChunks.map((x) => x.rtf)))}`
    );
    console.log(
      `Kokoro under-qwen runs: ${eChunks.map((x) => `${x.ms}ms/rtf${x.rtf}`).join("  ")}`
    );
  }

  // Streaming Kokoro (F) vs streaming Piper (P) head-to-head — only when both
  // ran in this invocation (e.g. "FP" / "PF").
  const f = byName("F") as Record<string, unknown> | undefined;
  const p = byName("P") as Record<string, unknown> | undefined;
  if (f && p) {
    console.log("\n================ STREAMING KOKORO (F) vs STREAMING PIPER (P) ================");
    const fa = f.firstAudioMs as number;
    const pa = p.firstAudioMs as number;
    const fw = f.wake_during_tts as Array<{ ms: number }>;
    const pw = p.wake_during_tts as Array<{ ms: number }>;
    const fChunks = f.tts_chunks as KokoroRun[];
    const pChunks = p.tts_chunks as KokoroRun[];
    console.log(`First audio from turn start : F(kokoro)=${fa}ms  P(piper)=${pa}ms  (delta ${pa - fa >= 0 ? "+" : ""}${pa - fa}ms)`);
    console.log(`First audio from whisper end: F=${f.timeToFirstAudio_fromWhisperEnd}ms  P=${p.timeToFirstAudio_fromWhisperEnd}ms`);
    console.log(`Reply chars                  : F=${(f.qwen_stream as { chars: number }).chars}  P=${(p.qwen_stream as { chars: number }).chars}`);
    console.log(
      `TTS chunk RTF                : F=${fChunks.map((c) => c.rtf).join("/")}  P=${pChunks.map((c) => c.rtf).join("/")}`,
    );
    console.log(
      `First-chunk synth ms         : F=${fChunks[0]?.ms ?? "-"}  P=${pChunks[0]?.ms ?? "-"}`,
    );
    console.log(
      `Wake during TTS              : F=${fw.map((w) => w.ms).join("/")}ms  P=${pw.map((w) => w.ms).join("/")}ms`,
    );
  }

  // Streaming (F) vs sequential (S) head-to-head — only when both ran in this
  // invocation (e.g. "CSF" / "CFS").
  const s = byName("S") as Record<string, unknown> | undefined;
  if (f && s) {
    console.log("\n================ STREAMING (F) vs SEQUENTIAL (S) ================");
    const fa = f.firstAudioMs as number;
    const sa = s.firstAudioMs as number;
    const fp = f.playbackFinishMs as number;
    const sp = s.playbackFinishMs as number;
    const fw = f.wake_during_tts as Array<{ ms: number }>;
    const sw = s.wake_during_synth as Array<{ ms: number }>;
    console.log(`First audio from turn start : F=${fa}ms  S=${sa}ms  (delta ${sa - fa >= 0 ? "+" : ""}${sa - fa}ms)`);
    console.log(`Playback finished           : F=${fp}ms  S=${sp}ms  (delta ${sp - fp >= 0 ? "+" : ""}${sp - fp}ms)`);
    console.log(`First audio from whisper end: F=${f.timeToFirstAudio_fromWhisperEnd}ms  S=${s.timeToFirstAudio_fromWhisperEnd}ms`);
    console.log(
      `Wake during TTS/synth       : F=${fw.map((w) => w.ms).join("/")}ms  S=${sw.map((w) => w.ms).join("/")}ms`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const sampler = startSampler();
results.meta = {
  startedAt: new Date().toISOString(),
  host: {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    totalMemGB: r2(os.totalmem() / 1024 ** 3),
    freeMemGBAtStart: r2(os.freemem() / 1024 ** 3),
    platform: `${os.platform()} ${os.release()}`,
  },
  models: {
    whisper_real: "ggml-small.en-q5_1.bin",
    whisper_wake: "ggml-base.en-q5_1.bin",
    qwen: QWEN_MODEL,
    kokoro: "kokoro-v1.0.int8.sherpa.onnx voice=am_santa numThreads=4 provider=cpu",
      piper: "en_US-lessac-high.onnx (test-P engine)",
  },
  voicePipeline: {
    F_streaming: "sentence chunks speak while Qwen still generates; intent overlaps first TTS chunks (Kokoro)",
    P_streaming: "identical streaming flow with the Piper engine selected (per-request engine choice)",
    S_sequential: "non-streaming reply → intent → ONE full-reply TTS call → single clip; nothing overlaps",
  },
  benchPid: process.pid,
  ollamaModelsAtStart: await ollamaPs(),
  samplerCsv: sampler.csv,
};

// Wait for the sampler's first row so every window has data.
for (let i = 0; i < 50 && !fs.existsSync(sampler.csv); i++) await sleep(200);
await sleep(2000);

const TESTS: Record<string, { name: string; run: () => Promise<Record<string, unknown>> }> = {
  "0": { name: "baseline", run: testBaseline },
  A: { name: "A", run: testA },
  B: { name: "B", run: testB },
  C: { name: "C", run: testC },
  D: { name: "D", run: testD },
  E: { name: "E", run: testE },
  F: { name: "F", run: () => testF("kokoro") },
  P: { name: "P", run: () => testF("piper") },
  S: { name: "S", run: testS },
};
// "all" keeps the historical default order (baseline, A-F, then S); any other
// selector runs the letters in exactly the order given (e.g. "FP", "PF").
const order = WANTED === "ALL" ? ["0", "A", "B", "C", "D", "E", "F", "P", "S"] : WANTED.split("");
try {
  for (const key of order) {
    const test = TESTS[key];
    if (!test) continue;
    const m = await runWindow(test.name, test.run);
    if (test.name === "baseline") console.log(`[baseline] idle 10s captured (${JSON.stringify(m)})`);
  }
} catch (err) {
  console.error("[bench] FAILED:", err);
} finally {
  results.meta.ollamaModelsAtEnd = await ollamaPs();
  results.meta.finishedAt = new Date().toISOString();
  await sleep(1200); // let the sampler tick the last window
  sampler.proc.kill();
  printReport();
  process.exit(0);
}
