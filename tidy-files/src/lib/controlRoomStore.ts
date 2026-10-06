import * as React from "react";
import type { Mode } from "@/types/mode";
import type { ControlRoomState, ThemeSettings, ModeSettings } from "@/types/controlRoom";

const STORAGE_KEY = "finch.controlroom";

const DEFAULT_THEME: ThemeSettings = {
  theme: "light",
  glassIntensity: 60,
};

const DEFAULT_MODES: ModeSettings = {
  enabled: {
    conversation: true,
    plan: true,
    search: true,
    research: true,
  },
  defaultMode: "conversation",
};

const DEFAULT_STATE: ControlRoomState = {
  theme: DEFAULT_THEME,
  modes: DEFAULT_MODES,
  memory: [],
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function applyThemeToDocument(theme: ThemeSettings): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveTheme = theme.theme === "system" ? (prefersDark ? "dark" : "light") : theme.theme;

  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  root.style.setProperty("--glass-intensity", `${theme.glassIntensity}%`);
}

class ControlRoomStore {
  private state: ControlRoomState;
  private listeners: Set<(state: ControlRoomState) => void> = new Set();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? safeParse<Record<string, unknown>>(stored, {}) : {};
    // Discard legacy prompt text: the backend `prompts` table is the only source.
    delete parsed["prompts"];
    this.state = {
      ...DEFAULT_STATE,
      ...(parsed as Partial<ControlRoomState>),
    };
    applyThemeToDocument(this.state.theme);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }

  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.saveTimeout = null;
    }, 200);
  }

  load(): ControlRoomState {
    return this.state;
  }

  save(partial: Partial<ControlRoomState>): void {
    this.state = { ...this.state, ...partial };
    if (partial.theme) {
      applyThemeToDocument(this.state.theme);
    }
    this.notify();
    this.debouncedSave();
  }

  subscribe(fn: (state: ControlRoomState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setTheme(theme: Partial<ThemeSettings>): void {
    this.save({ theme: { ...this.state.theme, ...theme } });
  }

  toggleMode(mode: Mode, enabled: boolean): void {
    const newEnabled = { ...this.state.modes.enabled, [mode]: enabled };
    if (!Object.values(newEnabled).some((v) => v)) {
      return;
    }
    this.save({ modes: { ...this.state.modes, enabled: newEnabled } });
  }

  setDefaultMode(mode: Mode): void {
    this.save({ modes: { ...this.state.modes, defaultMode: mode } });
  }
}

export const controlRoomStore = new ControlRoomStore();

export function useControlRoom(): ControlRoomState {
  const [, forceUpdate] = React.useState({});

  React.useEffect(() => {
    const unsubscribe = controlRoomStore.subscribe(() => {
      forceUpdate((s) => ({ ...s }));
    });
    return unsubscribe;
  }, []);

  return controlRoomStore.load();
}
