import type { SearchResult } from "./types";
import { logger } from "../services/logger.js";
import { DEFAULT_LOCAL_SEARXNG_URL, SearchError } from "./searxngClient.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_SITE_RESULTS = 4;
const SNIPPET_MAX_LENGTH = 300;
const MAX_IMAGE_LENGTH = 500;

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

// Keeps only absolute https images, trimmed and within the length cap.
function pickImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://")) return undefined;
  if (trimmed.length > MAX_IMAGE_LENGTH) return undefined;
  return trimmed;
}

// Same validation as searxngClient's mapper, but the user explicitly chose
// these sites, so their results are trusted by policy.
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
    trust: "high",
  };

  const image = pickImage(raw.thumbnail) ?? pickImage(raw.img_src);
  if (image) {
    result.image = image;
  }

  return result;
}

// Restricts a SearXNG query to a single site with the `site:` operator.
// Never throws: [] on timeout, network failure, non-OK status or bad payload.
export async function searxngSiteSearch(
  site: string,
  query: string,
  options: { baseUrl?: string; maxResults?: number; timeoutMs?: number } = {},
): Promise<SearchResult[]> {
  const trimmedSite = site.trim();
  const trimmedQuery = query.trim();
  if (trimmedSite === "" || trimmedQuery === "") return [];

  const baseUrl = options.baseUrl ?? DEFAULT_LOCAL_SEARXNG_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_SITE_RESULTS;
  if (maxResults <= 0) return [];

  const combined = `site:${trimmedSite} ${trimmedQuery}`;
  const endpoint = `${baseUrl}/search?q=${encodeURIComponent(combined)}&format=json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SearchError(
          `SearXNG request timed out after ${timeoutMs} ms.`,
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new SearchError(`Could not reach SearXNG at ${baseUrl}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new SearchError(
        `SearXNG responded with status ${response.status}.`,
      );
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
  } catch (err) {
    logger.debug("site search failed", {
      site: trimmedSite,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
