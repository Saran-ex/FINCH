import { db } from "../../db/client.js";
import type { Mode } from "../../config/constants.js";
import type { Conversation } from "../../types/memory.js";

type Row = {
  id: number;
  title: string | null;
  mode: string;
  created_at: string;
  updated_at: string;
  archived: number;
};

function toConversation(r: Row): Conversation {
  return {
    id: r.id,
    title: r.title,
    mode: r.mode as Mode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.archived === 1,
  };
}

export function createConversation(
  mode: Mode,
  title: string | null = null,
): Conversation {
  const info = db
    .prepare("INSERT INTO conversations (title, mode) VALUES (?, ?)")
    .run(title, mode);

  const row = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(info.lastInsertRowid) as Row;

  return toConversation(row);
}

export function findLatestActiveByMode(mode: Mode): Conversation | null {
  const row = db
    .prepare(
      `SELECT * FROM conversations
     WHERE mode = ? AND archived = 0
     ORDER BY updated_at DESC
     LIMIT 1`,
    )
    .get(mode) as Row | undefined;

  return row ? toConversation(row) : null;
}

export function touchConversation(id: number): void {
  db.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

export function updateConversationTitle(id: number, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}
