import { FinchOrb } from "@/components/finch/FinchOrb";
import type { VoiceState } from "@/types/mode";

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 18) return "Good afternoon.";
  return "Good evening.";
}

export function ConversationMode({
  voiceState,
  onVoiceChange,
  speechError,
}: {
  voiceState: VoiceState;
  onVoiceChange: () => void;
  speechError?: string | null;
}) {
  return (
    <section className="mode-scene conversation-scene" aria-label="Conversation mode">
      <div className="scene-heading">
        <span className="scene-kicker">FINCH / 01</span>
        <h1>{timeOfDayGreeting()}</h1>
      </div>
      <FinchOrb voiceState={voiceState} />
      {/* The reply is spoken, not shown; this is the only fallback when the
          speaker never started. Stacked above the recognition-error pill. */}
      {speechError && (
        <div className="voice-error-notice" role="alert" style={{ bottom: "9.5rem" }}>
          {speechError}
        </div>
      )}
    </section>
  );
}
