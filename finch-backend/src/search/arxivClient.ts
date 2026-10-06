import type { SearchResult } from './types';
import { SearchError } from './searxngClient';

export const DEFAULT_ARXIV_URL = 'https://export.arxiv.org';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 4;
const SNIPPET_MAX_LENGTH = 1500;
const MAX_QUERY_WORDS = 6;
const MIN_WORD_LENGTH = 2;
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

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanAbstract(value: string): string {
  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX_LENGTH);
}

function readTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return collapse(decodeEntities(match[1]));
}

export function parseArxivFeed(xml: string): { title: string; url: string; summary: string }[] {
  const entries = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi) ?? [];
  const parsed: { title: string; url: string; summary: string }[] = [];

  for (const entry of entries) {
    const rawId = readTag(entry, 'id');
    const url = rawId.startsWith('http://') ? `https://${rawId.slice('http://'.length)}` : rawId;
    parsed.push({
      title: readTag(entry, 'title'),
      url,
      summary: readTag(entry, 'summary'),
    });
  }

  return parsed;
}

function buildSearchQuery(query: string): string {
  const words = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD_LENGTH)
    .slice(0, MAX_QUERY_WORDS);

  if (words.length === 0) {
    throw new SearchError('Search query contains no usable words.');
  }

  return words.map((word) => `all:${encodeURIComponent(word)}`).join('+AND+');
}

export async function arxivSearch(
  query: string,
  baseUrl: string = DEFAULT_ARXIV_URL,
  options: { timeoutMs?: number; maxResults?: number } = {}
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    throw new SearchError('Search query must not be empty.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const searchQuery = buildSearchQuery(trimmedQuery);
  const endpoint = `${baseUrl}/api/query?search_query=${searchQuery}&max_results=${maxResults}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchError(`arXiv request timed out after ${timeoutMs} ms.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new SearchError(`Could not reach arXiv at ${baseUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SearchError(`arXiv responded with status ${response.status}.`);
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new SearchError('arXiv returned a reply that could not be read.');
  }

  if (!/<feed[\s>]/i.test(body) && !/<\?xml/i.test(body)) {
    throw new SearchError('arXiv returned a reply that is not valid XML.');
  }

  const mapped: SearchResult[] = [];
  for (const entry of parseArxivFeed(body)) {
    if (mapped.length >= maxResults) break;
    if (entry.title === '') continue;
    if (!/^https?:\/\//.test(entry.url)) continue;

    const snippet = cleanAbstract(entry.summary);
    if (snippet.length === 0) continue;

    mapped.push({
      title: entry.title,
      url: entry.url,
      snippet,
      domain: 'arxiv.org',
      trust: 'high',
    });
  }

  return mapped;
}
