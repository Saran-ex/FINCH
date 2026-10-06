import type { Mode } from "../config/constants.js";

// Result shape shared by every turn path. Intent generation was removed, so
// `action` is always "answer" and `request` is always "" (kept in the wire
// shape for existing clients); mode switching happens via keyboard shortcut.
export type ValidatedIntent = {
  action: "answer";
  mode: Mode;
  request: string;
  reply: string;
  source: "qwen" | "fallback";
  conversationId?: number;
};

export const MAX_REPLY_LENGTH = 1500;
