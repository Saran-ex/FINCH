import { db } from "../../db/client.js";
import type { Mode } from "../../config/constants.js";
import type { Summary } from "../../types/memory.js";

type Row = {
  id: number;
  period_start: string;
  period_end: string;
  scope: string;
  mode: string | null;
  summary_text: string;
  source_msg_count: number;
  model_alias: string;
  created_at: string;
};

function toSummary(r: Row): Summary {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    scope: r.scope,
    mode: r.mode as Mode | null,
    summaryText: r.summary_text,
    sourceMsgCount: r.source_msg_count,
    modelAlias: r.model_alias,
    createdAt: r.created_at,
  };
}

export function getLatestSummaryForMode(mode: Mode): Summary | null {
  const row = db
    .prepare(
      `SELECT * FROM summaries
     WHERE mode = ? OR mode IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    )
    .get(mode) as Row | undefined;
  return row ? toSummary(row) : null;
}
