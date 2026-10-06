import { MODES, type Mode } from "../config/constants.js";
import { ValidationError } from "../services/errors.js";

export function isValidMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function ensureValidMode(value: unknown): Mode {
  if (!isValidMode(value)) {
    throw new ValidationError(`Invalid mode: ${String(value)}`);
  }
  return value;
}