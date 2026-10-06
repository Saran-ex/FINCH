import { useEffect, useState } from "react";
import { getControlModes, type ModeModelConfig, type ModeModelOption } from "@/lib/api";
import type { Mode } from "@/types/mode";

let cache: Promise<ModeModelConfig[]> | null = null;
const listeners: Set<() => void> = new Set();

function loadModeConfigs(): Promise<ModeModelConfig[]> {
  if (!cache) {
    cache = getControlModes().catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

/**
 * Drops the cached /api/control/modes payload and re-fetches it, waking every
 * consumer. Called after the model library changes so each picker immediately
 * sees the new enabled set and mode defaults.
 */
export async function refreshModeModels(): Promise<ModeModelConfig[]> {
  cache = null;
  const promise = loadModeConfigs();
  listeners.forEach((fn) => fn());
  return promise;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export type ModeModels = {
  options: ModeModelOption[];
  defaultAlias: string | undefined;
  loading: boolean;
};

/** Display/submit value: explicit selection if allowed, else mode default, else first option. */
export function resolveModelValue(
  options: ModeModelOption[],
  defaultAlias: string | undefined,
  value?: string,
): string | undefined {
  if (value && options.some((opt) => opt.alias === value)) return value;
  if (defaultAlias && options.some((opt) => opt.alias === defaultAlias)) return defaultAlias;
  return options[0]?.alias;
}

export function useModeModels(mode: Mode): ModeModels {
  const [config, setConfig] = useState<ModeModelConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let cancelled = false;
    loadModeConfigs()
      .then((configs) => {
        if (cancelled) return;
        setConfig(configs.find((c) => c.mode === mode) ?? null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load models");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, version]);

  return {
    options: config?.allowedModels ?? [],
    defaultAlias: config?.defaultAlias,
    loading: config === null && error === null,
  };
}
