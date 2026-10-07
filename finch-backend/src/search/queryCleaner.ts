const STOP_WORDS = new Set([
  "is",
  "are",
  "was",
  "were",
  "the",
  "a",
  "an",
  "what",
  "whats",
  "who",
  "why",
  "how",
  "when",
  "where",
  "does",
  "do",
  "did",
  "can",
  "could",
  "you",
  "me",
  "tell",
  "about",
  "of",
  "please",
  "real",
  "true",
  "get",
  "give",
  "show",
  "find",
  "some",
  "any",
  "fact",
  "facts",
  "i",
  "my",
  "we",
  "it",
  "its",
  "in",
  "on",
  "for",
  "to",
  "and",
  "or",
  "with",
]);

const MAX_QUERY_LENGTH = 200;

// Keeps letters, digits, spaces, apostrophes and hyphens; everything else becomes a space.
function replaceDisallowedCharacters(text: string): string {
  return text.replace(/[^\p{L}\p{N} '\-]/gu, " ");
}

export function cleanSearchQuery(text: string): string {
  const trimmed = text.trim();

  const words = replaceDisallowedCharacters(trimmed)
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word.toLowerCase()));

  const cleaned = words.join(" ").slice(0, MAX_QUERY_LENGTH);
  if (cleaned.length > 0) {
    return cleaned;
  }

  return trimmed.slice(0, MAX_QUERY_LENGTH);
}
