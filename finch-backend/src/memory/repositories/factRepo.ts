import { db } from "../../db/client.js";
import type { Fact } from "../../types/memory.js";

type Row = {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  created_at: string;
  updated_at: string;
};

function toFact(r: Row): Fact {
  return {
    id: r.id,
    category: r.category,
    key: r.key,
    value: r.value,
    confidence: r.confidence,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getTopFacts(limit = 15): Fact[] {
  const rows = db
    .prepare(
      `SELECT * FROM memory_facts
     ORDER BY confidence DESC, updated_at DESC
     LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map(toFact);
}
