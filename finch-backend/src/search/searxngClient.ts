import type { SearchResult } from "./types";

export const DEFAULT_LOCAL_SEARXNG_URL = "http://127.0.0.1:8080";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 8;
const SNIPPET_MAX_LENGTH = 300;

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

// Drops a leading "www." so results group by registrable domain.
function toDomain(url: URL): string {
  const host = url.hostname;
  return host.startsWith("www.") ? host.slice(4) : host;
}

interface RawResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  thumbnail?: unknown;
  img_src?: unknown;
}

const MAX_IMAGE_LENGTH = 500;

// Keeps only absolute https images, trimmed and within the length cap.
function pickImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://")) return undefined;
  if (trimmed.length > MAX_IMAGE_LENGTH) return undefined;
  return trimmed;
}

function toSearchResult(raw: RawResult): SearchResult | null {
  if (typeof raw.title !== "string" || raw.title.trim() === "") return null;
  if (typeof raw.url !== "string" || raw.url.trim() === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(raw.url);
  } catch {
    return null;
  }

  const snippet = typeof raw.content === "string" ? raw.content : "";

  const result: SearchResult = {
    title: raw.title,
    url: raw.url,
    snippet: snippet.slice(0, SNIPPET_MAX_LENGTH),
    domain: toDomain(parsed),
    trust: "medium",
  };

  const image = pickImage(raw.thumbnail) ?? pickImage(raw.img_src);
  if (image) {
    result.image = image;
  }

  return result;
}

export async function searxngSearch(
  query: string,
  baseUrl: string = DEFAULT_LOCAL_SEARXNG_URL,
  options: { timeoutMs?: number; maxResults?: number } = {},
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    throw new SearchError("Search query must not be empty.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const endpoint = `${baseUrl}/search?q=${encodeURIComponent(trimmedQuery)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchError(`SearXNG request timed out after ${timeoutMs} ms.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new SearchError(`Could not reach SearXNG at ${baseUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SearchError(`SearXNG responded with status ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError("SearXNG returned a reply that is not valid JSON.");
  }

  const rawResults =
    payload !== null &&
    typeof payload === "object" &&
    Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: RawResult[] }).results
      : [];

  const mapped: SearchResult[] = [];
  for (const raw of rawResults) {
    if (mapped.length >= maxResults) break;
    if (raw === null || typeof raw !== "object") continue;
    const result = toSearchResult(raw);
    if (result) mapped.push(result);
  }

  return mapped;
}

// Image-only lookup for the research card fetcher: same endpoint, but only
// returns validated image URLs. Never throws: [] on any error or bad payload.
export async function searxngImageSearch(
  query: string,
  options: { baseUrl?: string; maxResults?: number; timeoutMs?: number } = {},
): Promise<string[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") return [];

  const baseUrl = options.baseUrl ?? DEFAULT_LOCAL_SEARXNG_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? 5;
  if (maxResults <= 0) return [];

  const endpoint = `${baseUrl}/search?q=${encodeURIComponent(trimmedQuery)}&format=json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const rawResults =
      payload !== null &&
      typeof payload === "object" &&
      Array.isArray((payload as { results?: unknown }).results)
        ? (payload as { results: RawResult[] }).results
        : [];

    const images: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawResults) {
      if (images.length >= maxResults) break;
      if (raw === null || typeof raw !== "object") continue;
      const candidate = pickImage(raw.thumbnail) ?? pickImage(raw.img_src);
      if (candidate !== undefined && !seen.has(candidate)) {
        seen.add(candidate);
        images.push(candidate);
      }
    }
    return images;
  } catch {
    return [];
  }
}
