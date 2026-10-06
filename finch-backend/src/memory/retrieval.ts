import type { Mode } from "../config/constants.js";
import { getRecentMessages } from "./repositories/messageRepo.js";
import { getTopFacts } from "./repositories/factRepo.js";
import { getLatestSummaryForMode } from "./repositories/summaryRepo.js";
import { getModeConfig } from "../modes/manager.js";

export function buildMemoryContext(
  conversationId: number,
  mode: Mode
): string {
  const cfg = getModeConfig(mode);
  if (!cfg.useMemory && !cfg.useSummaries) return "";

  const parts: string[] = [];

  if (cfg.useSummaries) {
    const summary = getLatestSummaryForMode(mode);
    if (summary) {
      parts.push(
        `Recent context summary (${summary.periodStart} to ${summary.periodEnd}):\n${summary.summaryText}`
      );
    }
  }

  const facts = getTopFacts(15);
  if (facts.length > 0) {
    const factLines = facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
    parts.push(`Known facts about the user:\n${factLines}`);
  }

  const recent = getRecentMessages(conversationId, 10);
  if (recent.length > 0) {
    const turnLines = recent
      .map((m) => `${m.role === "user" ? "User" : "Finch"}: ${m.content}`)
      .join("\n");
    parts.push(`Recent conversation:\n${turnLines}`);
  }

  if (parts.length === 0) return "";

  return `--- MEMORY CONTEXT ---\n${parts.join("\n\n")}\n--- END MEMORY ---`;
}