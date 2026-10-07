import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "@/config/index.js";
import { ModelError, ValidationError } from "@/services/errors.js";
import { isKittenBusy, synthesizeKitten } from "@/services/tts-kitten.js";
import { isKokoroBusy, synthesizeKokoro } from "@/services/tts-kokoro.js";

const WHISPER_TIMEOUT_MS = 30_000;
const PIPER_TIMEOUT_MS = 30_000;
const PIPER_MAX_TEXT_CHARS = 1500;

// Two independent job chains, each serialising its own jobs (Whisper, Kokoro
// and Piper are all memory hungry, so two jobs of the same kind must never
// overlap). The kinds do not block each other: a background wake-word check no
// longer waits behind a queue of sentence-synthesis jobs during a spoken
// reply, and TTS chunks stay strictly ordered (one pending Kokoro job at most).
function makeEnqueuer(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

const enqueueTranscribe = makeEnqueuer();
const enqueueTts = makeEnqueuer();

// Number of spoken-reply TTS requests in flight (queued or synthesizing,
// either engine). While this is non-zero, background wake-word checks are
// skipped so Whisper does not contend with TTS on the critical first-audio
// path. Real user transcriptions are never affected.
let ttsActiveJobs = 0;

function ttsIsActive(): boolean {
  return ttsActiveJobs > 0 || isKokoroBusy() || isKittenBusy();
}

interface RunProcessOptions {
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
}

function runProcess(
  exe: string,
  options: RunProcessOptions,
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Arguments are always passed as an array — never a shell string.
    const child = spawn(exe, options.args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new ModelError(`Failed to start ${path.basename(exe)}: ${err.message}`),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (timedOut) {
        reject(
          new ModelError(
            `${path.basename(exe)} timed out after ${options.timeoutMs}ms`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new ModelError(
            `${path.basename(exe)} exited with code ${code}: ${stderr.slice(-500).trim()}`,
          ),
        );
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
    });

    if (options.stdin !== undefined) {
      child.stdin.on("error", () => {
        // Ignore EPIPE: the child may exit before consuming stdin.
      });
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertFileExists(
  filePath: string,
  label: string,
): Promise<void> {
  if (!(await fileExists(filePath))) {
    throw new ModelError(`${label} not found at: ${filePath}`);
  }
}

async function withTempDir<T>(
  prefix: string,
  job: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await job(dir);
  } finally {
    // Always clean up, even when the job failed.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Strip noise markers whisper emits (e.g. "[BLANK_AUDIO]" for silence) and
// collapse the result to a single line. Returns "" when nothing was said.
function cleanTranscript(raw: string): string {
  const withoutMarkers = raw
    .replace(/\[BLANK_AUDIO\]/gi, " ")
    .replace(/\r/g, "");
  const cleaned = withoutMarkers
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Whisper sometimes answers noise with only a bracketed annotation, e.g.
  // "(speaking in foreign language)". That is not something the user said.
  if (/^\([^]*\)$/.test(cleaned) || /^\[[^]*\]$/.test(cleaned)) return "";
  return cleaned;
}

// Digital silence makes whisper hallucinate words (e.g. "you"), so skip the
// model entirely when the PCM contains no real signal. Conservative: anything
// above 0.024% of full scale still goes to whisper.
const SILENCE_PEAK_THRESHOLD = 8;

function isSilentPcm(wav: Buffer): boolean {
  // Browser-encoded WAVs always have the standard 44-byte PCM header.
  let peak = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const sample = Math.abs(wav.readInt16LE(i));
    if (sample > peak) peak = sample;
    if (peak > SILENCE_PEAK_THRESHOLD) return false;
  }
  return true;
}

// "real" = manual mic turns and finished wake captures (small model for
// accuracy); "wake" = background wake-word segment checks (base model for
// speed). Selection comes from config, never hardcoded here.
export type TranscribeKind = "real" | "wake";

async function transcribeWavJob(
  wav: Buffer,
  kind: TranscribeKind,
): Promise<string> {
  // TTS started while this wake check was waiting in the transcribe queue:
  // skip it instead of spawning whisper into the synthesis window.
  if (kind === "wake" && ttsIsActive()) {
    return "";
  }
  if (isSilentPcm(wav)) {
    return "";
  }

  const exe = config.voice.whisperExe;
  const model =
    kind === "wake" ? config.voice.whisperWakeModel : config.voice.whisperModel;
  await assertFileExists(exe, "Whisper executable");
  await assertFileExists(model, "Whisper model");

  return withTempDir("finch-whisper-", async (dir) => {
    const wavPath = path.join(dir, "audio.wav");
    await writeFile(wavPath, wav);
    const args = [
      "-m",
      model,
      "-l",
      "en",
      "-t",
      "8",
      "-nt",
      "-np",
      "-f",
      wavPath,
    ];
    if (kind === "wake") {
      // Bias decoding toward the wake phrase so "Finch" is spelled correctly.
      args.push("--prompt", "Hey Finch.");
    }
    const { stdout } = await runProcess(exe, {
      // -nt: no timestamps, -np: print results only (no logs/banners on stdout).
      args,
      timeoutMs: WHISPER_TIMEOUT_MS,
    });
    return cleanTranscript(stdout.toString("utf8"));
  });
}

export function transcribeWav(
  wav: Buffer,
  kind: TranscribeKind = "real",
): Promise<string> {
  if (wav.length === 0) {
    throw new ValidationError("Missing WAV audio body (send audio/wav bytes)");
  }
  if (
    wav.length < 44 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new ValidationError("Request body is not a WAV file");
  }
  // Background wake checks pause during active TTS (returns "" like silence;
  // the frontend retries on the next speech segment). Real turns pass through.
  if (kind === "wake" && ttsIsActive()) {
    return Promise.resolve("");
  }
  return enqueueTranscribe(() => transcribeWavJob(wav, kind));
}

async function synthesizePiperJob(text: string): Promise<Buffer> {
  const exe = config.voice.piperExe;
  const voice = config.voice.piperVoice;
  await assertFileExists(exe, "Piper executable");
  await assertFileExists(voice, "Piper voice model");
  await assertFileExists(config.voice.piperVoiceConfig, "Piper voice config");

  return withTempDir("finch-piper-", async (dir) => {
    const outPath = path.join(dir, "speech.wav");
    await runProcess(exe, {
      // Piper picks up the .json settings automatically (model path + ".json").
      args: ["--model", voice, "--output_file", outPath],
      // Run from the piper folder so espeak-ng-data next to the exe resolves.
      cwd: path.dirname(exe),
      stdin: `${text}\n`,
      timeoutMs: PIPER_TIMEOUT_MS,
    });

    let wav: Buffer;
    try {
      wav = await readFile(outPath);
    } catch {
      throw new ModelError("Piper did not produce an output file");
    }
    if (wav.length === 0) {
      throw new ModelError("Piper produced an empty WAV file");
    }
    return wav;
  });
}

export type TtsEngine = "kokoro" | "kitten" | "piper";
export type TtsResult = {
  wav: Buffer;
  engine: TtsEngine;
  // Set when the configured engine failed and Piper produced the audio.
  fallbackReason?: string;
};

// Kokoro is the default engine when TTS_ENGINE=kokoro; kitten activates with
// TTS_ENGINE=kitten. Anything that goes wrong with either model engine (bad
// path, crash, timeout) falls back to Piper so spoken replies keep working;
// the caller reports the fallback.
// `engine` overrides the global default per request (the conversation's voice
// engine picker); when a model engine is chosen the Piper fallback applies
// exactly as before, and an explicit Piper choice never loads a model engine.
async function synthesizeJob(
  text: string,
  engine?: TtsEngine,
): Promise<TtsResult> {
  const chosen: TtsEngine = engine ?? config.voice.ttsEngine;
  if (chosen === "kokoro") {
    try {
      const wav = await synthesizeKokoro(text);
      return { wav, engine: "kokoro" };
    } catch (err) {
      const fallbackReason = err instanceof Error ? err.message : String(err);
      const wav = await synthesizePiperJob(text);
      return { wav, engine: "piper", fallbackReason };
    }
  }
  if (chosen === "kitten") {
    try {
      const wav = await synthesizeKitten(text);
      return { wav, engine: "kitten" };
    } catch (err) {
      const fallbackReason = err instanceof Error ? err.message : String(err);
      const wav = await synthesizePiperJob(text);
      return { wav, engine: "piper", fallbackReason };
    }
  }
  const wav = await synthesizePiperJob(text);
  return { wav, engine: "piper" };
}

export function synthesizeSpeech(
  text: string,
  engine?: TtsEngine,
): Promise<TtsResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("'text' must be a non-empty string");
  }
  // Cap the input so one reply can never trigger a very long speech job.
  const capped =
    trimmed.length > PIPER_MAX_TEXT_CHARS
      ? trimmed.slice(0, PIPER_MAX_TEXT_CHARS)
      : trimmed;
  ttsActiveJobs++;
  return enqueueTts(() => synthesizeJob(capped, engine)).finally(() => {
    ttsActiveJobs--;
  });
}

export type VoiceHealth = {
  ok: boolean;
  whisper: { exe: string; model: string; exeOk: boolean; modelOk: boolean };
  piper: {
    exe: string;
    voice: string;
    voiceConfig: string;
    exeOk: boolean;
    voiceOk: boolean;
    voiceConfigOk: boolean;
  };
  ttsEngine: TtsEngine;
  kokoro: {
    voice: string;
    model: string;
    voices: string;
    tokens: string;
    espeakData: string;
    modelOk: boolean;
    voicesOk: boolean;
    tokensOk: boolean;
    espeakDataOk: boolean;
  };
  kitten: {
    voice: string;
    model: string;
    voices: string;
    tokens: string;
    espeakData: string;
    modelOk: boolean;
    voicesOk: boolean;
    tokensOk: boolean;
    espeakDataOk: boolean;
  };
};

export async function getVoiceHealth(): Promise<VoiceHealth> {
  const {
    whisperExe,
    whisperModel,
    piperExe,
    piperVoice,
    piperVoiceConfig,
    ttsEngine,
    kokoroModel,
    kokoroVoices,
    kokoroTokens,
    kokoroEspeakData,
    kokoroVoice,
    kittenModel,
    kittenVoices,
    kittenTokens,
    kittenVoice,
  } = config.voice;
  const [
    whisperExeOk,
    whisperModelOk,
    piperExeOk,
    piperVoiceOk,
    piperConfigOk,
    kokoroModelOk,
    kokoroVoicesOk,
    kokoroTokensOk,
    kokoroEspeakOk,
    kittenModelOk,
    kittenVoicesOk,
    kittenTokensOk,
    kittenEspeakOk,
  ] = await Promise.all([
    fileExists(whisperExe),
    fileExists(whisperModel),
    fileExists(piperExe),
    fileExists(piperVoice),
    fileExists(piperVoiceConfig),
    fileExists(kokoroModel),
    fileExists(kokoroVoices),
    fileExists(kokoroTokens),
    fileExists(kokoroEspeakData),
    fileExists(kittenModel),
    fileExists(kittenVoices),
    fileExists(kittenTokens),
    fileExists(kokoroEspeakData),
  ]);
  const kokoroReady =
    kokoroModelOk && kokoroVoicesOk && kokoroTokensOk && kokoroEspeakOk;
  const kittenReady =
    kittenModelOk && kittenVoicesOk && kittenTokensOk && kittenEspeakOk;

  return {
    // Model-engine files only gate health when that engine is active; Piper
    // must always be healthy because it is the fallback engine.
    ok:
      whisperExeOk &&
      whisperModelOk &&
      piperExeOk &&
      piperVoiceOk &&
      piperConfigOk &&
      (ttsEngine === "piper" ||
        (ttsEngine === "kokoro" && kokoroReady) ||
        (ttsEngine === "kitten" && kittenReady)),
    whisper: {
      exe: whisperExe,
      model: whisperModel,
      exeOk: whisperExeOk,
      modelOk: whisperModelOk,
    },
    piper: {
      exe: piperExe,
      voice: piperVoice,
      voiceConfig: piperVoiceConfig,
      exeOk: piperExeOk,
      voiceOk: piperVoiceOk,
      voiceConfigOk: piperConfigOk,
    },
    ttsEngine,
    kokoro: {
      voice: kokoroVoice,
      model: kokoroModel,
      voices: kokoroVoices,
      tokens: kokoroTokens,
      espeakData: kokoroEspeakData,
      modelOk: kokoroModelOk,
      voicesOk: kokoroVoicesOk,
      tokensOk: kokoroTokensOk,
      espeakDataOk: kokoroEspeakOk,
    },
    kitten: {
      voice: kittenVoice,
      model: kittenModel,
      voices: kittenVoices,
      tokens: kittenTokens,
      espeakData: kokoroEspeakData,
      modelOk: kittenModelOk,
      voicesOk: kittenVoicesOk,
      tokensOk: kittenTokensOk,
      espeakDataOk: kittenEspeakOk,
    },
  };
}
