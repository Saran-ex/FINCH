import type { VoiceState } from "@/types/mode";

interface FinchOrbProps {
  voiceState?: VoiceState;
}

export function FinchOrb({ voiceState = "idle" }: FinchOrbProps) {
  return (
    <div className="finch-orb-stage" data-state={voiceState} aria-hidden="true">
      <div className="finch-orb-aura" />
      <div className="finch-orb" />
      <div className="finch-orb-ground" />
    </div>
  );
}
