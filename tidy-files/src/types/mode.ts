export type Mode = "conversation" | "plan" | "search" | "research";

export type VoiceState = "idle" | "waiting" | "listening" | "thinking" | "speaking";

export interface SearchResult {
  id: string;
  title: string;
  source: string;
  description: string;
  category: string;
  timestamp: string;
  detail: string;
  position: string;
}

export interface ResearchItem {
  id: string;
  category: string;
  aiCategory?: string;
  title: string;
  description: string;
  detail: string;
  connections: string[];
  position: string;
  depth: "near" | "middle" | "far";
  image?: string;
}
