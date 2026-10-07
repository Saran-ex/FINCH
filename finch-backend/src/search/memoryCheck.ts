import os from "os";

export const DEFAULT_RAM_LIMIT_PERCENT = 90;

export interface MemoryStatus {
  totalMB: number;
  freeMB: number;
  usedMB: number;
  usedPercent: number; // 0 to 100, rounded to 1 decimal
}

// Reads total and free RAM from the os module and reports usage in MB.
export function getMemoryStatus(): MemoryStatus {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const totalMB = Math.round(totalBytes / (1024 * 1024));
  const freeMB = Math.round(freeBytes / (1024 * 1024));
  const usedMB = Math.round((totalBytes - freeBytes) / (1024 * 1024));
  const usedPercent =
    Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10;
  return { totalMB, freeMB, usedMB, usedPercent };
}
