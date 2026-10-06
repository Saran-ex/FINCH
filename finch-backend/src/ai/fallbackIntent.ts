import type { Mode } from "../config/constants.js";
import type { ValidatedIntent } from "./responseValidator.js";

export function fallbackIntent(
  transcript: string,
  currentMode: Mode,
  source: "qwen" | "fallback" = "fallback"
): ValidatedIntent {
  const defaultReplies: Record<Mode, string> = {
    conversation: "I'm having trouble connecting right now. How can I help you in conversation mode?",
    plan: "I'm having trouble connecting right now. What would you like to plan?",
    search: "I'm having trouble connecting right now. What are you looking for?",
    research: "I'm having trouble connecting right now. What topic should I investigate?",
  };

  return {
    action: "answer",
    mode: currentMode,
    request: transcript,
    reply: defaultReplies[currentMode],
    source,
  };
}