-- Migration 009: Per-mode allowed model aliases
-- allowed_aliases = JSON array of aliases usable in the mode.
-- Empty array means "all enabled aliases" (used by plan mode so new aliases are picked up automatically).

ALTER TABLE mode_settings ADD COLUMN allowed_aliases TEXT NOT NULL DEFAULT '[]';

UPDATE mode_settings SET allowed_aliases = '["finch-1.5","finch-1.7"]' WHERE mode = 'conversation';
UPDATE mode_settings SET allowed_aliases = '["finch-1.5","finch-1.7"]' WHERE mode = 'search';
UPDATE mode_settings SET allowed_aliases = '["finch-3","finch-4"]'     WHERE mode = 'research';
-- plan: keep default '[]' (all enabled aliases)

-- Keep search escalation inside its allowed set: complex search input now escalates to finch-1.7.
UPDATE mode_settings SET fallback_alias = 'finch-1.7' WHERE mode = 'search';
