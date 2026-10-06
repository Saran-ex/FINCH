-- Migration 015: trust list moved from hardcoded arrays to the database.
-- kind is one of: 'high' (trusted domain), 'suffix' (trusted suffix), 'low' (low-trust domain).

CREATE TABLE IF NOT EXISTS trust_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('high', 'suffix', 'low')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, value)
);

CREATE INDEX IF NOT EXISTS idx_trust_entries_kind ON trust_entries(kind);

INSERT OR IGNORE INTO trust_entries (kind, value) VALUES
  ('high', 'wikipedia.org'),
  ('high', 'britannica.com'),
  ('high', 'jstor.org'),
  ('high', 'nature.com'),
  ('high', 'science.org'),
  ('high', 'sciencedirect.com'),
  ('high', 'springer.com'),
  ('high', 'nih.gov'),
  ('high', 'who.int'),
  ('high', 'reuters.com'),
  ('high', 'apnews.com'),
  ('high', 'bbc.com'),
  ('high', 'bbc.co.uk'),
  ('high', 'nasa.gov'),
  ('high', 'arxiv.org'),
  ('high', 'plato.stanford.edu'),
  ('high', 'iep.utm.edu'),
  ('high', 'nationalgeographic.com'),
  ('suffix', '.gov'),
  ('suffix', '.edu'),
  ('suffix', '.ac.uk'),
  ('suffix', '.gov.uk'),
  ('low', 'blogspot.com'),
  ('low', 'wordpress.com'),
  ('low', 'medium.com'),
  ('low', 'tumblr.com'),
  ('low', 'quora.com'),
  ('low', 'reddit.com'),
  ('low', 'pinterest.com'),
  ('low', 'facebook.com'),
  ('low', 'instagram.com'),
  ('low', 'tiktok.com'),
  ('low', 'fandom.com'),
  ('low', 'answers.com');
