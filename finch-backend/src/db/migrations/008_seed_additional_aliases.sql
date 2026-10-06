-- Migration 008: Seed additional model aliases for the installed Ollama models

INSERT OR IGNORE INTO model_aliases (alias, display_name, ollama_model, description) VALUES
  ('finch-1.7', 'Finch 1.7', 'qwen3:1.7b', 'Newer generation, balanced'),
  ('finch-4',   'Finch 4',   'gemma3:4b',  'Largest available model');
