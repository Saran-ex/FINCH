import type { SearchResult } from "./types";
import { SearchError } from "./searxngClient";

export const DEFAULT_EUROPEPMC_URL =
  "https://www.ebi.ac.uk/europepmc/webservices/rest";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 4;
const SNIPPET_MAX_LENGTH = 1500;
const USER_AGENT = "FinchLocal/0.1 (personal offline-first project)";

function codePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/gi, (match, hex: string) =>
      codePoint(parseInt(hex, 16), match),
    )
    .replace(/&#(\d+);/g, (match, dec: string) =>
      codePoint(parseInt(dec, 10), match),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function cleanAbstract(value: unknown): string {
  if (typeof value !== "string") return "";
  const withoutTags = value.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim().slice(0, SNIPPET_MAX_LENGTH);
}

interface EuropePmcItem {
  title?: unknown;
  abstractText?: unknown;
  source?: unknown;
  id?: unknown;
  doi?: unknown;
}

// Prefer the Europe PMC article page, then the DOI, otherwise skip the item.
function resolveUrl(item: EuropePmcItem): string | null {
  const source = typeof item.source === "string" ? item.source.trim() : "";
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (source !== "" && id !== "") {
    return `https://europepmc.org/article/${source}/${id}`;
  }

  const doi = typeof item.doi === "string" ? item.doi.trim() : "";
  if (doi !== "") {
    const url = `https://doi.org/${doi}`;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:")
        return url;
    } catch {
      return null;
    }
  }

  return null;
}

export async function europePmcSearch(
  query: string,
  baseUrl: string = DEFAULT_EUROPEPMC_URL,
  options: { timeoutMs?: number; maxResults?: number } = {},
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    throw new SearchError("Search query must not be empty.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const endpoint =
    `${baseUrl}/search?query=${encodeURIComponent(trimmedQuery)}` +
    `&format=json&pageSize=${maxResults}&resultType=core`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchError(
        `Europe PMC request timed out after ${timeoutMs} ms.`,
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new SearchError(
      `Could not reach Europe PMC at ${baseUrl}: ${reason}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SearchError(
      `Europe PMC responded with status ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError(
      "Europe PMC returned a reply that is not valid JSON.",
    );
  }

  const results =
    payload !== null && typeof payload === "object"
      ? (payload as { resultList?: { result?: unknown } }).resultList?.result
      : undefined;
  if (!Array.isArray(results)) {
    throw new SearchError(
      "Europe PMC returned a reply with an unexpected shape.",
    );
  }

  const mapped: SearchResult[] = [];
  for (const raw of results as EuropePmcItem[]) {
    if (mapped.length >= maxResults) break;
    if (raw === null || typeof raw !== "object") continue;

    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title === "") continue;

    const snippet = cleanAbstract(raw.abstractText);
    if (snippet.length === 0) continue;

    const url = resolveUrl(raw);
    if (url === null) continue;

    mapped.push({
      title,
      url,
      snippet,
      domain: "europepmc.org",
      trust: "high",
    });
  }

  return mapped;
}
