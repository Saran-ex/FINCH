import type { GenerateOptions, GenerateResult } from "../types/model.js";

// Called for every streamed text fragment. `full` is the reply accumulated so
// far. Return false to stop generation early (e.g. reply length cap reached).
export type StreamDeltaHandler = (
  delta: string,
  full: string,
) => boolean | void;

export interface ModelAdapter {
  generate(
    alias: string,
    ollamaModel: string,
    prompt: string,
    options: GenerateOptions,
  ): Promise<GenerateResult>;

  // Optional: stream the reply as it is generated. Adapters without streaming
  // support simply omit it; callers fall back to a single-shot generate.
  generateStream?(
    alias: string,
    ollamaModel: string,
    prompt: string,
    options: GenerateOptions,
    onDelta: StreamDeltaHandler,
  ): Promise<GenerateResult>;

  ping(ollamaModel: string): Promise<boolean>;
}
