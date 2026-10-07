import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { controlRoomStore } from "@/lib/controlRoomStore";
import { useControlRoom } from "@/lib/controlRoomStore";

export function ThemePanel() {
  const { theme } = useControlRoom();

  const handleThemeChange = (value: "light" | "dark" | "system") => {
    controlRoomStore.setTheme({ theme: value });
  };

  const handleGlassIntensityChange = (value: number[]) => {
    controlRoomStore.setTheme({ glassIntensity: value[0] ?? 60 });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xs uppercase tracking-wider text-zinc-500">Appearance</h2>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-zinc-500">Theme</label>
        <ToggleGroup
          type="single"
          value={theme.theme}
          onValueChange={handleThemeChange}
          className="flex gap-2"
        >
          <ToggleGroupItem value="light" className="px-3 py-1.5 text-xs">
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="px-3 py-1.5 text-xs">
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="system" className="px-3 py-1.5 text-xs">
            System
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wider text-zinc-500">Glass intensity</label>
          <span className="text-xs text-zinc-600 font-mono">{theme.glassIntensity}%</span>
        </div>
        <Slider
          value={[theme.glassIntensity]}
          onValueChange={handleGlassIntensityChange}
          max={100}
          step={5}
          min={0}
          className="w-full"
          aria-label="Glass intensity"
        />
      </div>
    </div>
  );
}

import * as React from "react";
