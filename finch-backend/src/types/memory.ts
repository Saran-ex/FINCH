import type { Mode } from "../config/constants.js";

export type MessageRole = "user" | "finch";

export type Conversation = {
  id: number;
  title: string | null;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export type Message = {
  id: number;
  conversationId: number;
  role: MessageRole;
  mode: Mode;
  content: string;
  modelAlias: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
};

export type Fact = {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Summary = {
  id: number;
  periodStart: string;
  periodEnd: string;
  scope: string;
  mode: Mode | null;
  summaryText: string;
  sourceMsgCount: number;
  modelAlias: string;
  createdAt: string;
};
