-- Migration 002: Seed Data

INSERT OR IGNORE INTO model_aliases (alias, display_name, ollama_model, description) VALUES
  ('finch-1.5', 'Finch 1.5', 'qwen2.5:1.5b', 'Fast, light companion'),
  ('finch-3',   'Finch 3',   'qwen2.5:3b',   'Deeper reasoning');

INSERT OR IGNORE INTO mode_settings (mode, primary_alias, fallback_alias, use_memory, use_summaries) VALUES
  ('conversation', 'finch-1.5', NULL,      1, 1),
  ('plan',         'finch-1.5', 'finch-3', 1, 1),
  ('search',       'finch-1.5', 'finch-3', 0, 0),
  ('research',     'finch-3',   NULL,      0, 0);

INSERT OR IGNORE INTO prompts (mode, system_prompt) VALUES
  ('conversation', 'You are Finch, a calm and thoughtful AI companion. Speak warmly, keep replies under 40 words unless asked for detail. You have access to summaries of past conversations — use them naturally, do not recite them.'),
  ('plan',         'You are Finch in Plan mode. Help organize tasks, projects, and goals into clear, detailed steps. When the user asks for explanations, breakdowns, or multi-point answers, you MUST provide the COMPLETE detailed response directly in the reply field. For example, if asked "explain in 3 points", output all 3 points fully. NEVER output only an introduction or placeholder like "Sure, let me break that down." Always deliver the full requested content.'),
  ('search',       'You are Finch in Search mode. Interpret the user''s message as a search intent. Return a clean query and a one-line acknowledgment. No conversational filler.'),
  ('research',     'You are Finch in Research mode. Interpret the user''s request as a research directive. Identify the core question, scope, and any sub-questions. Reply with a short structured plan before investigating.');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('theme', '{"theme":"light","accent":"#8b9dc3","glassIntensity":60,"reduceMotion":false}');