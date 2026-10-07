import fs from "node:fs";
import path from "node:path";
import { config } from "../config/index.js";

// Per-user app-data folder (LOG_DIR env override) — created on first run so
// logs never land inside the backend package itself.
const logsDir = config.logDir;
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const appLogPath = path.join(logsDir, "app.log");
const errorLogPath = path.join(logsDir, "error.log");

const levelPriority: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredPriority = levelPriority[config.logLevel] ?? 1;

function shouldLog(level: string): boolean {
  return levelPriority[level] >= configuredPriority;
}

function writeLog(
  level: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    meta: meta ?? {},
  };

  const line = JSON.stringify(entry) + "\n";

  try {
    fs.appendFileSync(appLogPath, line);

    if (level === "error") {
      fs.appendFileSync(errorLogPath, line);
    }
  } catch (err) {
    console.error("[logger] Failed to write log:", err);
  }

  if (config.nodeEnv !== "production") {
    const prefix = `[${entry.ts}] ${level.toUpperCase()}:`;
    if (level === "error") {
      console.error(prefix, message, meta ?? "");
    } else if (level === "warn") {
      console.warn(prefix, message, meta ?? "");
    } else {
      console.log(prefix, message, meta ?? "");
    }
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    writeLog("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) =>
    writeLog("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    writeLog("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) =>
    writeLog("error", msg, meta),
};

// One line per voice-pipeline stage. `voiceTurn` is the shared id sent by the
// frontend ("-" for typed, non-voice turns) so all stages of one voice turn
// can be grepped together:  timing turn=vt-... stage=transcribe-done ms=843
// Measurement stages: transcribe-done (whisper), first-token (Qwen TTFT),
// first-audio-after-text (proxy for Piper/Kitten first-audio).
export function timingLine(
  voiceTurn: string,
  stage: string,
  ms: number,
  extra?: string,
): string {
  return `timing turn=${voiceTurn} stage=${stage} ms=${ms}${extra ? ` ${extra}` : ""}`;
}
