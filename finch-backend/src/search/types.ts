export type TrustLevel = "high" | "medium" | "low";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  trust: TrustLevel;
  image?: string;
}

export type SearchSource = "local" | "online" | "research";

export interface SearchOutcome {
  results: SearchResult[];
  searchSource: SearchSource;
}
