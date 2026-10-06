import type { Mode } from "./constants.js";
import { SEARCH_SYSTEM_PROMPT_DRAFT, RESEARCH_SYSTEM_PROMPT_DRAFT } from "../search/answerBuilder.js";

export interface ModeConfig {
  numPredict: number;
  temperature: number;
  useJson: boolean;
  systemPrompt: string;
  numCtx: number;
}

export const modeConfigs: Record<Mode, ModeConfig> = {
  conversation: {
    numPredict: 512,
    temperature: 0.7,
    useJson: true,
    numCtx: 4096,
    // Default/fallback prompt only; the live prompt is read from the `prompts` table each turn.
    systemPrompt: `You are Finch, a calm and thoughtful AI companion. Speak warmly, keep replies under 40 words unless asked for detail. You have access to summaries of past conversations — use them naturally, do not recite them.`
  },
  plan: {
    numPredict: 1024,
    temperature: 0.3,
    useJson: false,
    numCtx: 4096,
    // Default/fallback prompt only; the live prompt is read from the `prompts` table each turn.
    systemPrompt: `You are Finch's planning assistant.
Answer the user's actual question directly and stay on their topic.
If the user asks for N points, give exactly N numbered points, no more, no less.
Give each point a bold title followed by 2-3 sentences of explanation.
Use markdown. Give the full answer in one reply.
Only write a step-by-step plan if the user asks for a plan.`
  },
  research: {
    numPredict: 1536,
    temperature: 0.3,
    useJson: false,
    numCtx: 4096,
    // Default/fallback prompt only; the live prompt is read from the `prompts` table each turn.
    systemPrompt: RESEARCH_SYSTEM_PROMPT_DRAFT
  },
  search: {
    numPredict: 512,
    temperature: 0.2,
    useJson: false,
    numCtx: 4096,
    // Default/fallback prompt only; the live prompt is read from the `prompts` table each turn.
    systemPrompt: SEARCH_SYSTEM_PROMPT_DRAFT
  }
};

export function getModeConfig(mode: Mode): ModeConfig {
  return modeConfigs[mode] || modeConfigs.conversation;
}