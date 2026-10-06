import { config } from "../config/index.js";
import { logger } from "../services/logger.js";
import type { ModelAdapter, StreamDeltaHandler } from "./adapter.js";
import type { GenerateOptions, GenerateResult } from "../types/model.js";
import { ModelUnavailableError, ModelTimeoutError, ModelResponseError } from "./errors.js";
import { getModeConfig } from "../config/modeConfig.js";
import type { Mode } from "../config/constants.js";

const TIMEOUT_MS = 240_000;
const RESEARCH_TIMEOUT_MS = 420_000;
const UNLOAD_TIMEOUT_MS = 5_000;

interface OllamaGenerateOptions extends GenerateOptions {
  mode?: Mode;
}

// One NDJSON line of Ollama's streamed /api/generate response.
type OllamaStreamChunk = {
  response?: string;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  // Q2 diagnostic: Ollama's own stage timings (nanoseconds), present on the
  // final done chunk. Captured for logging only — never used to alter requests.
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  total_duration?: number;
};

function parseStreamChunk(line: string): OllamaStreamChunk | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as OllamaStreamChunk) : null;
  } catch {
    return null;
  }
}

class OllamaAdapter implements ModelAdapter {
  async generate(
    alias: string,
    ollamaModel: string,
    prompt: string,
    options: OllamaGenerateOptions
  ): Promise<GenerateResult> {
    // Use mode config if mode is provided, otherwise fall back to options
    const modeConfig = options.mode ? getModeConfig(options.mode) : null;
    
    const temperature = options.temperature ?? modeConfig?.temperature ?? 0.2;
    const numPredict = options.maxTokens ?? modeConfig?.numPredict ?? 512;
    const useJson = options.format === "json";
    const numCtx = modeConfig?.numCtx ?? 4096;

    const body: Record<string, unknown> = {
      model: ollamaModel,
      prompt,
      stream: false,
      // Universal no-thinking switch: Ollama's top-level `think` option (verified on
      // Ollama 0.35.0 for every installed model). Applies to all modes and all models,
      // including any model added later, so reasoning models never leak thought text.
      think: false,
      options: {
        temperature,
        num_predict: numPredict,
        num_ctx: numCtx,
      },
    };
    
    if (useJson) {
      body.format = "json";
    }
    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    logger.debug("ollama request body", { body });

    const controller = new AbortController();
    const timeoutMs = options.mode === "research" ? RESEARCH_TIMEOUT_MS : TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Caller-supplied abort (e.g. the HTTP client disconnected): abort the
    // Ollama request too so we stop burning tokens for nobody.
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      logger.debug("ollama fetch sending", { model: ollamaModel, mode: options.mode, at: new Date().toISOString() });
      const res = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      logger.debug("ollama fetch returned", { model: ollamaModel, status: res.status, at: new Date().toISOString() });

      if (!res.ok) {
        throw new ModelUnavailableError(alias, `HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        response?: string;
        prompt_eval_count?: number;
        eval_count?: number;
        done_reason?: string;
      };

      logger.debug("ollama raw response", { json });

      // Log warning if response was truncated due to length
      if (json.done_reason === "length") {
        logger.warn("ollama response truncated", { 
          alias, 
          model: ollamaModel,
          tokensOut: json.eval_count 
        });
      }

      if (typeof json.response !== "string") {
        throw new ModelResponseError(alias, "missing 'response' field");
      }

      logger.debug("ollama generate ok", {
        alias,
        tokensIn: json.prompt_eval_count ?? 0,
        tokensOut: json.eval_count ?? 0,
      });

      logger.debug("ollama generate complete", { model: ollamaModel, mode: options.mode, evalCount: json.eval_count, at: new Date().toISOString() });

      return {
        text: json.response,
        tokensIn: json.prompt_eval_count ?? 0,
        tokensOut: json.eval_count ?? 0,
        modelAlias: alias,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Caller aborted (client gone) — propagate the raw abort so callers can
        // tell it apart from our own idle timeout.
        if (options.signal?.aborted) throw err;
        throw new ModelTimeoutError(alias);
      }
      if (err instanceof Error && err.message.startsWith("Model")) {
        throw err;
      }
      throw new ModelUnavailableError(alias, err);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  // Streams the reply token-by-token from Ollama (stream:true, NDJSON lines).
  // Plain text only — no JSON format — so deltas can be forwarded as-is.
  // onDelta returning false stops generation early (reply cap, client gone).
  // Early stop is a NORMAL return with the text accumulated so far; only
  // real transport/model failures become errors.
  async generateStream(
    alias: string,
    ollamaModel: string,
    prompt: string,
    options: OllamaGenerateOptions,
    onDelta: StreamDeltaHandler
  ): Promise<GenerateResult> {
    const modeConfig = options.mode ? getModeConfig(options.mode) : null;
    const temperature = options.temperature ?? modeConfig?.temperature ?? 0.2;
    const numPredict = options.maxTokens ?? modeConfig?.numPredict ?? 512;
    const useJson = options.format === "json";
    const numCtx = modeConfig?.numCtx ?? 4096;

    const body: Record<string, unknown> = {
      model: ollamaModel,
      prompt,
      stream: true,
      think: false,
      // Q1 experiment: keep the conversation model resident 30m instead of
      // Ollama's default 5m, to avoid cold starts after short idle gaps.
      keep_alive: "30m",
      options: {
        temperature,
        num_predict: numPredict,
        num_ctx: numCtx,
      },
    };
    if (useJson) body.format = "json";
    if (options.systemPrompt) body.system = options.systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let text = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let doneReason: string | undefined;
    let stoppedEarly = false;
    // Q2 diagnostic: Ollama stage timings (nanoseconds) from the done chunk.
    let loadDurationNs = 0;
    let promptEvalDurationNs = 0;
    let evalDurationNs = 0;
    let totalDurationNs = 0;

    const handleChunk = (chunk: OllamaStreamChunk): boolean => {
      if (typeof chunk.prompt_eval_count === "number") tokensIn = chunk.prompt_eval_count;
      if (typeof chunk.eval_count === "number") tokensOut = chunk.eval_count;
      if (typeof chunk.done_reason === "string") doneReason = chunk.done_reason;
      if (typeof chunk.load_duration === "number") loadDurationNs = chunk.load_duration;
      if (typeof chunk.prompt_eval_duration === "number") promptEvalDurationNs = chunk.prompt_eval_duration;
      if (typeof chunk.eval_duration === "number") evalDurationNs = chunk.eval_duration;
      if (typeof chunk.total_duration === "number") totalDurationNs = chunk.total_duration;
      if (typeof chunk.response === "string" && chunk.response.length > 0) {
        text += chunk.response;
        if (onDelta(chunk.response, text) === false) return false;
      }
      return true;
    };

    try {
      const res = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new ModelUnavailableError(alias, `HTTP ${res.status}`);
      if (!res.body) throw new ModelResponseError(alias, "missing response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";

      readLoop: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        for (let idx = buffered.indexOf("\n"); idx !== -1; idx = buffered.indexOf("\n")) {
          const line = buffered.slice(0, idx).trim();
          buffered = buffered.slice(idx + 1);
          if (line.length === 0) continue;
          const chunk = parseStreamChunk(line);
          if (!chunk) continue;
          if (!handleChunk(chunk)) {
            stoppedEarly = true;
            controller.abort();
            try {
              await reader.cancel();
            } catch {
              // reader already dead — nothing to clean up
            }
            break readLoop;
          }
        }
      }

      // Trailing line without a final newline (defensive: some proxies strip it)
      if (!stoppedEarly && buffered.trim().length > 0) {
        const chunk = parseStreamChunk(buffered.trim());
        if (chunk) handleChunk(chunk);
      }

      if (doneReason === "length") {
        logger.warn("ollama stream truncated", { alias, model: ollamaModel, tokensOut });
      }
      logger.debug("ollama stream complete", {
        alias,
        model: ollamaModel,
        mode: options.mode,
        evalCount: tokensOut,
        stoppedEarly,
        chars: text.length,
      });
      // Q2 diagnostic: Ollama's own stage timings for this warm/cold request,
      // logged at info so measurements are visible without a log-level change.
      logger.info("timing: ollama stream stages", {
        model: ollamaModel,
        mode: options.mode,
        loadMs: Math.round(loadDurationNs / 1e6),
        promptEvalMs: Math.round(promptEvalDurationNs / 1e6),
        promptTokens: tokensIn,
        genMs: Math.round(evalDurationNs / 1e6),
        genTokens: tokensOut,
        totalMs: Math.round(totalDurationNs / 1e6),
        stoppedEarly,
      });

      return { text, tokensIn, tokensOut, modelAlias: alias };
    } catch (err) {
      // Early stop aborts the fetch on purpose; the partial text is valid.
      if (stoppedEarly) {
        return { text, tokensIn, tokensOut, modelAlias: alias };
      }
      if (err instanceof Error && err.name === "AbortError") {
        if (options.signal?.aborted) throw err;
        throw new ModelTimeoutError(alias);
      }
      if (err instanceof Error && err.message.startsWith("Model")) {
        throw err;
      }
      throw new ModelUnavailableError(alias, err);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  // Ask Ollama to unload the given model from memory on its next idle moment.
  // Never throws: a failed unload must never block a research turn.
  async unload(model: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UNLOAD_TIMEOUT_MS);
      try {
        await fetch(`${config.ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: "", keep_alive: 0 }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      logger.debug("ollama unload ok", { model });
    } catch (err) {
      logger.debug("ollama unload failed", { model, err });
    }
  }

  async ping(ollamaModel: string): Promise<boolean> {
    try {
      const res = await fetch(`${config.ollamaUrl}/api/tags`);
      if (!res.ok) return false;
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return !!json.models?.some((m) => m.name === ollamaModel);
    } catch {
      return false;
    }
  }
}

export const ollamaAdapter = new OllamaAdapter();