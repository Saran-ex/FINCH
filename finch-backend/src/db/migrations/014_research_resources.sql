-- Migration 014: Research Resources — categories and trusted websites.
-- Categories group trustworthy websites that Research mode will later search
-- (Stage 3). Each category holds up to 10 sites; each site belongs to one
-- category and is removed automatically if its category is deleted.

CREATE TABLE IF NOT EXISTS research_resource_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS research_resource_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES research_resource_categories(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, url)
);

CREATE INDEX IF NOT EXISTS idx_research_resource_sites_category
  ON research_resource_sites(category_id);

INSERT OR IGNORE INTO research_resource_categories (name) VALUES
  ('Science'),
  ('History'),
  ('Geography'),
  ('General');
