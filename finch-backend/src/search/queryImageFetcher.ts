import { searxngImageSearch } from './searxngClient';
import { DEFAULT_WIKIPEDIA_URL } from './wikipediaClient';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_IMAGE_LENGTH = 500;
const USER_AGENT = 'FinchLocal/0.1 (personal offline-first project)';

function isValidImage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('https://') &&
    value.length <= MAX_IMAGE_LENGTH
  );
}

// Up to `count` Wikipedia thumbnail URLs for the query, from a single
// generator=search + prop=pageimages request. Never throws: any error or
// non-OK response returns an empty array.
async function fetchWikipediaImages(trimmedQuery: string, count: number): Promise<string[]> {
  if (trimmedQuery === '' || count <= 0) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: trimmedQuery,
      // A little higher than count so results without thumbnails do not shrink the pool.
      gsrlimit: String(count + 2),
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: '300',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${DEFAULT_WIKIPEDIA_URL}/w/api.php?${params.toString()}`, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { query?: { pages?: unknown } };
    const rawPages = payload?.query?.pages;
    if (rawPages === null || typeof rawPages !== 'object') {
      return [];
    }

    const images: string[] = [];
    for (const page of Object.values(rawPages) as { thumbnail?: unknown }[]) {
      if (images.length >= count) break;
      if (page === null || typeof page !== 'object') continue;
      if (page.thumbnail === null || typeof page.thumbnail !== 'object') continue;
      const source = (page.thumbnail as { source?: unknown }).source;
      if (isValidImage(source)) {
        images.push(source);
      }
    }
    return images;
  } catch {
    return [];
  }
}

// Up to `count` unique image URLs for the query: SearXNG first, Wikipedia as
// the top-up. Never throws; on failure returns whatever was collected.
export async function fetchQueryImages(query: string, count: number): Promise<string[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '' || count <= 0) {
    return [];
  }

  const collected: string[] = [];
  const seen = new Set<string>();
  const collect = (urls: string[]) => {
    for (const url of urls) {
      if (collected.length >= count) break;
      if (seen.has(url)) continue;
      seen.add(url);
      collected.push(url);
    }
  };

  try {
    collect(await searxngImageSearch(trimmedQuery, { maxResults: count }));
  } catch {
    // searxngImageSearch never throws; keep the guarantee anyway.
  }

  if (collected.length < count) {
    try {
      collect(await fetchWikipediaImages(trimmedQuery, count - collected.length));
    } catch {
      // fetchWikipediaImages never throws; keep the guarantee anyway.
    }
  }

  return collected;
}
