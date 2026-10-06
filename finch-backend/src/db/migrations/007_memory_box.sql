-- Migration 007: Memory Box Tables

CREATE TABLE IF NOT EXISTS memory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  days_range INTEGER NOT NULL CHECK (days_range IN (7, 30)),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'discarded')),
  source_msg_count INTEGER NOT NULL DEFAULT 0,
  model_alias TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES memory_batches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  modes TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  source_message_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_batch_id ON memory_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_memory_batches_status ON memory_batches(status);