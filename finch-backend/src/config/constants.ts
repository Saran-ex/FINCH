export const MODES = ["conversation", "plan", "search", "research"] as const;
export type Mode = (typeof MODES)[number];
