import type { SearchResult } from './types';
import { SearchError } from './searxngClient';

export const DEFAULT_OPENALEX_URL = 'https://api.openalex.org';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 4;
const SNIPPET_MAX_LENGTH = 1500;
const USER_AGENT = 'FinchLocal/0.1 (personal offline-first project)';

function codePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/gi, (match, hex: string) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec: string) => codePoint(parseInt(dec, 10), match))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanAbstract(value: string): string {
  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX_LENGTH);
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toDomain(url: string): string {
  const host = new URL(url).hostname;
  return host.startsWith('www.') ? host.slice(4) : host;
}

// The abstract is stored as word -> positions; rebuild the text in position order.
export function rebuildAbstract(index: unknown): string {
  if (index === null || typeof index !== 'object' || Array.isArray(index)) return '';

  const positioned: { position: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === 'number' && Number.isFinite(position)) {
        positioned.push({ position, word });
      }
    }
  }

  if (positioned.length === 0) return '';
  positioned.sort((a, b) => a.position - b.position);
  return positioned.map((entry) => entry.word).join(' ');
}

interface OpenAlexItem {
  id?: unknown;
  doi?: unknown;
  title?: unknown;
  display_name?: unknown;
  abstract_inverted_index?: unknown;
  primary_location?: unknown;
}

export async function openAlexSearch(
  query: string,
  baseUrl: string = DEFAULT_OPENALEX_URL,
  options: { timeoutMs?: number; maxResults?: number } = {}
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    throw new SearchError('Search query must not be empty.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const endpoint =
    `${baseUrl}/works?search=${encodeURIComponent(trimmedQuery)}` +
    `&per-page=${Math.min(maxResults * 3, 12)}` +
    '&select=id,doi,title,display_name,abstract_inverted_index,primary_location';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchError(`OpenAlex request timed out after ${timeoutMs} ms.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new SearchError(`Could not reach OpenAlex at ${baseUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SearchError(`OpenAlex responded with status ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError('OpenAlex returned a reply that is not valid JSON.');
  }

  if (
    payload === null ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { results?: unknown }).results)
  ) {
    throw new SearchError('OpenAlex returned a reply with an unexpected shape.');
  }

  const items = (payload as { results: OpenAlexItem[] }).results;
  const mapped: SearchResult[] = [];

  for (const item of items) {
    if (mapped.length >= maxResults) break;
    if (item === null || typeof item !== 'object') continue;

    const rawTitle =
      typeof item.title === 'string' && item.title.trim() !== ''
        ? item.title
        : typeof item.display_name === 'string' && item.display_name.trim() !== ''
          ? item.display_name
          : null;
    if (rawTitle === null) continue;

    const location =
      item.primary_location !== null && typeof item.primary_location === 'object'
        ? (item.primary_location as { landing_page_url?: unknown })
        : undefined;
    const url = [location?.landing_page_url, item.doi, item.id].find(isValidHttpUrl);
    if (url === undefined) continue;

    const snippet = cleanAbstract(rebuildAbstract(item.abstract_inverted_index));
    if (snippet.length < 80) continue;

    mapped.push({
      title: rawTitle.trim(),
      url,
      snippet,
      domain: toDomain(url),
      trust: 'medium',
    });
  }

  return mapped;
}
