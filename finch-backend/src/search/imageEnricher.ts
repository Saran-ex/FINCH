import type { SearchResult } from './types';
import { DEFAULT_WIKIPEDIA_URL } from './wikipediaClient';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TITLES = 5;
const MAX_IMAGE_LENGTH = 500;
const USER_AGENT = 'FinchLocal/0.1 (personal offline-first project)';
const WIKI_PATH_PREFIX = '/wiki/';

function isValidImage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('https://') &&
    value.length <= MAX_IMAGE_LENGTH
  );
}

// Article title taken from an en.wikipedia.org /wiki/ URL, or null if not one.
function titleFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'en.wikipedia.org') return null;
  if (!parsed.pathname.startsWith(WIKI_PATH_PREFIX)) return null;

  const rawPath = parsed.pathname.slice(WIKI_PATH_PREFIX.length);
  if (rawPath.length === 0) return null;

  try {
    return decodeURIComponent(rawPath).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

interface PageLike {
  title?: unknown;
  thumbnail?: unknown;
}

function imageForPage(page: PageLike): string | undefined {
  if (typeof page.title !== 'string') return undefined;
  if (page.thumbnail === null || typeof page.thumbnail !== 'object') return undefined;
  const source = (page.thumbnail as { source?: unknown }).source;
  if (!isValidImage(source)) return undefined;
  return source;
}

// One batched pageimages lookup for wiki results that have no image yet.
// Never throws: any failure returns the input results unchanged.
export async function addWikipediaImages(
  results: SearchResult[],
  options: { timeoutMs?: number; baseUrl?: string } = {}
): Promise<SearchResult[]> {
  const baseUrl = options.baseUrl ?? DEFAULT_WIKIPEDIA_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const titles: string[] = [];
  const seenTitles = new Set<string>();
  const titleByIndex = new Map<number, string>();

  results.forEach((result, index) => {
    if (result.image) return;
    const title = titleFromUrl(result.url);
    if (!title) return;
    titleByIndex.set(index, title);
    if (!seenTitles.has(title) && titles.length < MAX_TITLES) {
      seenTitles.add(title);
      titles.push(title);
    }
  });

  if (titles.length === 0) {
    return results;
  }

  let pages: PageLike[] = [];
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: '300',
      titles: titles.join('|'),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/w/api.php?${params.toString()}`, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return results;

    const payload = (await response.json()) as { query?: { pages?: unknown } };
    const rawPages = payload?.query?.pages;
    if (rawPages === null || typeof rawPages !== 'object') return results;
    pages = Object.values(rawPages) as PageLike[];
  } catch {
    return results;
  }

  const imageByTitle = new Map<string, string>();
  for (const page of pages) {
    if (page === null || typeof page !== 'object') continue;
    const image = imageForPage(page);
    if (image && typeof page.title === 'string') {
      imageByTitle.set(page.title, image);
    }
  }

  if (imageByTitle.size === 0) {
    return results;
  }

  return results.map((result, index) => {
    const title = titleByIndex.get(index);
    const image = title ? imageByTitle.get(title) : undefined;
    if (!image) return { ...result };
    return { ...result, image };
  });
}
