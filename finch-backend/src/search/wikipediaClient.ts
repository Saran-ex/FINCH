import type { SearchResult } from './types';
import { SearchError } from './searxngClient';

export const DEFAULT_WIKIPEDIA_URL = 'https://en.wikipedia.org';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 5;
const SNIPPET_MAX_LENGTH = 300;

interface WikiPage {
  title?: unknown;
  index?: unknown;
  extract?: unknown;
  thumbnail?: unknown;
}

const MAX_IMAGE_LENGTH = 500;

// Keeps only absolute https thumbnails within the length cap.
function pickImage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('https://')) return undefined;
  if (value.length > MAX_IMAGE_LENGTH) return undefined;
  return value;
}

// Builds the article URL: underscores survive, every other character is encoded.
function toArticleUrl(baseUrl: string, title: string): string {
  return `${baseUrl}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function toSearchResult(baseUrl: string, hostname: string, page: WikiPage): SearchResult | null {
  if (typeof page.title !== 'string' || page.title.trim() === '') return null;

  const extract = typeof page.extract === 'string' ? page.extract : '';

  const result: SearchResult = {
    title: page.title,
    url: toArticleUrl(baseUrl, page.title),
    snippet: extract.slice(0, SNIPPET_MAX_LENGTH),
    domain: hostname,
    trust: 'high',
  };

  if (page.thumbnail !== null && typeof page.thumbnail === 'object') {
    const image = pickImage((page.thumbnail as { source?: unknown }).source);
    if (image) {
      result.image = image;
    }
  }

  return result;
}

export async function wikipediaSearch(
  query: string,
  baseUrl: string = DEFAULT_WIKIPEDIA_URL,
  options: { timeoutMs?: number; maxResults?: number } = {}
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    throw new SearchError('Search query must not be empty.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: trimmedQuery,
    gsrlimit: String(maxResults),
    prop: 'extracts|pageimages',
    piprop: 'thumbnail',
    pithumbsize: '300',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    exchars: '300',
  });
  const endpoint = `${baseUrl}/w/api.php?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FinchLocal/0.1 (personal offline-first project)',
        Accept: 'application/json',
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchError(`Wikipedia request timed out after ${timeoutMs} ms.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new SearchError(`Could not reach Wikipedia at ${baseUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SearchError(`Wikipedia responded with status ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError('Wikipedia returned a reply that is not valid JSON.');
  }

  const pages =
    payload !== null && typeof payload === 'object'
      ? (payload as { query?: { pages?: unknown } }).query?.pages
      : undefined;
  if (pages === null || typeof pages !== 'object') {
    return [];
  }

  const hostname = new URL(baseUrl).hostname;
  const ordered = (Object.values(pages) as WikiPage[]).sort((a, b) => {
    const left = typeof a.index === 'number' ? a.index : 0;
    const right = typeof b.index === 'number' ? b.index : 0;
    return left - right;
  });

  const mapped: SearchResult[] = [];
  for (const page of ordered) {
    if (page === null || typeof page !== 'object') continue;
    const result = toSearchResult(baseUrl, hostname, page);
    if (result) mapped.push(result);
  }

  return mapped;
}
