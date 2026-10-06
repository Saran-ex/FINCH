import { db } from '../../db/client.js';
import { summarizeBatch, summarizeTurnResults } from './summarize.js';
import type { FailedChunk, MemoryEntryDraft } from './summarize.js';

const DEFAULT_MODEL_ALIAS = 'finch-3';
const DELETE_CHUNK_SIZE = 500;

export class BatchNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchNotFoundError';
  }
}

export class BatchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchStateError';
  }
}

export interface BatchRow {
  id: number;
  days_range: number;
  period_start: string;
  period_end: string;
  status: 'pending' | 'confirmed' | 'discarded';
  source_msg_count: number;
  model_alias: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface MemoryEntryRow {
  id: number;
  batch_id: number;
  title: string;
  modes: string;
  date_start: string;
  date_end: string;
  summary_text: string;
  source_message_ids: string;
  created_at: string;
}

export interface CreatePendingBatchResult {
  batchId: number | null;
  entries: MemoryEntryDraft[];
  skippedIds: number[];
  failedChunks: FailedChunk[];
}

export interface PendingBatchPreview extends BatchRow {
  entries: MemoryEntryRow[];
}

export interface ConfirmResult {
  deletedTotal: number;
  deletedByMode: Record<string, number>;
}

export interface ConfirmedEntryRow {
  id: number;
  batch_id: number;
  title: string;
  modes: string;
  date_start: string;
  date_end: string;
  summary_text: string;
  confirmed_at: string | null;
}

function parseMessageIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function getBatch(batchId: number): BatchRow {
  const batch = db
    .prepare('SELECT * FROM memory_batches WHERE id = ?')
    .get(batchId) as BatchRow | undefined;
  if (!batch) {
    throw new BatchNotFoundError(`Batch ${batchId} not found`);
  }
  return batch;
}

function assertPending(batch: BatchRow): void {
  if (batch.status !== 'pending') {
    throw new BatchStateError(
      `Batch ${batch.id} is not pending (status: ${batch.status})`
    );
  }
}

export async function createPendingBatch(
  days: 7 | 30,
  modelAlias: string = DEFAULT_MODEL_ALIAS
): Promise<CreatePendingBatchResult> {
  const messagesPass = await summarizeBatch(days, modelAlias);
  const turnPass = await summarizeTurnResults(days, modelAlias);

  const entries: MemoryEntryDraft[] = [...messagesPass.entries, ...turnPass.entries];
  const skippedIds: number[] = messagesPass.skippedIds;
  const failedChunks: FailedChunk[] = [...messagesPass.failedChunks, ...turnPass.failedChunks];

  if (entries.length === 0) {
    return { batchId: null, entries, skippedIds, failedChunks };
  }

  const uniqueIds = new Set<number>();
  let periodStart = entries[0].date_start;
  let periodEnd = entries[0].date_end;

  for (const entry of entries) {
    for (const id of entry.source_message_ids) {
      uniqueIds.add(id);
    }
    if (entry.date_start < periodStart) {
      periodStart = entry.date_start;
    }
    if (entry.date_end > periodEnd) {
      periodEnd = entry.date_end;
    }
  }

  const insertBatch = db.prepare(
    `INSERT INTO memory_batches
       (days_range, period_start, period_end, status, source_msg_count, model_alias)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  );
  const insertEntry = db.prepare(
    `INSERT INTO memory_entries
       (batch_id, title, modes, date_start, date_end, summary_text, source_message_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction((): number => {
    const info = insertBatch.run(days, periodStart, periodEnd, uniqueIds.size, modelAlias);
    const batchId = Number(info.lastInsertRowid);
    for (const entry of entries) {
      insertEntry.run(
        batchId,
        entry.title,
        entry.mode,
        entry.date_start,
        entry.date_end,
        entry.summary_text,
        JSON.stringify(entry.source_message_ids)
      );
    }
    return batchId;
  });

  const batchId = run();
  return { batchId, entries, skippedIds, failedChunks };
}

export async function getPendingBatch(
  batchId: number
): Promise<PendingBatchPreview | null> {
  const batch = db
    .prepare('SELECT * FROM memory_batches WHERE id = ?')
    .get(batchId) as BatchRow | undefined;
  if (!batch || batch.status !== 'pending') {
    return null;
  }
  const entries = db
    .prepare('SELECT * FROM memory_entries WHERE batch_id = ? ORDER BY id ASC')
    .all(batchId) as MemoryEntryRow[];
  return { ...batch, entries };
}

export async function confirmBatch(batchId: number): Promise<ConfirmResult> {
  const batch = getBatch(batchId);
  assertPending(batch);

  const rows = db
    .prepare('SELECT modes, source_message_ids FROM memory_entries WHERE batch_id = ?')
    .all(batchId) as Array<{ modes: string; source_message_ids: string }>;

  const uniqueIds = new Set<number>();
  const idsByMode = new Map<string, Set<number>>();

  for (const row of rows) {
    const ids = parseMessageIds(row.source_message_ids);
    let modeSet = idsByMode.get(row.modes);
    if (!modeSet) {
      modeSet = new Set<number>();
      idsByMode.set(row.modes, modeSet);
    }
    for (const id of ids) {
      uniqueIds.add(id);
      modeSet.add(id);
    }
  }

  const allIds = Array.from(uniqueIds);
  const deletedByMode: Record<string, number> = {};
  for (const [mode, modeIds] of idsByMode) {
    deletedByMode[mode] = modeIds.size;
  }

  const run = db.transaction((): number => {
    for (let i = 0; i < allIds.length; i += DELETE_CHUNK_SIZE) {
      const group = allIds.slice(i, i + DELETE_CHUNK_SIZE);
      const placeholders = group.map(() => '?').join(',');
      db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...group);
    }
    db.prepare(
      `UPDATE memory_batches SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?`
    ).run(batchId);
    return allIds.length;
  });

  const deletedTotal = run();
  return { deletedTotal, deletedByMode };
}

export async function discardBatch(batchId: number): Promise<void> {
  const batch = getBatch(batchId);
  assertPending(batch);

  const run = db.transaction((): void => {
    db.prepare('DELETE FROM memory_entries WHERE batch_id = ?').run(batchId);
    db.prepare(`UPDATE memory_batches SET status = 'discarded' WHERE id = ?`).run(batchId);
  });

  run();
}

export async function listConfirmedEntries(): Promise<ConfirmedEntryRow[]> {
  const rows = db
    .prepare(
      `SELECT e.id, e.batch_id, e.title, e.modes, e.date_start, e.date_end,
              e.summary_text, b.confirmed_at
         FROM memory_entries e
         JOIN memory_batches b ON b.id = e.batch_id
        WHERE b.status = 'confirmed'
        ORDER BY b.confirmed_at DESC, e.id DESC`
    )
    .all() as ConfirmedEntryRow[];
  return rows;
}
