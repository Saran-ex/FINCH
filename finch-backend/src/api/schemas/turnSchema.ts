import { ValidationError } from "../../services/errors.js";
import { ensureValidMode } from "../../modes/validation.js";
import type { TurnInput } from "../../ai/turnService.js";

export function validateTurnRequest(body: unknown): TurnInput {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.transcript !== "string" || b.transcript.trim().length === 0) {
    throw new ValidationError("'transcript' must be a non-empty string");
  }
  if (b.transcript.length > 2000) {
    throw new ValidationError("'transcript' is too long (max 2000 chars)");
  }

  const mode = ensureValidMode(b.currentMode);

  // Optional model override (validated against the mode's allowed list in turnService)
  let modelOverride: string | undefined;
  if (
    typeof b.modelOverride === "string" &&
    b.modelOverride.trim().length > 0
  ) {
    modelOverride = b.modelOverride.trim();
  }

  // Optional research direction path: an array of strings, or absent.
  let researchPath: string[] | undefined;
  if (b.researchPath !== undefined) {
    if (
      !Array.isArray(b.researchPath) ||
      !b.researchPath.every((item) => typeof item === "string")
    ) {
      throw new ValidationError("'researchPath' must be an array of strings");
    }
    researchPath = b.researchPath;
  }

  // Optional research category: same handling as modelOverride — a non-string or
  // an empty string after trim is treated as absent.
  let researchCategory: string | undefined;
  if (
    typeof b.researchCategory === "string" &&
    b.researchCategory.trim().length > 0
  ) {
    researchCategory = b.researchCategory.trim();
  }

  return {
    transcript: b.transcript,
    currentMode: mode,
    modelOverride,
    researchPath,
    researchCategory,
  };
}
