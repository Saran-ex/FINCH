import dotenv from "dotenv";
dotenv.config();

interface Env {
  PORT: number;
  NODE_ENV: string;
  LOG_LEVEL: string;
  DB_PATH: string;
  OLLAMA_URL: string;
  CORS_ORIGIN: string;
  WHISPER_EXE: string;
  WHISPER_MODEL: string;
  WHISPER_WAKE_MODEL: string;
  PIPER_EXE: string;
  PIPER_VOICE: string;
  TTS_ENGINE: string;
  AI_STREAM: string;
  VOICE_PIPELINE_MODE: string;
  KOKORO_MODEL: string;
  KOKORO_VOICES: string;
  KOKORO_TOKENS: string;
  KOKORO_ESPEAK_DATA: string;
  KOKORO_VOICE: string;
  KITTEN_MODEL: string;
  KITTEN_VOICES: string;
  KITTEN_TOKENS: string;
  KITTEN_VOICE: string;
}

function parseEnv(): Env {
  const port = Number(process.env.PORT) || 3001;
  const nodeEnv = process.env.NODE_ENV || "development";
  const logLevel = process.env.LOG_LEVEL || "info";
  const dbPath = process.env.DB_PATH || "data/finch.db";
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:8081";
  const whisperExe = process.env.WHISPER_EXE || "E:\\Finch\\models\\whisper\\Release\\whisper-cli.exe";
  // Real voice turns (manual mic + finished wake captures) use the base
  // model; wake-word checks use the same fast base model.
  const whisperModel = process.env.WHISPER_MODEL || "E:\\Finch\\models\\ggml-base.en-q5_1.bin";
  const whisperWakeModel = process.env.WHISPER_WAKE_MODEL || "E:\\Finch\\models\\ggml-base.en-q5_1.bin";
  const piperExe = process.env.PIPER_EXE || "E:\\Finch\\voices\\piper\\piper\\piper.exe";
  const piperVoice = process.env.PIPER_VOICE || "E:\\Finch\\voices\\en_US-lessac-high.onnx";
  // TTS engine for spoken replies: "kokoro" (default, am_santa voice),
  // "kitten" (Jasper voice) or "piper". Unknown values fall back to piper
  // (the pre-Kokoro behaviour).
  const ttsEngine = (process.env.TTS_ENGINE || "kokoro").trim().toLowerCase();
  // Streaming AI replies to the voice client as they generate. Default on;
  // set AI_STREAM=0 to force the old single-shot turn path.
  const aiStream = (process.env.AI_STREAM ?? "1").trim();
  // Voice pipeline scheduling: "streaming" (default — reply sentences start
  // speaking while the LLM is still generating) or "sequential" (strictly one
  // phase at a time: generate → single full-reply TTS call → play).
  const voicePipelineMode = (process.env.VOICE_PIPELINE_MODE || "streaming").trim().toLowerCase();
  const kokoroModel = process.env.KOKORO_MODEL || "E:\\Finch\\voices\\kokoro\\kokoro-v1.0.int8.sherpa.onnx";
  const kokoroVoices = process.env.KOKORO_VOICES || "E:\\Finch\\voices\\kokoro\\voices.bin";
  const kokoroTokens = process.env.KOKORO_TOKENS || "E:\\Finch\\voices\\kokoro\\tokens.txt";
  // sherpa's espeak phonemizer reuses the espeak-ng-data already next to Piper.
  const kokoroEspeakData = process.env.KOKORO_ESPEAK_DATA || "E:\\Finch\\voices\\piper\\piper\\espeak-ng-data";
  const kokoroVoice = process.env.KOKORO_VOICE || "am_santa";
  // Kitten TTS nano (KittenML) through sherpa-onnx. The .sherpa.onnx build
  // and voices.bin come from the k2-fsa tts-models package (they carry the
  // ONNX metadata sherpa requires); tokens.txt ships with it too. The raw
  // Hugging Face files (kitten_tts_nano_v0_8.onnx, voices.npz) are kept next
  // to them but unused. Default voice "Jasper" is sid 0 in voices.bin.
  const kittenModel = process.env.KITTEN_MODEL || "E:\\Finch\\voices\\kitten\\kitten_tts_nano_v0_8.sherpa.onnx";
  const kittenVoices = process.env.KITTEN_VOICES || "E:\\Finch\\voices\\kitten\\voices.bin";
  const kittenTokens = process.env.KITTEN_TOKENS || "E:\\Finch\\voices\\kitten\\tokens.txt";
  const kittenVoice = process.env.KITTEN_VOICE || "Jasper";

  return {
    PORT: port,
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    DB_PATH: dbPath,
    OLLAMA_URL: ollamaUrl,
    CORS_ORIGIN: corsOrigin,
    WHISPER_EXE: whisperExe,
    WHISPER_MODEL: whisperModel,
    WHISPER_WAKE_MODEL: whisperWakeModel,
    PIPER_EXE: piperExe,
    PIPER_VOICE: piperVoice,
    TTS_ENGINE: ttsEngine,
    AI_STREAM: aiStream,
    VOICE_PIPELINE_MODE: voicePipelineMode,
    KOKORO_MODEL: kokoroModel,
    KOKORO_VOICES: kokoroVoices,
    KOKORO_TOKENS: kokoroTokens,
    KOKORO_ESPEAK_DATA: kokoroEspeakData,
    KOKORO_VOICE: kokoroVoice,
    KITTEN_MODEL: kittenModel,
    KITTEN_VOICES: kittenVoices,
    KITTEN_TOKENS: kittenTokens,
    KITTEN_VOICE: kittenVoice,
  };
}

export const env = parseEnv();