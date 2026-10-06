import { ValidationError } from "../../services/errors.js";

export function validateThemeBody(body: unknown): {
  theme: "light" | "dark" | "system";
  accent: string;
  glassIntensity: number;
  reduceMotion: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.theme !== "string" || !["light", "dark", "system"].includes(b.theme)) {
    throw new ValidationError("theme must be 'light', 'dark', or 'system'");
  }

  if (typeof b.accent !== "string" || b.accent.length === 0 || b.accent.length > 16) {
    throw new ValidationError("accent must be a non-empty string ≤ 16 chars");
  }

  if (typeof b.glassIntensity !== "number" || !Number.isInteger(b.glassIntensity) || b.glassIntensity < 0 || b.glassIntensity > 100) {
    throw new ValidationError("glassIntensity must be an integer 0..100");
  }

  if (typeof b.reduceMotion !== "boolean") {
    throw new ValidationError("reduceMotion must be a boolean");
  }

  return {
    theme: b.theme as "light" | "dark" | "system",
    accent: b.accent,
    glassIntensity: b.glassIntensity,
    reduceMotion: b.reduceMotion,
  };
}

export function validateModeBody(body: unknown): {
  primaryAlias?: string;
  fallbackAlias?: string | null;
  useMemory?: boolean;
  useSummaries?: boolean;
  enabled?: boolean;
  allowedAliases?: string[];
} {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const hasField = [
    "primaryAlias",
    "fallbackAlias",
    "useMemory",
    "useSummaries",
    "enabled",
    "allowedAliases",
  ].some((k) => k in b);

  if (!hasField) {
    throw new ValidationError("At least one field must be provided");
  }

  if ("primaryAlias" in b && (typeof b.primaryAlias !== "string" || b.primaryAlias.length === 0)) {
    throw new ValidationError("primaryAlias must be a non-empty string");
  }
  if ("fallbackAlias" in b && b.fallbackAlias !== null && typeof b.fallbackAlias !== "string") {
    throw new ValidationError("fallbackAlias must be a string or null");
  }
  if ("useMemory" in b && typeof b.useMemory !== "boolean") {
    throw new ValidationError("useMemory must be a boolean");
  }
  if ("useSummaries" in b && typeof b.useSummaries !== "boolean") {
    throw new ValidationError("useSummaries must be a boolean");
  }
  if ("enabled" in b && typeof b.enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }
  if ("allowedAliases" in b) {
    const list = b.allowedAliases;
    if (!Array.isArray(list)) {
      throw new ValidationError("allowedAliases must be an array of model aliases");
    }
    if (list.length === 0) {
      throw new ValidationError("allowedAliases must contain at least one model");
    }
    if (list.some((a) => typeof a !== "string" || a.length === 0)) {
      throw new ValidationError("allowedAliases must contain non-empty strings");
    }
    if (new Set(list as string[]).size !== list.length) {
      throw new ValidationError("allowedAliases must not contain duplicates");
    }
  }

  return {
    primaryAlias: b.primaryAlias as string | undefined,
    fallbackAlias: b.fallbackAlias as string | null | undefined,
    useMemory: b.useMemory as boolean | undefined,
    useSummaries: b.useSummaries as boolean | undefined,
    enabled: b.enabled as boolean | undefined,
    allowedAliases: b.allowedAliases as string[] | undefined,
  };
}

export function validatePromptBody(body: unknown): { systemPrompt: string } {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.systemPrompt !== "string" || b.systemPrompt.trim().length === 0) {
    throw new ValidationError("systemPrompt must be a non-empty string");
  }
  if (b.systemPrompt.length > 4000) {
    throw new ValidationError("systemPrompt is too long (max 4000 chars)");
  }

  return { systemPrompt: b.systemPrompt.trim() };
}

export function validateModelBody(body: unknown): {
  displayName?: string;
  description?: string | null;
  enabled?: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if ("displayName" in b && (typeof b.displayName !== "string" || b.displayName.trim().length === 0)) {
    throw new ValidationError("displayName must be a non-empty string");
  }
  if ("description" in b && b.description !== null && typeof b.description !== "string") {
    throw new ValidationError("description must be a string or null");
  }
  if ("enabled" in b && typeof b.enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }

  return {
    displayName: b.displayName as string | undefined,
    description: b.description as string | null | undefined,
    enabled: b.enabled as boolean | undefined,
  };
}

export function validateLibraryBody(body: unknown): { alias: string; enabled: boolean } {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.alias !== "string" || b.alias.trim().length === 0) {
    throw new ValidationError("alias must be a non-empty string");
  }
  if (typeof b.enabled !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }

  return { alias: b.alias.trim(), enabled: b.enabled };
}

export function validateCategoryBody(body: unknown): { name: string } {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string") {
    throw new ValidationError("name must be a string");
  }
  const name = b.name.trim();
  if (name.length === 0) {
    throw new ValidationError("name must be a non-empty string");
  }
  if (name.length > 40) {
    throw new ValidationError("name is too long (max 40 chars)");
  }

  return { name };
}

export function validateSiteBody(body: unknown): { url: string } {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.url !== "string") {
    throw new ValidationError("'url' must be a valid website address");
  }
  const url = b.url.trim();
  if (url.length < 4 || url.length > 300) {
    throw new ValidationError("'url' must be a valid website address");
  }
  if (/\s/.test(url) || url.includes("<") || url.includes(">") || !url.includes(".")) {
    throw new ValidationError("'url' must be a valid website address");
  }

  return { url };
}

export function validateTrustEntryBody(body: unknown): {
  kind: "high" | "suffix" | "low";
  value: string;
} {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.kind !== "string" || !["high", "suffix", "low"].includes(b.kind)) {
    throw new ValidationError("kind must be 'high', 'suffix', or 'low'");
  }

  if (typeof b.value !== "string") {
    throw new ValidationError("'value' must be a non-empty string");
  }
  const value = b.value.trim();
  if (value.length === 0) {
    throw new ValidationError("'value' must be a non-empty string");
  }
  if (value.length < 2 || value.length > 100) {
    throw new ValidationError("'value' must be between 2 and 100 characters");
  }
  if (/\s/.test(value) || value.includes("<") || value.includes(">")) {
    throw new ValidationError("'value' must not contain spaces or angle brackets");
  }

  return { kind: b.kind as "high" | "suffix" | "low", value };
}