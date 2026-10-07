import type { Mode } from "../config/constants.js";
import type { Conversation } from "../types/memory.js";
import {
  createConversation,
  findLatestActiveByMode,
  touchConversation,
  updateConversationTitle,
} from "./repositories/conversationRepo.js";
import { countMessages } from "./repositories/messageRepo.js";
import { logger } from "../services/logger.js";

export function getOrCreateActiveConversation(mode: Mode): Conversation {
  const existing = findLatestActiveByMode(mode);
  if (existing) return existing;

  const conv = createConversation(mode);
  logger.info("created new conversation", { id: conv.id, mode });
  return conv;
}

export function recordActivity(conversationId: number): void {
  touchConversation(conversationId);
}

export function maybeSetTitleFromFirstMessage(
  conversationId: number,
  firstMessageText: string,
): void {
  const count = countMessages(conversationId);
  if (count > 0) return;

  const trimmed = firstMessageText.trim();
  if (!trimmed) return;

  const title = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
  updateConversationTitle(conversationId, title);
}
