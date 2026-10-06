import type { OrganizerMode } from "@/lib/organizerStore";

export type ModeAllowedSets = Partial<Record<OrganizerMode, readonly string[]>>;

export type ModelFallbackChange = {
  mode: OrganizerMode;
  from: string;
  to: string;
};

export type ModelFallbackInput = {
  /** The alias that just left a mode's allowed set (disabled or un-ticked). */
  disabledAlias: string;
  /** The allowed set each mode has AFTER the change — exactly what its picker will offer. */
  allowedAfter: ModeAllowedSets;
  /** What each considered mode was using BEFORE the change. */
  usingBefore: Partial<Record<OrganizerMode, string | undefined>>;
  /** Each considered mode's refreshed default, after the change. */
  defaultAfter: Partial<Record<OrganizerMode, string | undefined>>;
};

/**
 * Decides where each mode goes when the model it is using leaves its allowed
 * set. Only modes actually sitting on that model move; preference order is the
 * mode's refreshed default when it is still allowed, otherwise the first model
 * still allowed. Modes that already point elsewhere are left alone, and a mode
 * left with no allowed model reports no change.
 */
export function computeModelFallbackPlan(input: ModelFallbackInput): ModelFallbackChange[] {
  const { disabledAlias, allowedAfter, usingBefore, defaultAfter } = input;
  const changes: ModelFallbackChange[] = [];

  for (const mode of Object.keys(usingBefore) as OrganizerMode[]) {
    if (usingBefore[mode] !== disabledAlias) continue;
    const allowed = allowedAfter[mode] ?? [];
    const preferred = defaultAfter[mode];
    const fallback =
      preferred !== undefined && preferred !== disabledAlias && allowed.includes(preferred)
        ? preferred
        : allowed.find((alias) => alias !== disabledAlias);
    if (fallback === undefined) continue;
    changes.push({ mode, from: disabledAlias, to: fallback });
  }

  return changes;
}
