import { db } from "../../db/client.js";

type SelectMessageResult = Array<{
  mode: string;
  conversations: Array<{
    conversation_id: number;
    messages: Array<{
      id: number;
      role: string;
      content: string;
      mode: string;
      created_at: string;
      conversation_id: number;
    }>;
  }>;
}>;

export function selectMessages(days: 7 | 30): SelectMessageResult {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

  const coveredRows = db.prepare(`
    SELECT json_each.value as msg_id
    FROM memory_entries, json_each(source_message_ids)
    WHERE json_valid(source_message_ids)
    AND json_type(source_message_ids) = 'array'
  `).all() as Array<{ msg_id: number }>;

  const coveredIds = new Set(coveredRows.map((r) => r.msg_id));

  const placeholders = ["conversation", "plan", "search", "research"].map(() => "?").join(",");
  const allMessages = db.prepare(`
    SELECT id, role, content, mode, created_at, conversation_id
    FROM messages
    WHERE mode IN (${placeholders})
      AND date(created_at) >= date(?)
      AND id NOT IN (
        SELECT json_each.value
        FROM memory_entries, json_each(source_message_ids)
        WHERE json_valid(source_message_ids)
          AND json_type(source_message_ids) = 'array'
      )
    ORDER BY mode, conversation_id, created_at
  `).all("conversation", "plan", "search", "research", cutoffDateStr) as Array<{
    id: number;
    role: string;
    content: string;
    mode: string;
    created_at: string;
    conversation_id: number;
  }>;

  const grouped: Map<string, Map<number, Array<{
    id: number;
    role: string;
    content: string;
    mode: string;
    created_at: string;
    conversation_id: number;
  }>>> = new Map();

  for (const msg of allMessages) {
    if (!coveredIds.has(msg.id)) {
      if (!grouped.has(msg.mode)) {
        grouped.set(msg.mode, new Map());
      }
      const modeMap = grouped.get(msg.mode)!;
      if (!modeMap.has(msg.conversation_id)) {
        modeMap.set(msg.conversation_id, []);
      }
      modeMap.get(msg.conversation_id)!.push({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        mode: msg.mode,
        created_at: msg.created_at,
        conversation_id: msg.conversation_id,
      });
    }
  }

  const result: Array<{
    mode: string;
    conversations: Array<{
      conversation_id: number;
      messages: Array<{
        id: number;
        role: string;
        content: string;
        mode: string;
        created_at: string;
        conversation_id: number;
      }>;
    }>;
  }> = [];

  for (const [mode, conversations] of grouped.entries()) {
    const conversationsArray = Array.from(conversations.entries()).map(
      ([conversation_id, messages]) => ({
        conversation_id,
        messages,
      })
    );
    result.push({ mode, conversations: conversationsArray });
  }

  return result;
}