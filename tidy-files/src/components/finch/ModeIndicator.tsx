import type { Mode } from "@/types/mode";
import { Button } from "@/components/ui/button";

const modes: Mode[] = ["conversation", "plan", "search", "research"];

interface ModeIndicatorProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeIndicator({ mode, onChange }: ModeIndicatorProps) {
  return (
    <nav className="mode-indicator" aria-label="Finch modes">
      {modes.map((item) => (
        <Button
          type="button"
          key={item}
          variant="mode"
          className="mode-option"
          data-active={mode === item}
          aria-current={mode === item ? "page" : undefined}
          onClick={() => onChange(item)}
        >
          <span className="mode-dot" />
          {item}
        </Button>
      ))}
    </nav>
  );
}
