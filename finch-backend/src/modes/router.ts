import type { Mode } from "../config/constants.js";
import { getModeConfig, type ModeConfig } from "./manager.js";

export type ModeRoute = {
  config: ModeConfig;
  modelAlias: string;
};

/**
 * Decide which model to use for this mode.
 * - If fallbackAlias exists AND request is complex (long text), use fallback.
 * - Otherwise use primary.
 */
export function routeMode(mode: Mode, transcript: string): ModeRoute {
  const config = getModeConfig(mode);

  const isComplex =
    transcript.length > 200 ||
    /\b(analyze|compare|deep|detailed|step by step)\b/i.test(transcript);

  const chosen =
    config.fallbackAlias && isComplex
      ? config.fallbackAlias
      : config.primaryAlias;

  return { config, modelAlias: chosen };
}
