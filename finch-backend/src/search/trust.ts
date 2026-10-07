import {
  getHighTrustDomains,
  getHighTrustSuffixes,
  getLowTrustDomains,
} from "../services/trustList.js";
import type { SearchResult, TrustLevel } from "./types";

// Exact entry match or a real subdomain of it, so "notwikipedia.org" never matches.
function matchesDomain(domain: string, entry: string): boolean {
  return domain === entry || domain.endsWith(`.${entry}`);
}

export function getTrustLevel(domain: string): TrustLevel {
  const normalized = domain.trim().toLowerCase();

  const high = getHighTrustDomains();
  const suffixes = getHighTrustSuffixes();
  const low = getLowTrustDomains();

  for (const entry of high) {
    if (matchesDomain(normalized, entry)) return "high";
  }
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix)) return "high";
  }
  for (const entry of low) {
    if (matchesDomain(normalized, entry)) return "low";
  }

  return "medium";
}

const TRUST_ORDER: Record<TrustLevel, number> = { high: 0, medium: 1, low: 2 };

export function rankAndFilterResults(
  results: SearchResult[],
  options: { dropLow?: boolean } = {},
): SearchResult[] {
  const dropLow = options.dropLow ?? true;

  const labelled = results.map((result) => ({
    ...result,
    trust: getTrustLevel(result.domain),
  }));

  const buckets: Record<TrustLevel, SearchResult[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const result of labelled) {
    buckets[result.trust].push(result);
  }

  const hasNonLow = buckets.high.length > 0 || buckets.medium.length > 0;
  const kept =
    dropLow && hasNonLow
      ? [...buckets.high, ...buckets.medium]
      : [...buckets.high, ...buckets.medium, ...buckets.low];

  // Bucket order is high, medium, low; each bucket keeps input order (stable).
  return kept.sort((a, b) => TRUST_ORDER[a.trust] - TRUST_ORDER[b.trust]);
}
