import type { Mode } from "../config/constants.js";
import type { Message } from "../types/memory.js";
import { insertMessage } from "./repositories/messageRepo.js";
import { recordActivity } from "./conversationService.js";
import { logger } from "../services/logger.js";

export type AddTurnInput = {
  conversationId: number;
  mode: Mode;
  userText: string;
  finchText: string;
  modelAlias: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

export function addTurn(input: AddTurnInput): { user: Message; finch: Message } {
  const user = insertMessage({
    conversationId: input.conversationId,
    role: "user",
    mode: input.mode,
    content: input.userText,
    modelAlias: null,
    tokensIn: null,
    tokensOut: null,
  });

  const finch = insertMessage({
    conversationId: input.conversationId,
    role: "finch",
    mode: input.mode,
    content: input.finchText,
    modelAlias: input.modelAlias,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
  });

  recordActivity(input.conversationId);

  logger.debug("stored turn", {
    conversationId: input.conversationId,
    userMsgId: user.id,
    finchMsgId: finch.id,
  });

  return { user, finch };
}