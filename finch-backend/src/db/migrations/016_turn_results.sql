-- Migration 016: structured per-turn results for Search and Research modes.
-- Each row stores one turn's response payload (web sources, cards, directions,
-- images) as a JSON blob so a mode can reload the most recent turn on mount.

CREATE TABLE IF NOT EXISTS turn_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('search', 'research')),
  request TEXT NOT NULL,
  reply TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_turn_results_mode_created
  ON turn_results(mode, created_at DESC);
