import type { SearchResult } from "./types";

export function filterRelevant(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  const keywords = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}']/gu)
        .filter((word) => word.length >= 3),
    ),
  );

  if (keywords.length === 0) {
    return results;
  }

  return results.filter((result) => {
    const haystack =
      `${result.title} ${result.snippet} ${result.domain}`.toLowerCase();

    return keywords.some((keyword) => {
      if (haystack.includes(keyword)) return true;
      if (keyword.length > 4 && keyword.endsWith("s")) {
        return haystack.includes(keyword.slice(0, -1));
      }
      return false;
    });
  });
}
