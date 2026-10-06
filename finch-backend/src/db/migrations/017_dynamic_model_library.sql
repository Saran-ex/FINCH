-- Migration 017: Dynamic model library
-- allowed_aliases used to hard-code which of the four seeded models each mode
-- could use, which would hide any model installed later from three of the four
-- pickers. The library now comes from Ollama's installed-model list, so every
-- mode accepts every enabled model. '[]' means "all enabled aliases".

UPDATE mode_settings SET allowed_aliases = '[]';
