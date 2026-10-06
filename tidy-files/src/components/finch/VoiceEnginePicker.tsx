import { useEffect, useState } from "react";
import { getVoiceHealth, type VoiceEngine } from "@/lib/api";

const ENGINE_OPTIONS: Array<{ value: VoiceEngine; label: string }> = [
  { value: "kokoro", label: "Kokoro (am_santa)" },
  { value: "kitten", label: "Kitten (Jasper)" },
  { value: "piper", label: "Piper (lessac)" },
];

// Voice engine selector shown next to the Conversation model picker. Mirrors
// ModelPicker: value = explicit per-conversation selection when set, else the
// server's configured default (from /api/voice/health), so an untouched
// selector keeps the pre-picker behaviour (backend env default).
export function VoiceEnginePicker({
  value,
  onChange,
}: {
  value?: VoiceEngine | undefined;
  onChange: (engine: VoiceEngine) => void;
}) {
  const [defaultEngine, setDefaultEngine] = useState<VoiceEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVoiceHealth()
      .then((health) => {
        if (!cancelled) setDefaultEngine(health.ttsEngine);
      })
      .catch(() => {
        // No health: display the known default (kokoro) — the picker still works.
        if (!cancelled) setDefaultEngine((prev) => prev ?? "kokoro");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const effective = value ?? defaultEngine;

  return (
    <div className="flex items-center gap-2 px-1 py-2 text-xs text-gray-500">
      <span className="text-gray-400">Voice:</span>
      <select
        value={effective ?? ""}
        onChange={(event) => onChange(event.target.value as VoiceEngine)}
        disabled={effective === null}
        aria-label="Voice engine"
        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white/80 text-gray-700 focus:outline-none focus:ring-1 focus:ring-black/20 disabled:opacity-50 cursor-pointer"
      >
        {effective === null && <option value="">Loading…</option>}
        {ENGINE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
