import { getMemoryStatus, DEFAULT_RAM_LIMIT_PERCENT } from "./memoryCheck";
import {
  searxngSearch,
  SearchError,
  DEFAULT_LOCAL_SEARXNG_URL,
} from "./searxngClient";
import { wikipediaSearch, DEFAULT_WIKIPEDIA_URL } from "./wikipediaClient";
import type { SearchOutcome, SearchResult } from "./types";

export type RouteDecision =
  "local" | "low-ram" | "local-failed" | "local-empty";

export interface RoutedSearchOutcome extends SearchOutcome {
  decision: RouteDecision;
}

type SearchFn = (
  query: string,
  baseUrl?: string,
  options?: { timeoutMs?: number; maxResults?: number },
) => Promise<SearchResult[]>;

export interface RouterOptions {
  localUrl?: string;
  wikipediaUrl?: string;
  ramLimitPercent?: number;
  settleDelayMs?: number;
  attemptTimeoutMs?: number;
  maxResults?: number;
  getUsedPercent?: () => number;
  localSearch?: SearchFn;
  fallbackSearch?: SearchFn;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Races a search against a timer; the timer is cleared however the race ends.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new SearchError(`Search attempt timed out after ${timeoutMs} ms.`),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function routedSearch(
  query: string,
  options: RouterOptions = {},
): Promise<RoutedSearchOutcome> {
  if (query.trim() === "") {
    throw new SearchError("Search query must not be empty.");
  }

  const localUrl = options.localUrl ?? DEFAULT_LOCAL_SEARXNG_URL;
  const wikipediaUrl = options.wikipediaUrl ?? DEFAULT_WIKIPEDIA_URL;
  const ramLimitPercent = options.ramLimitPercent ?? DEFAULT_RAM_LIMIT_PERCENT;
  const settleDelayMs = options.settleDelayMs ?? 1000;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 20000;
  const maxResults = options.maxResults ?? 8;
  const getUsedPercent =
    options.getUsedPercent ?? (() => getMemoryStatus().usedPercent);
  const localSearch = options.localSearch ?? searxngSearch;
  const fallbackSearch = options.fallbackSearch ?? wikipediaSearch;

  let decision: RouteDecision;

  if (getUsedPercent() >= ramLimitPercent) {
    decision = "low-ram";
  } else {
    await sleep(settleDelayMs);
    if (getUsedPercent() >= ramLimitPercent) {
      decision = "low-ram";
    } else {
      decision = "local";
      try {
        const results = await withTimeout(
          localSearch(query, localUrl, { maxResults }),
          attemptTimeoutMs,
        );
        if (results.length > 0) {
          return { results, searchSource: "local", decision: "local" };
        }
        decision = "local-empty";
      } catch {
        decision = "local-failed";
      }
    }
  }

  try {
    const results = await withTimeout(
      fallbackSearch(query, wikipediaUrl, { maxResults: 5 }),
      attemptTimeoutMs,
    );
    return { results, searchSource: "online", decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SearchError("Search is unavailable: " + message);
  }
}
