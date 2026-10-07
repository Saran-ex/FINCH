import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Mode } from "@/types/mode";
import { cn } from "@/lib/utils";
import { Copy, RotateCcw } from "lucide-react";
import {
  getControlPrompts,
  putControlPrompt,
  resetControlPrompt,
  type ControlPrompt,
} from "@/lib/api";

const MODES: Mode[] = ["conversation", "plan", "search", "research"];

const MODE_LABELS: Record<Mode, string> = {
  conversation: "Conversation",
  plan: "Plan",
  search: "Search",
  research: "Research",
};

function emptyByMode<T>(build: () => T): Record<Mode, T> {
  return {
    conversation: build(),
    plan: build(),
    search: build(),
    research: build(),
  };
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function PromptsPanel() {
  const [activeMode, setActiveMode] = React.useState<Mode>("conversation");
  const [saved, setSaved] = React.useState<Record<Mode, ControlPrompt | null>>(() =>
    emptyByMode(() => null),
  );
  const [drafts, setDrafts] = React.useState<Record<Mode, string>>(() => emptyByMode(() => ""));
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prompts = await getControlPrompts();
        if (cancelled) return;
        const nextSaved = {} as Record<Mode, ControlPrompt>;
        const nextDrafts = {} as Record<Mode, string>;
        for (const prompt of prompts) {
          const mode = prompt.mode as Mode;
          nextSaved[mode] = prompt;
          nextDrafts[mode] = prompt.systemPrompt;
        }
        setSaved(nextSaved);
        setDrafts(nextDrafts);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(toError(err, "Failed to load prompts"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prompt = drafts[activeMode];
  const savedPrompt = saved[activeMode];
  const isDirty = savedPrompt !== null && prompt !== savedPrompt.systemPrompt;

  const handlePromptChange = (value: string) => {
    setDrafts((prev) => ({ ...prev, [activeMode]: value }));
    setSavedFlash(false);
    setError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSavedFlash(false);
    setError(null);
    try {
      const updated = await putControlPrompt(activeMode, prompt);
      setSaved((prev) => ({ ...prev, [activeMode]: updated }));
      setDrafts((prev) => ({ ...prev, [activeMode]: updated.systemPrompt }));
      setSavedFlash(true);
    } catch (err) {
      setError(toError(err, "Failed to save prompt"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (saving) return;
    setSaving(true);
    setSavedFlash(false);
    setError(null);
    try {
      const updated = await resetControlPrompt(activeMode);
      setSaved((prev) => ({ ...prev, [activeMode]: updated }));
      setDrafts((prev) => ({ ...prev, [activeMode]: updated.systemPrompt }));
      setSavedFlash(true);
    } catch (err) {
      setError(toError(err, "Failed to reset prompt"));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">System Prompts</h2>
        <p className="text-xs text-zinc-500">What Finch is told before every reply, per mode.</p>
      </div>

      <ToggleGroup
        type="single"
        value={activeMode}
        onValueChange={(value: string) => setActiveMode(value as Mode)}
        className="flex gap-1 bg-white/30 border border-white/40 rounded-lg p-1"
        role="tablist"
        aria-label="Prompt modes"
      >
        {MODES.map((mode) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            role="tab"
            aria-selected={activeMode === mode}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              "data-[state=on]:bg-white/60 data-[state=on]:text-foreground data-[state=on]:shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            {MODE_LABELS[mode]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {error && (
        <p
          role="alert"
          className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="space-y-4">
        <label className="text-xs uppercase tracking-wider text-zinc-500">
          System prompt for {MODE_LABELS[activeMode]}
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          className="min-h-[200px] font-mono text-sm"
          rows={10}
          placeholder={loading ? "Loading prompts…" : "Enter system prompt…"}
          aria-label={`System prompt for ${MODE_LABELS[activeMode]}`}
          disabled={loading}
        />

        <div className="flex items-center justify-between pt-2 border-t border-white/40">
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span className="font-mono">{prompt.length} characters</span>
            {isDirty && (
              <span className="text-amber-600 font-medium" data-testid="unsaved-indicator">
                Unsaved changes
              </span>
            )}
            {savedPrompt?.updatedAt && (
              <span>Last updated: {formatRelativeTime(savedPrompt.updatedAt)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedFlash && <span className="text-xs text-green-600 font-medium">Saved</span>}
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={loading || saving}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading || saving} className="gap-1.5">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import * as React from "react";
