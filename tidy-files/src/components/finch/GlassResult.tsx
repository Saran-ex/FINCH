import { ArrowUpRight } from "lucide-react";
import { FloatingInformation } from "./FloatingInformation";
import type { SearchResult } from "@/types/mode";

export function GlassResult({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  return (
    <FloatingInformation className={result.position} onClick={onSelect}>
      <div className="result-topline">
        <span>{result.category}</span>
        <ArrowUpRight aria-hidden="true" />
      </div>
      <h3>{result.title}</h3>
      <p>{result.description}</p>
      <div className="result-meta">
        <span>{result.source}</span>
        <time>{result.timestamp}</time>
      </div>
    </FloatingInformation>
  );
}