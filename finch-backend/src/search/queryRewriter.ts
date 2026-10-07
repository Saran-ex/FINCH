import { cleanSearchQuery } from "./queryCleaner";

const DEFAULT_TIMEOUT_MS = 25000;
const QUESTION_MAX_LENGTH = 300;
const RESULT_MAX_WORDS = 8;
const RESULT_MAX_LENGTH = 100;

// Takes the first non-empty line, strips surrounding quotes/backticks, drops a
// leading "query:"/"search query:", replaces disallowed characters with spaces,
// collapses whitespace, keeps at most 8 words and cuts to 100 characters.
function cleanGenerated(raw: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return "";

  let text = firstLine;
  while (
    text.length > 0 &&
    (text.startsWith('"') || text.startsWith("`") || text.startsWith("'"))
  ) {
    text = text.slice(1);
  }
  while (
    text.length > 0 &&
    (text.endsWith('"') || text.endsWith("`") || text.endsWith("'"))
  ) {
    text = text.slice(0, -1);
  }

  text = text.replace(/^(search\s+query|query)\s*:/i, "");

  const disallowedReplaced = text.replace(/[^\p{L}\p{N}'\-]/gu, " ");
  const collapsed = disallowedReplaced.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";

  const words = collapsed.split(" ").slice(0, RESULT_MAX_WORDS);
  return words.join(" ").slice(0, RESULT_MAX_LENGTH).trim();
}

// Safety guard: at least one word of 3+ characters must occur in the question.
function overlapsQuestion(cleaned: string, question: string): boolean {
  const lowerQuestion = question.toLowerCase();
  return cleaned
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .some((word) => lowerQuestion.includes(word.toLowerCase()));
}

function buildPrompt(question: string): string {
  const cut = question.slice(0, QUESTION_MAX_LENGTH);
  return (
    "Rewrite the question as a short web search query of 2 to 6 key words. " +
    "Fix spelling mistakes. Remove filler words. Keep names and topics. " +
    "Output only the query and nothing else.\nQuestion: " +
    cut +
    "\nQuery:"
  );
}

// Races the generate call against a timer; the timer is cleared however the race ends.
async function raceGenerate(
  generate: (prompt: string) => Promise<string>,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      generate(prompt),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`rewrite timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function rewriteSearchQuery(
  question: string,
  generate: (prompt: string) => Promise<string>,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const fallback = cleanSearchQuery(question);
  const trimmed = question.trim();

  try {
    if (trimmed === "") return fallback;

    const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
    if (words.length < 3) return fallback;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await raceGenerate(generate, buildPrompt(trimmed), timeoutMs);

    const cleaned = cleanGenerated(raw);
    if (cleaned.length === 0) return fallback;
    if (!overlapsQuestion(cleaned, trimmed)) return fallback;

    const finalQuery = cleanSearchQuery(cleaned);
    return finalQuery.length > 0 ? finalQuery : cleaned;
  } catch {
    return fallback;
  }
}
