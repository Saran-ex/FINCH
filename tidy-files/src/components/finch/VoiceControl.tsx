import { Mic, Pause, Radio, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { VoiceState } from "@/types/mode";

const stateMeta = {
  idle: { label: "Speak with Finch", Icon: Mic },
  waiting: { label: "Listening for “Hey Finch”", Icon: Radio },
  listening: { label: "Listening", Icon: Pause },
  thinking: { label: "Thinking", Icon: Mic },
  speaking: { label: "Speaking", Icon: Volume2 },
  error: { label: "Error", Icon: Mic },
};

interface VoiceControlProps {
  state: VoiceState;
  onClick: () => void;
  disabled?: boolean;
}

export function VoiceControl({ state, onClick, disabled = false }: VoiceControlProps) {
  const { label, Icon } = stateMeta[state] || stateMeta.idle;
  const isActive = state === "listening" || state === "thinking";

  return (
    <div className="voice-dock">
      <span className="voice-label" aria-live="polite">
        {state === "idle" ? "Ready" : label}
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="voice"
              size="voice"
              aria-label={label}
              data-state={state}
              onClick={onClick}
              disabled={disabled}
            >
              <span className="voice-ring" aria-hidden="true" />
              <Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
