import type { SearchResult, ResearchItem } from "@/types/mode";
import type { TopicCard, WebSource } from "@/lib/api";

export type SearchCardResult = SearchResult & { image?: string; links: string[] };
export type ResearchCardItem = ResearchItem & { image?: string; links: string[] };

const SEARCH_POSITIONS = [
  "search-result-a",
  "search-result-b",
  "search-result-c",
  "search-result-d",
];
const RESEARCH_POSITIONS = [
  "research-item-a",
  "research-item-b",
  "research-item-c",
  "research-item-d",
  "research-item-e",
];
const RESEARCH_DEPTHS = ["near", "middle", "far", "middle", "near"] as const;
const DESCRIPTION_MAX = 140;

function describe(summary: string): string {
  const text = summary.trim();
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX)}…` : text;
}

// Splits sources into `count` equal consecutive chunks; chunk i backs card i.
function chunkLinks(sources: WebSource[], count: number): string[][] {
  if (count <= 0) return [];
  if (sources.length === 0) return Array.from({ length: count }, () => [] as string[]);
  const chunks: string[][] = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * sources.length) / count);
    const end = Math.floor(((i + 1) * sources.length) / count);
    chunks.push(sources.slice(start, end).map((source) => source.url));
  }
  return chunks;
}

export function toSearchGlassResults(cards: TopicCard[], sources: WebSource[]): SearchCardResult[] {
  const limited = cards.slice(0, 4);
  const linksPerCard = chunkLinks(sources, limited.length);

  return limited.map((card, index) => {
    const result: SearchCardResult = {
      id: `card-${index}`,
      title: card.headline,
      source: "Finch Search",
      description: describe(card.summary),
      category: "Search",
      timestamp: "",
      detail: card.summary,
      position: SEARCH_POSITIONS[index] ?? "search-result-a",
      links: linksPerCard[index] ?? [],
    };
    if (index === 0 && sources[0]?.image) {
      result.image = sources[0].image;
    }
    return result;
  });
}

// Backend cards may carry extras the API type does not declare yet.
export type ResearchCardSource = TopicCard & { image?: string; sourceIndexes?: number[] };

export function toResearchGlassItems(
  cards: ResearchCardSource[],
  sources: WebSource[],
): ResearchCardItem[] {
  const limited = cards.slice(0, 5);
  const linksPerCard = chunkLinks(sources, limited.length);

  return limited.map((card, index) => {
    const sourceIndexes = card.sourceIndexes;
    const links = sourceIndexes
      ? sourceIndexes
          .map((sourceIndex) => sources[sourceIndex]?.url)
          .filter((url): url is string => Boolean(url))
      : (linksPerCard[index] ?? []);
    const result: ResearchCardItem = {
      id: `card-${index}`,
      category: "Research",
      title: card.headline,
      description: describe(card.summary),
      detail: card.summary,
      connections: [],
      position: RESEARCH_POSITIONS[index] ?? "research-item-a",
      depth: RESEARCH_DEPTHS[index] ?? "near",
      links,
    };
    if (card.image) {
      result.image = card.image;
    } else if (index === 0 && sources[0]?.image) {
      result.image = sources[0].image;
    }
    return result;
  });
}

export function toDirectionItems(cards: TopicCard[]): ResearchCardItem[] {
  return cards.slice(0, 5).map((card, index): ResearchCardItem => {
    const item: ResearchCardItem = {
      id: `card-${index}`,
      category: "Research",
      title: card.headline,
      description: describe(card.summary),
      detail: card.summary,
      connections: [],
      position: RESEARCH_POSITIONS[index] ?? "research-item-a",
      depth: RESEARCH_DEPTHS[index] ?? "near",
      links: [],
    };
    if (card.category) {
      item.aiCategory = card.category;
    }
    return item;
  });
}
