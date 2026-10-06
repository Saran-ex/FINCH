import type { Mode } from "@/types/mode";

export type ThemeSettings = {
  theme: "light" | "dark" | "system";
  glassIntensity: number;
};

export type ModeSettings = {
  enabled: Record<Mode, boolean>;
  defaultMode: Mode;
};

export type MemoryEntry = {
  id: string;
  timestamp: string;
  mode: Mode;
  userMessage: string;
  finchReply: string;
  summary?: string;
  edited?: boolean;
  editedAt?: string;
};

export type ControlRoomState = {
  theme: ThemeSettings;
  modes: ModeSettings;
  memory: MemoryEntry[];
};
