import { Button } from "@/components/ui/button";
import { Palette, Layers, Brain, FileText, Globe, SlidersHorizontal, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "theme" | "modes" | "memory" | "prompts" | "resources" | "organizer" | "about";

interface TabBarProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "theme", label: "Theme", icon: Palette },
  { id: "modes", label: "Modes", icon: Layers },
  { id: "organizer", label: "Organizer", icon: SlidersHorizontal },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "prompts", label: "Prompts", icon: FileText },
  { id: "resources", label: "Resources", icon: Globe },
  { id: "about", label: "About", icon: Info },
];

export function TabBar({ activeTab, onChange }: TabBarProps) {
  const [focusedIndex, setFocusedIndex] = React.useState(0);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = focusedIndex;
    if (e.key === "ArrowRight") {
      newIndex = (focusedIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      newIndex = (focusedIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      newIndex = 0;
    } else if (e.key === "End") {
      newIndex = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    setFocusedIndex(newIndex);
    onChange(tabs[newIndex]!.id);
  };

  return (
    <nav className="control-room-tabbar" aria-label="Control room sections" role="tablist">
      <div className="tabbar-scroll">
        {tabs.map((tab, index) => (
          <Button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            variant="mode"
            className={cn(
              "mode-option tabbar-item",
              "gap-2 px-3 py-1.5",
              "data-[state=active]:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              activeTab === tab.id && "data-[state=active]",
            )}
            data-state={activeTab === tab.id ? "active" : "inactive"}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onFocus={() => setFocusedIndex(index)}
          >
            <tab.icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="mode-label">{tab.label}</span>
            <span className="mode-dot" aria-hidden="true" />
          </Button>
        ))}
      </div>
    </nav>
  );
}

import * as React from "react";
