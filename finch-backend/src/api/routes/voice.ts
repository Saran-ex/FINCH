import { Router, raw } from "express";
import type { Request, Response } from "express";
import { getVoiceHealth, synthesizeSpeech, transcribeWav } from "@/services/voice.js";
import { ValidationError } from "@/services/errors.js";
import { logger, timingLine } from "@/services/logger.js";

const router = Router();

// 30s of 16 kHz mono 16-bit WAV is ~1 MB; 4mb gives comfortable headroom
// while still bounding request size. Scoped to this route only.
const TRANSCRIBE_BODY_LIMIT = "4mb";

// Shared voice-turn id: the frontend sends the same value on transcribe,
// /api/turn and speak so every log line of one voice turn can be matched.
function voiceTurnId(req: Request): string {
  const header = req.headers["x-voice-turn-id"];
  return typeof header === "string" && header.length > 0 ? header : "-";
}

// Milliseconds from request arrival (stamped in app.ts before body parsing)
// to now — i.e. upload + body parse time.
function uploadMs(res: Response): number {
  const receivedAt = res.locals.receivedAt;
  return Date.now() - (typeof receivedAt === "number" ? receivedAt : Date.now());
}

// Turn ids whose first /speak response already logged stage=first-audio-after-text.
// Streaming sends one speak request per chunk; only the first chunk per turn is
// the "first audio after text" measurement. "-" (no turn id) is never deduped —
// ad-hoc curl measurements arrive without the header.
const firstAudioSeen = new Set<string>();
function logFirstAudioAfterText(turn: string, engine: string, res: Response): void {
  if (turn !== "-" && firstAudioSeen.has(turn)) return;
  if (turn !== "-") {
    firstAudioSeen.add(turn);
    // Bound the set: keep the newest ~250 ids when it grows past 500.
    if (firstAudioSeen.size > 500) {
      const oldest = firstAudioSeen.values();
      for (let i = 0; i < 250; i++) firstAudioSeen.delete(oldest.next().value as string);
    }
  }
  const receivedAt = res.locals.receivedAt;
  const ms = Date.now() - (typeof receivedAt === "number" ? receivedAt : Date.now());
  logger.info(timingLine(turn, "first-audio-after-text", ms, `engine=${engine}`));
}

router.post("/transcribe", raw({ type: () => true, limit: TRANSCRIBE_BODY_LIMIT }), async (req, res, next) => {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const turn = voiceTurnId(req);
    logger.info(timingLine(turn, "transcribe-upload", uploadMs(res), `bytes=${body.length}`));

    const whisperStart = Date.now();
    // wk- ids are background wake-word segment checks: they use the fast
    // base model. Everything else (manual mic, finished wake captures) is a
    // real turn and gets the accurate small model.
    const kind = turn.startsWith("wk-") ? "wake" : "real";
    const text = await transcribeWav(body, kind);
    // Manual measurement #1: whisper duration (stage=transcribe-done). The
    // caller times speech-end → transcript-received with a stopwatch; this
    // line isolates the whisper cost inside that window.
    logger.info(timingLine(turn, "transcribe-done", Date.now() - whisperStart, `chars=${text.length}`));

    res.json({ text });
  } catch (err) {
    next(err);
  }
});

router.post("/speak", async (req, res, next) => {
  try {
    const body = req.body as { text?: unknown; engine?: unknown } | undefined;
    if (!body || typeof body.text !== "string") {
      throw new ValidationError("'text' must be a string");
    }
    // Optional per-request engine (conversation voice-engine picker). Absent
    // means "use the configured default" — the pre-picker behaviour.
    let engine: "kokoro" | "piper" | "kitten" | undefined;
    if (body.engine !== undefined) {
      if (body.engine !== "kokoro" && body.engine !== "piper" && body.engine !== "kitten") {
        throw new ValidationError("'engine' must be 'kokoro', 'piper' or 'kitten'");
      }
      engine = body.engine;
    }
    const turn = voiceTurnId(req);
    logger.info(timingLine(turn, "speak-upload", uploadMs(res), `chars=${body.text.length}`));

    const ttsStart = Date.now();
    const { wav, engine: usedEngine, fallbackReason } = await synthesizeSpeech(body.text, engine);
    logger.info(timingLine(turn, "tts", Date.now() - ttsStart, `engine=${usedEngine} bytes=${wav.length}`));
    if (fallbackReason) {
      // Configured engine failed; Piper produced this audio instead.
      const reason = fallbackReason.replace(/\s+/g, "_").slice(0, 200);
      logger.warn(timingLine(turn, "tts-fallback", Date.now() - ttsStart, `engine=piper reason=${reason}`));
    }
    // Manual measurements #3/#4: first audio bytes ready after the text was
    // known. ms runs from the /speak request arrival (receivedAt in app.ts);
    // first speak per turn only — later chunks are covered by stage=tts above.
    logFirstAudioAfterText(turn, usedEngine, res);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(wav.length));
    res.status(200).end(wav);
  } catch (err) {
    next(err);
  }
});

router.get("/health", async (_req, res, next) => {
  try {
    res.json(await getVoiceHealth());
  } catch (err) {
    next(err);
  }
});

export default router;
