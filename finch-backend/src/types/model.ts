export type GenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  format?: "json" | null;
  systemPrompt?: string;
  mode?: "conversation" | "plan" | "search" | "research";
  // Optional early-stop for streaming: the adapter stops consuming (and
  // aborts the Ollama request) when onDelta returns false.
  signal?: AbortSignal;
};

export type GenerateResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  modelAlias: string;
};
