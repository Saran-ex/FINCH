import { db } from "../db/client.js";
import { logger } from "./logger.js";

export type TurnResultPayload = {
  webSources?: unknown[];
  topicCards?: unknown[];
  directions?: unknown[];
  searchSource?: string | null;
  researchPath?: string[];
};

export function saveTurnResult(input: {
  conversationId: number;
  mode: "search" | "research";
  request: string;
  reply: string;
  payload: TurnResultPayload;
}): void {
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(input.payload);
  } catch (err) {
    logger.warn("turn results: failed to serialize payload", {
      err: err instanceof Error ? err.message : String(err),
    });
    payloadJson = "{}";
  }

  try {
    db.prepare(
      "INSERT INTO turn_results (conversation_id, mode, request, reply, payload) VALUES (?, ?, ?, ?, ?)",
    ).run(
      input.conversationId,
      input.mode,
      input.request,
      input.reply,
      payloadJson,
    );
  } catch (err) {
    logger.warn("turn results: failed to save turn result", {
      mode: input.mode,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getMostRecentTurnResult(
  mode: "search" | "research",
  hoursBack: number,
): {
  request: string;
  reply: string;
  payload: TurnResultPayload;
  createdAt: string;
  conversationId: number;
} | null {
  try {
    const row = db
      .prepare(
        `SELECT request, reply, payload, created_at, conversation_id
           FROM turn_results
          WHERE mode = ? AND created_at > datetime('now', ?)
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get(mode, `-${hoursBack} hours`) as
      | {
          request: string;
          reply: string;
          payload: string;
          created_at: string;
          conversation_id: number;
        }
      | undefined;

    if (!row) return null;

    let payload: TurnResultPayload;
    try {
      payload = JSON.parse(row.payload) as TurnResultPayload;
    } catch {
      payload = {};
    }

    return {
      request: row.request,
      reply: row.reply,
      payload,
      createdAt: row.created_at,
      conversationId: row.conversation_id,
    };
  } catch (err) {
    logger.warn("turn results: failed to load recent turn result", {
      mode,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type TurnResultRow = {
  id: number;
  conversationId: number;
  mode: "search" | "research";
  request: string;
  reply: string;
  payload: TurnResultPayload;
  createdAt: string;
};

export function listTurnResultsInRange(
  fromIso: string,
  toIso: string,
): TurnResultRow[] {
  try {
    const rows = db
      .prepare(
        `SELECT id, conversation_id, mode, request, reply, payload, created_at
           FROM turn_results
          WHERE created_at > datetime(?) AND created_at <= datetime(?)
          ORDER BY created_at ASC`,
      )
      .all(fromIso, toIso) as Array<{
      id: number;
      conversation_id: number;
      mode: string;
      request: string;
      reply: string;
      payload: string;
      created_at: string;
    }>;

    const results: TurnResultRow[] = [];
    for (const row of rows) {
      let payload: TurnResultPayload;
      try {
        payload = JSON.parse(row.payload) as TurnResultPayload;
      } catch {
        // One corrupt payload must not break the whole list.
        payload = {};
      }
      results.push({
        id: row.id,
        conversationId: row.conversation_id,
        mode: row.mode as "search" | "research",
        request: row.request,
        reply: row.reply,
        payload,
        createdAt: row.created_at,
      });
    }
    return results;
  } catch (err) {
    logger.warn("turn results: failed to list turn results in range", {
      fromIso,
      toIso,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export type CompactTurn = {
  mode: "search" | "research";
  request: string;
  createdAt: string;
  direction: string | null;
  topSources: Array<{ title: string; domain: string }>;
  topCards: string[];
  directionCards: string[];
  directionsOnly: boolean;
};

const COMPACT_REQUEST_MAX = 300;

function truncateRequest(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length > COMPACT_REQUEST_MAX
    ? `${text.slice(0, COMPACT_REQUEST_MAX)}…`
    : text;
}

function readHeadline(card: unknown): string | null {
  if (card === null || typeof card !== "object") return null;
  const headline = (card as { headline?: unknown }).headline;
  if (typeof headline !== "string" || headline.trim().length === 0) return null;
  return headline;
}

export function projectTurnForSummary(row: TurnResultRow): CompactTurn {
  try {
    const payload = row.payload ?? {};

    const request = truncateRequest(row.request);

    const path = payload.researchPath;
    const direction =
      Array.isArray(path) && path.length > 0 && typeof path[0] === "string"
        ? path[0]
        : null;

    const webSources = Array.isArray(payload.webSources)
      ? payload.webSources
      : [];
    const topSources: Array<{ title: string; domain: string }> = [];
    for (const entry of webSources.slice(0, 3)) {
      if (entry === null || typeof entry !== "object") continue;
      const source = entry as { title?: unknown; domain?: unknown };
      if (typeof source.title !== "string" || typeof source.domain !== "string")
        continue;
      topSources.push({ title: source.title, domain: source.domain });
    }

    const topicCards = Array.isArray(payload.topicCards)
      ? payload.topicCards
      : [];
    const topCards: string[] = [];
    for (const card of topicCards.slice(0, 3)) {
      const headline = readHeadline(card);
      if (headline !== null) topCards.push(headline);
    }

    const directions = Array.isArray(payload.directions)
      ? payload.directions
      : [];
    const directionCards: string[] = [];
    for (const card of directions.slice(0, 5)) {
      const headline = readHeadline(card);
      if (headline !== null) directionCards.push(headline);
    }

    const directionsOnly = directions.length > 0 && topicCards.length === 0;

    return {
      mode: row.mode,
      request,
      createdAt: row.createdAt,
      direction,
      topSources,
      topCards,
      directionCards,
      directionsOnly,
    };
  } catch (err) {
    logger.warn("turn results: failed to project turn for summary", {
      id: row.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      mode: row.mode,
      request: truncateRequest(row.request),
      createdAt: row.createdAt,
      direction: null,
      topSources: [],
      topCards: [],
      directionCards: [],
      directionsOnly: false,
    };
  }
}
