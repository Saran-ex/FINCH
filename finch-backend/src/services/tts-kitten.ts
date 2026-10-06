import { Worker } from "node:worker_threads";
import { config } from "@/config/index.js";
import { ModelError, ValidationError } from "@/services/errors.js";

const KITTEN_READY_TIMEOUT_MS = 60_000;
const KITTEN_JOB_TIMEOUT_MS = 120_000;

// Voice order inside voices.bin (k2-fsa tts-models package, same order as the
// upstream voices.npz) with the public KittenML alias each entry is published
// under (Jasper = expr-voice-2-m). Both spellings map to the same sid so
// either can appear in KITTEN_VOICE.
const VOICE_SIDS: Record<string, number> = {
  Jasper: 0,
  "expr-voice-2-m": 0,
  Bella: 1,
  "expr-voice-2-f": 1,
  Bruno: 2,
  "expr-voice-3-m": 2,
  Luna: 3,
  "expr-voice-3-f": 3,
  Hugo: 4,
  "expr-voice-4-m": 4,
  Rosie: 5,
  "expr-voice-4-f": 5,
  Leo: 6,
  "expr-voice-5-m": 6,
  Kiki: 7,
  "expr-voice-5-f": 7,
};

type ReadyInfo = { loadMs: number; sampleRate: number; numSpeakers: number };
type AudioReply = { sampleRate: number; samples: Float32Array };
type PendingJob = {
  id: number;
  resolve: (audio: AudioReply) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

let worker: Worker | null = null;
let readyPromise: Promise<ReadyInfo> | null = null;
let readyResolve: ((info: ReadyInfo) => void) | null = null;
let readyReject: ((err: Error) => void) | null = null;
let readyTimer: NodeJS.Timeout | null = null;
let pending: PendingJob | null = null;
let nextJobId = 1;
let activeJobs = 0;

// True while a Kitten job is in flight (worker spawn/load or synthesis).
// voice.ts uses this to skip background wake-word checks during TTS so they
// do not steal CPU from the critical first-audio path.
export function isKittenBusy(): boolean {
  return activeJobs > 0;
}

function floatToWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // PCM chunk size
  wav.writeUInt16LE(1, 20); // format = PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return wav;
}

function handleMessage(msg: { type?: string; loadMs?: number; sampleRate?: number; numSpeakers?: number; id?: number; samples?: Float32Array; message?: string }): void {
  if (msg.type === "ready") {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    readyResolve?.({ loadMs: msg.loadMs ?? 0, sampleRate: msg.sampleRate ?? 24000, numSpeakers: msg.numSpeakers ?? 0 });
    return;
  }

  if (msg.id !== undefined && pending && pending.id === msg.id) {
    const job = pending;
    pending = null;
    clearTimeout(job.timer);
    if (msg.type === "audio" && msg.samples) {
      job.resolve({ sampleRate: msg.sampleRate ?? 24000, samples: msg.samples });
    } else {
      job.reject(new ModelError(`Kitten synthesis failed: ${msg.message ?? "unknown error"}`));
    }
  }
}

// Reject whatever is in flight and forget the worker so the next request
// spawns a fresh one (cold model load again).
function failWorker(reason: Error): void {
  const rejReady = readyReject;
  const job = pending;
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  if (job) {
    clearTimeout(job.timer);
    pending = null;
  }
  const w = worker;
  worker = null;
  readyPromise = null;
  readyResolve = null;
  readyReject = null;
  rejReady?.(reason);
  job?.reject(reason);
  void w?.terminate();
}

function spawnWorker(): Promise<ReadyInfo> {
  if (readyPromise) return readyPromise;

  const url = new URL("../../kitten-tts-worker.mjs", import.meta.url);
  const w = new Worker(url, {
    workerData: {
      kitten: {
        model: config.voice.kittenModel,
        voices: config.voice.kittenVoices,
        tokens: config.voice.kittenTokens,
        // Same espeak-ng-data the Kokoro phonemizer uses (nothing Kitten-specific).
        dataDir: config.voice.kokoroEspeakData,
      },
      numThreads: 4,
      provider: "cpu",
      speed: 1,
    },
  });
  // Idle model must not keep a shutting-down process alive.
  w.unref();
  worker = w;
  readyPromise = new Promise<ReadyInfo>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  readyTimer = setTimeout(() => {
    failWorker(new ModelError(`Kitten model did not load within ${KITTEN_READY_TIMEOUT_MS}ms`));
  }, KITTEN_READY_TIMEOUT_MS);

  // Identity guards: a late exit/error from an OLD (terminated) worker must
  // never tear down a freshly spawned replacement.
  w.on("message", (msg) => {
    if (worker === w) handleMessage(msg);
  });
  w.on("error", (err: Error) => {
    if (worker === w) failWorker(new ModelError(`Kitten worker error: ${err.message}`));
  });
  w.on("exit", () => {
    if (worker === w) failWorker(new ModelError("Kitten worker exited unexpectedly"));
  });
  return readyPromise;
}

export async function synthesizeKitten(text: string): Promise<Buffer> {
  const sid = VOICE_SIDS[config.voice.kittenVoice];
  if (sid === undefined) {
    throw new ValidationError(
      `Unknown KITTEN_VOICE "${config.voice.kittenVoice}" (expected one of ${Object.keys(VOICE_SIDS).join(", ")})`
    );
  }

  activeJobs++;
  try {
    await spawnWorker();
    if (pending) {
      // voice.ts serialises jobs through its shared queue, so this is defensive.
      throw new ModelError("A Kitten speech job is already running");
    }
    const w = worker;
    if (!w) {
      throw new ModelError("Kitten worker is not available");
    }

    // return await (not return) so the finally runs only after the job settles.
    return await new Promise<Buffer>((resolve, reject) => {
      const id = nextJobId++;
      const timer = setTimeout(() => {
        if (pending && pending.id === id) {
          failWorker(new ModelError(`Kitten synthesis timed out after ${KITTEN_JOB_TIMEOUT_MS}ms`));
        }
      }, KITTEN_JOB_TIMEOUT_MS);
      pending = {
        id,
        resolve: (audio) => resolve(floatToWav(audio.samples, audio.sampleRate)),
        reject,
        timer,
      };
      try {
        w.postMessage({ type: "speak", id, text, sid });
      } catch (err) {
        failWorker(new ModelError(`Kitten worker rejected the job: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  } finally {
    activeJobs--;
  }
}
