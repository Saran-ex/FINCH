import { SearchError } from './searxngClient';
import { openAlexSearch, DEFAULT_OPENALEX_URL } from './openAlexClient';
import { europePmcSearch, DEFAULT_EUROPEPMC_URL } from './europePmcClient';
import { arxivSearch, DEFAULT_ARXIV_URL } from './arxivClient';
import { wikipediaSearch, DEFAULT_WIKIPEDIA_URL } from './wikipediaClient';
import type { SearchOutcome, SearchResult } from './types';

export type ResearchDecision = 'research' | 'research-fallback';

export interface ResearchOutcome extends SearchOutcome {
  decision: ResearchDecision;
  sourcesUsed: string[];
}

type SearchFn = (
  query: string,
  baseUrl: string,
  options: { timeoutMs?: number; maxResults?: number }
) => Promise<SearchResult[]>;

export interface ResearchOptions {
  timeoutMs?: number;
  maxPerSource?: number;
  maxTotal?: number;
  openAlexSearch?: SearchFn;
  europePmcSearch?: SearchFn;
  arxivSearch?: SearchFn;
  fallbackSearch?: SearchFn;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_PER_SOURCE = 4;
const DEFAULT_MAX_TOTAL = 8;
const FALLBACK_MAX_RESULTS = 5;

const SOURCE_NAMES = ['openalex', 'europepmc', 'arxiv'] as const;

// Titles match after lowercasing and dropping everything that is not a letter.
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}]+/gu, '');
}

function isDuplicate(result: SearchResult, seenUrls: Set<string>, seenTitles: Set<string>): boolean {
  if (seenUrls.has(result.url)) return true;
  const key = normalizeTitle(result.title);
  return key.length > 0 && seenTitles.has(key);
}

// Merges OpenAlex, Europe PMC and arXiv round-robin, skipping duplicates.
function mergeRoundRobin(lists: SearchResult[][], maxTotal: number): SearchResult[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const merged: SearchResult[] = [];
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);

  for (let index = 0; index < longest && merged.length < maxTotal; index++) {
    for (const list of lists) {
      if (merged.length >= maxTotal) break;
      const result = list[index];
      if (result === undefined) continue;
      if (isDuplicate(result, seenUrls, seenTitles)) continue;
      seenUrls.add(result.url);
      const key = normalizeTitle(result.title);
      if (key.length > 0) seenTitles.add(key);
      merged.push(result);
    }
  }

  return merged;
}

export async function researchSearch(
  query: string,
  options: ResearchOptions = {}
): Promise<ResearchOutcome> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    throw new SearchError('Search query must not be empty.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPerSource = options.maxPerSource ?? DEFAULT_MAX_PER_SOURCE;
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
  const runOpenAlex = options.openAlexSearch ?? openAlexSearch;
  const runEuropePmc = options.europePmcSearch ?? europePmcSearch;
  const runArxiv = options.arxivSearch ?? arxivSearch;
  const runFallback = options.fallbackSearch ?? wikipediaSearch;

  const settled = await Promise.allSettled([
    runOpenAlex(trimmedQuery, DEFAULT_OPENALEX_URL, { timeoutMs, maxResults: maxPerSource }),
    runEuropePmc(trimmedQuery, DEFAULT_EUROPEPMC_URL, { timeoutMs, maxResults: maxPerSource }),
    runArxiv(trimmedQuery, DEFAULT_ARXIV_URL, { timeoutMs, maxResults: maxPerSource }),
  ]);

  const lists: SearchResult[][] = [];
  const sourcesUsed: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      if (outcome.value.length > 0) sourcesUsed.push(SOURCE_NAMES[index]);
      lists.push(outcome.value);
    } else {
      lists.push([]);
    }
  });

  const results = mergeRoundRobin(lists, maxTotal);
  if (results.length > 0) {
    return { results, searchSource: 'research', decision: 'research', sourcesUsed };
  }

  let fallbackResults: SearchResult[];
  try {
    fallbackResults = await runFallback(trimmedQuery, DEFAULT_WIKIPEDIA_URL, {
      maxResults: FALLBACK_MAX_RESULTS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SearchError('Search is unavailable: ' + message);
  }

  return {
    results: fallbackResults,
    searchSource: 'online',
    decision: 'research-fallback',
    sourcesUsed: fallbackResults.length > 0 ? ['wikipedia'] : [],
  };
}
