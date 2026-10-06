import { Worker } from "node:worker_threads";
import { config } from "@/config/index.js";
import { ModelError, ValidationError } from "@/services/errors.js";

const KOKORO_READY_TIMEOUT_MS = 60_000;
const KOKORO_JOB_TIMEOUT_MS = 120_000;

// Official sid order from sherpa-onnx scripts/kokoro/v1.0/generate_voices_bin.py
// (alphabetical, but em_santa is deliberately last at 53).
const VOICE_SIDS: Record<string, number> = {
  af_alloy: 0,
  af_aoede: 1,
  af_bella: 2,
  af_heart: 3,
  af_jessica: 4,
  af_kore: 5,
  af_nicole: 6,
  af_nova: 7,
  af_river: 8,
  af_sarah: 9,
  af_sky: 10,
  am_adam: 11,
  am_echo: 12,
  am_eric: 13,
  am_fenrir: 14,
  am_liam: 15,
  am_michael: 16,
  am_onyx: 17,
  am_puck: 18,
  am_santa: 19,
  bf_alice: 20,
  bf_emma: 21,
  bf_isabella: 22,
  bf_lily: 23,
  bm_daniel: 24,
  bm_fable: 25,
  bm_george: 26,
  bm_lewis: 27,
  ef_dora: 28,
  em_alex: 29,
  ff_siwis: 30,
  hf_alpha: 31,
  hf_beta: 32,
  hm_omega: 33,
  hm_psi: 34,
  if_sara: 35,
  im_nicola: 36,
  jf_alpha: 37,
  jf_gongitsune: 38,
  jf_nezumi: 39,
  jf_tebukuro: 40,
  jm_kumo: 41,
  pf_dora: 42,
  pm_alex: 43,
  pm_santa: 44,
  zf_xiaobei: 45,
  zf_xiaoni: 46,
  zf_xiaoxiao: 47,
  zf_xiaoyi: 48,
  zm_yunjian: 49,
  zm_yunxi: 50,
  zm_yunxia: 51,
  zm_yunyang: 52,
  em_santa: 53,
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

// True while a Kokoro job is in flight (worker spawn/load or synthesis).
// voice.ts uses this to skip background wake-word checks during TTS so they
// do not steal CPU from the critical first-audio path.
export function isKokoroBusy(): boolean {
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
      job.reject(new ModelError(`Kokoro synthesis failed: ${msg.message ?? "unknown error"}`));
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

  const url = new URL("../../kokoro-tts-worker.mjs", import.meta.url);
  const w = new Worker(url, {
    workerData: {
      kokoro: {
        model: config.voice.kokoroModel,
        voices: config.voice.kokoroVoices,
        tokens: config.voice.kokoroTokens,
        dataDir: config.voice.kokoroEspeakData,
        lang: "en-us",
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
    failWorker(new ModelError(`Kokoro model did not load within ${KOKORO_READY_TIMEOUT_MS}ms`));
  }, KOKORO_READY_TIMEOUT_MS);

  // Identity guards: a late exit/error from an OLD (terminated) worker must
  // never tear down a freshly spawned replacement.
  w.on("message", (msg) => {
    if (worker === w) handleMessage(msg);
  });
  w.on("error", (err: Error) => {
    if (worker === w) failWorker(new ModelError(`Kokoro worker error: ${err.message}`));
  });
  w.on("exit", () => {
    if (worker === w) failWorker(new ModelError("Kokoro worker exited unexpectedly"));
  });
  return readyPromise;
}

export async function synthesizeKokoro(text: string): Promise<Buffer> {
  const sid = VOICE_SIDS[config.voice.kokoroVoice];
  if (sid === undefined) {
    throw new ValidationError(
      `Unknown KOKORO_VOICE "${config.voice.kokoroVoice}" (expected one of ${Object.keys(VOICE_SIDS).join(", ")})`
    );
  }

  activeJobs++;
  try {
    await spawnWorker();
    if (pending) {
      // voice.ts serialises jobs through its shared queue, so this is defensive.
      throw new ModelError("A Kokoro speech job is already running");
    }
    const w = worker;
    if (!w) {
      throw new ModelError("Kokoro worker is not available");
    }

    // return await (not return) so the finally runs only after the job settles.
    return await new Promise<Buffer>((resolve, reject) => {
      const id = nextJobId++;
      const timer = setTimeout(() => {
        if (pending && pending.id === id) {
          failWorker(new ModelError(`Kokoro synthesis timed out after ${KOKORO_JOB_TIMEOUT_MS}ms`));
        }
      }, KOKORO_JOB_TIMEOUT_MS);
      pending = {
        id,
        resolve: (audio) => resolve(floatToWav(audio.samples, audio.sampleRate)),
        reject,
        timer,
      };
      try {
        w.postMessage({ type: "speak", id, text, sid });
      } catch (err) {
        failWorker(new ModelError(`Kokoro worker rejected the job: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  } finally {
    activeJobs--;
  }
}
