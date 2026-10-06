import { Router } from "express";
import { processTurn, processTurnStream, type TurnInput, type TurnResult } from "../../ai/turnService.js";
import { validateTurnRequest } from "../schemas/turnSchema.js";
import { logger, timingLine } from "../../services/logger.js";
import { config } from "../../config/index.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const input = validateTurnRequest(req.body);

    const header = req.headers["x-voice-turn-id"];
    const voiceTurn = typeof header === "string" && header.length > 0 ? header : "-";
    const turnStart = Date.now();
    const result = await processTurn(input);
    logger.info(timingLine(voiceTurn, "ai-reply", Date.now() - turnStart));

    logger.info("turn: done", {
      action: result.action,
      mode: result.mode,
      source: result.source,
      requestId: req.id,
    });

    res.json({
      action: result.action,
      mode: result.mode,
      request: result.request,
      reply: result.reply,
      source: result.source,
      conversationId: result.conversationId,
      webSources: result.webSources,
      searchSource: result.searchSource,
      topicCards: result.topicCards,
      directions: result.directions,
    });
  } catch (err) {
    next(err);
  }
});

// Streaming turn. Response is an NDJSON stream (one JSON event per line,
// flushed as it is written):
//   {"type":"delta","text":"..."}   reply fragment, in order
//   {"type":"end"}                  reply text complete
//   {"type":"done", ...}            full TurnResult payload (same shape as POST /)
//   {"type":"error","message":"...} terminal failure
// Invariant: everything that should be spoken arrives as deltas before "done"
// — if the model produced nothing, the fallback reply is emitted as a final
// delta — so clients can treat the concatenation of deltas as the reply.
// VOICE_PIPELINE_MODE=sequential additionally stamps delta/end events with
// "pipeline":"sequential": the reply then arrives as ONE delta and the client
// must hold speech until "done" and send a single full-text TTS request.
// Streaming mode emits no pipeline field, so existing clients are untouched.
router.post("/stream", async (req, res, next) => {
  let input: TurnInput;
  try {
    input = validateTurnRequest(req.body);
  } catch (err) {
    // Nothing streamed yet: produce a normal JSON error response.
    next(err);
    return;
  }

  const header = req.headers["x-voice-turn-id"];
  const voiceTurn = typeof header === "string" && header.length > 0 ? header : "-";
  const turnStart = Date.now();

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Disconnect detection: "close" also fires after a normal end, so only treat
  // it as a client abort when the response was never fully written.
  let clientClosed = false;
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      clientClosed = true;
      abort.abort();
    }
  });

  let deltaCount = 0;
  // Stamped on delta/end only in sequential mode (absent in streaming mode).
  const pipelineField =
    config.voicePipelineMode === "sequential" ? { pipeline: config.voicePipelineMode } : {};
  const write = (payload: Record<string, unknown>): void => {
    if (clientClosed || res.destroyed || res.writableEnded) return;
    try {
      res.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      logger.debug("turn: stream write failed", { err });
    }
  };
  const emitDelta = (text: string): void => {
    deltaCount += 1;
    write({ type: "delta", text, ...pipelineField });
  };

  try {
    let result: TurnResult;
    if (config.aiStream) {
      result = await processTurnStream(
        input,
        (delta) => {
          if (deltaCount === 0) {
            // First token from Qwen (manual measurement #2: transcript ready → first token).
            logger.info(timingLine(voiceTurn, "first-token", Date.now() - turnStart));
          }
          emitDelta(delta);
          // Returning false stops Ollama as soon as the client is gone.
          return !clientClosed;
        },
        abort.signal,
        () => {
          // Reply text complete: the client can flush its speech buffer now
          // instead of waiting for "done".
          logger.info(timingLine(voiceTurn, "ai-stream-complete", Date.now() - turnStart));
          write({ type: "end", ...pipelineField });
        }
      );
    } else {
      // AI_STREAM=0: old single-shot behaviour carried over the same envelope,
      // so the client keeps a single code path either way.
      result = await processTurn(input);
      if (result.reply) {
        // Same measurement stage as the streaming path (reply = one "token").
        logger.info(timingLine(voiceTurn, "first-token", Date.now() - turnStart));
        emitDelta(result.reply);
      }
      logger.info(timingLine(voiceTurn, "ai-stream-complete", Date.now() - turnStart));
      write({ type: "end", ...pipelineField });
    }

    const aiMs = Date.now() - turnStart;
    logger.info(timingLine(voiceTurn, "ai-reply", aiMs));
    logger.info("turn: done", {
      action: result.action,
      mode: result.mode,
      source: result.source,
      requestId: req.id,
    });

    // No deltas means the model produced nothing usable (full fallback):
    // hand the client the final reply so speech still happens.
    if (deltaCount === 0 && result.reply) emitDelta(result.reply);

    write({
      type: "done",
      action: result.action,
      mode: result.mode,
      request: result.request,
      reply: result.reply,
      source: result.source,
      conversationId: result.conversationId,
      webSources: result.webSources,
      searchSource: result.searchSource,
      topicCards: result.topicCards,
      directions: result.directions,
    });
  } catch (err) {
    if (clientClosed) {
      logger.debug("turn: stream aborted (client closed)", { requestId: req.id });
    } else {
      logger.error("turn: stream failed", { err, requestId: req.id });
      write({ type: "error", message: err instanceof Error ? err.message : "turn failed" });
    }
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
  }
});

export default router;
