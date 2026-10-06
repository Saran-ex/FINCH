import { useEffect, useState } from "react";
import type { VoiceEngine } from "@/lib/api";

// The four modes that own an AI-model picker in Settings → Organizer.
export type OrganizerMode = "conversation" | "search" | "research" | "plan";

export type OrganizerSettings = {
  // Explicit per-mode model alias. Absent = keep the mode's backend default.
  models: Partial<Record<OrganizerMode, string>>;
  // Explicit Conversation voice engine. Absent = backend default engine.
  voiceEngine?: VoiceEngine | undefined;
};

export const ORGANIZER_MODES: readonly OrganizerMode[] = [
  "conversation",
  "search",
  "research",
  "plan",
];

const STORAGE_KEY = "finch.organizer";

const EMPTY: OrganizerSettings = { models: {} };

const VOICE_ENGINES: readonly VoiceEngine[] = ["kokoro", "kitten", "piper"];

let cached: OrganizerSettings | null = null;
const listeners: Set<(settings: OrganizerSettings) => void> = new Set();

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isVoiceEngine(value: unknown): value is VoiceEngine {
  return VOICE_ENGINES.includes(value as VoiceEngine);
}

function load(): OrganizerSettings {
  if (cached !== null) return cached;
  if (!hasStorage()) return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    cached = EMPTY;
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OrganizerSettings> | null;
    cached = {
      models:
        parsed && typeof parsed.models === "object" && parsed.models !== null
          ? { ...parsed.models }
          : {},
      voiceEngine: parsed && isVoiceEngine(parsed.voiceEngine) ? parsed.voiceEngine : undefined,
    };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function persist(next: OrganizerSettings): void {
  cached = next;
  if (hasStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota): choices stay in memory only.
    }
  }
  listeners.forEach((fn) => fn(next));
}

export function setOrganizerModel(mode: OrganizerMode, alias: string): void {
  const current = load();
  persist({ ...current, models: { ...current.models, [mode]: alias } });
}

export function setOrganizerVoiceEngine(engine: VoiceEngine): void {
  persist({ ...load(), voiceEngine: engine });
}

export function subscribeOrganizer(fn: (settings: OrganizerSettings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useOrganizer(): OrganizerSettings {
  const [settings, setSettings] = useState<OrganizerSettings>(() => load());
  useEffect(() => subscribeOrganizer(setSettings), []);
  return settings;
}
