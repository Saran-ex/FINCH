import { env } from "./env.js";
import { type Mode } from "./constants.js";

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  dbPath: env.DB_PATH,
  logDir: env.LOG_DIR,
  ollamaUrl: env.OLLAMA_URL,
  // Comma-separated allow-list (e.g. "http://localhost:8081,http://localhost:5173").
  corsOrigins: env.CORS_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Streamed AI replies (POST /api/turn/stream). Off only when AI_STREAM=0.
  aiStream: env.AI_STREAM !== "0",
  // Voice pipeline scheduling. Only the exact value "sequential" activates the
  // non-overlapping pipeline; anything else keeps normal streaming behaviour.
  voicePipelineMode:
    env.VOICE_PIPELINE_MODE === "sequential"
      ? ("sequential" as const)
      : ("streaming" as const),
  voice: {
    whisperExe: env.WHISPER_EXE,
    whisperModel: env.WHISPER_MODEL,
    whisperWakeModel: env.WHISPER_WAKE_MODEL,
    piperExe: env.PIPER_EXE,
    piperVoice: env.PIPER_VOICE,
    // Piper always looks for the voice settings next to the .onnx with the
    // same base name (confirmed by `piper --help`: default = model + ".json").
    piperVoiceConfig: `${env.PIPER_VOICE}.json`,
    // Spoken-reply engine. Only the exact values "kokoro"/"kitten" activate
    // those engines; everything else (including a typo) keeps the old
    // Piper-only behaviour.
    ttsEngine:
      env.TTS_ENGINE === "kokoro"
        ? ("kokoro" as const)
        : env.TTS_ENGINE === "kitten"
          ? ("kitten" as const)
          : ("piper" as const),
    kokoroModel: env.KOKORO_MODEL,
    kokoroVoices: env.KOKORO_VOICES,
    kokoroTokens: env.KOKORO_TOKENS,
    kokoroEspeakData: env.KOKORO_ESPEAK_DATA,
    kokoroVoice: env.KOKORO_VOICE,
    kittenModel: env.KITTEN_MODEL,
    kittenVoices: env.KITTEN_VOICES,
    kittenTokens: env.KITTEN_TOKENS,
    kittenVoice: env.KITTEN_VOICE,
  },
} as const;

export type { Mode };
