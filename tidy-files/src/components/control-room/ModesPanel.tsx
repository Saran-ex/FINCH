import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { controlRoomStore } from "@/lib/controlRoomStore";
import type { Mode } from "@/types/mode";
import { useControlRoom } from "@/lib/controlRoomStore";

const MODES: { id: Mode; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { id: "conversation", icon: MessageSquare, description: "Natural chat with Finch" },
  { id: "plan", icon: ListTodo, description: "Structured planning and next steps" },
  { id: "search", icon: Search, description: "Find information on the web" },
  { id: "research", icon: BookOpen, description: "Deep, multi-step investigation" },
];

function MessageSquare({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ListTodo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M9 16H6" />
      <path d="M12 16H6" />
      <path d="M15 16H6" />
      <path d="M3 6h18" />
      <path d="M3 12h18" />
    </svg>
  );
}

function Search({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function BookOpen({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

export function ModesPanel() {
  const { modes } = useControlRoom();

  const handleToggleMode = (mode: Mode, enabled: boolean) => {
    controlRoomStore.toggleMode(mode, enabled);
  };

  const handleDefaultModeChange = (mode: Mode) => {
    controlRoomStore.setDefaultMode(mode);
  };

  const enabledCount = Object.values(modes.enabled).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <h2 className="text-xs uppercase tracking-wider text-zinc-500">Modes</h2>

      <div className="space-y-4" role="list" aria-label="Finch modes">
        {MODES.map(({ id, icon: Icon, description }) => {
          const enabled = modes.enabled[id];
          const isDefault = modes.defaultMode === id;

          return (
            <div
              key={id}
              className="flex items-start gap-4 p-4 rounded-xl bg-white/30 border border-white/40"
              role="listitem"
            >
              <div className="flex-shrink-0 size-10 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium text-zinc-900 capitalize">{id}</h3>
                  {isDefault && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Enabled</span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => handleToggleMode(id, checked)}
                    disabled={enabledCount === 1 && enabled}
                    aria-label={`${id} mode enabled`}
                  />
                </div>
                <RadioGroup
                  value={modes.defaultMode}
                  onValueChange={handleDefaultModeChange}
                  className="flex items-center gap-2"
                >
                  <RadioGroupItem
                    value={id}
                    id={`default-${id}`}
                    className="sr-only"
                    disabled={!enabled}
                  />
                  <label
                    htmlFor={`default-${id}`}
                    className={cn(
                      "text-xs text-zinc-500 cursor-pointer select-none transition-colors",
                      enabled ? "hover:text-zinc-700" : "opacity-40 cursor-not-allowed"
                    )}
                  >
                    Default
                  </label>
                </RadioGroup>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";
