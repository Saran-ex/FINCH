import { db } from "../../db/client.js";
import type { Mode } from "../../config/constants.js";
import type { Message, MessageRole } from "../../types/memory.js";

type Row = {
  id: number;
  conversation_id: number;
  role: string;
  mode: string;
  content: string;
  model_alias: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
};

function toMessage(r: Row): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as MessageRole,
    mode: r.mode as Mode,
    content: r.content,
    modelAlias: r.model_alias,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    createdAt: r.created_at,
  };
}

export type InsertMessageInput = {
  conversationId: number;
  role: MessageRole;
  mode: Mode;
  content: string;
  modelAlias?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
};

export function insertMessage(input: InsertMessageInput): Message {
  const info = db.prepare(
    `INSERT INTO messages
       (conversation_id, role, mode, content, model_alias, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.conversationId,
    input.role,
    input.mode,
    input.content,
    input.modelAlias ?? null,
    input.tokensIn ?? null,
    input.tokensOut ?? null
  );

  const row = db.prepare(
    "SELECT * FROM messages WHERE id = ?"
  ).get(info.lastInsertRowid) as Row;

  return toMessage(row);
}

export function getRecentMessages(
  conversationId: number,
  limit = 10
): Message[] {
  const rows = db.prepare(
    `SELECT * FROM messages
     WHERE conversation_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ).all(conversationId, limit) as Row[];

  return rows.map(toMessage).reverse();
}

export function countMessages(conversationId: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM messages WHERE conversation_id = ?"
  ).get(conversationId) as { n: number };
  return row.n;
}