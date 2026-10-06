import * as React from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  postMemorySummarize,
  getMemorySummarizeStatus,
  confirmMemoryBatch,
  discardMemoryBatch,
  getMemoryBox,
  getModeMessages,
  getControlModels,
  ApiRequestError,
  type MemorySummarizeStatus,
  type SavedMemoryEntry,
  type ModeMessage,
  type ModeModelOption,
} from "@/lib/api";
import { ModelPicker } from "@/components/finch/ModelPicker";
import type { Mode } from "@/types/mode";
import { cn } from "@/lib/utils";

// Preferred model for memory summarization (initial value + picker fallback).
const DEFAULT_SUMMARIZE_ALIAS = "finch-3";

const MODE_LABELS: Record<Mode, string> = {
  conversation: "Conversation",
  plan: "Plan",
  search: "Search",
  research: "Research",
};

type MemoryView = Mode | "memory-box";

const VIEW_ORDER: MemoryView[] = ["conversation", "plan", "search", "research", "memory-box"];

const VIEW_LABELS: Record<MemoryView, string> = {
  ...MODE_LABELS,
  "memory-box": "Memory box",
};

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  finch: "Finch",
};

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function toTimeLabel(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : iso;
}

function clipText(text: string): string {
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

function parseSourceIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
}

function formatModes(modes: string | string[]): string {
  return Array.isArray(modes) ? modes.join(", ") : modes;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const MEMORY_BOX_JOB_KEY = "finch.memorybox.job";

const BOX_MODE_ORDER: Mode[] = ["conversation", "plan", "research", "search"];

function formatDeletedByMode(deletedByMode: Record<string, number>): string {
  return BOX_MODE_ORDER.map((mode) => `${mode} ${deletedByMode[mode] ?? 0}`).join(", ");
}

export function MemoryPanel() {
  const [activeView, setActiveView] = React.useState<MemoryView>("conversation");
  const [modeMessages, setModeMessages] = React.useState<ModeMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [messagesError, setMessagesError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [summarizeJobId, setSummarizeJobId] = React.useState<string | null>(null);
  const [summarizePhase, setSummarizePhase] = React.useState<
    "idle" | "running" | "done" | "failed"
  >("idle");
  const [summarizeStatus, setSummarizeStatus] = React.useState<MemorySummarizeStatus | null>(null);
  const [summarizeError, setSummarizeError] = React.useState<string | null>(null);
  const [summarizeStartedAt, setSummarizeStartedAt] = React.useState<number>(0);
  const [, setElapsedTick] = React.useState(0);
  const [summarizeModel, setSummarizeModel] = React.useState<string>(DEFAULT_SUMMARIZE_ALIAS);
  const [modelOptions, setModelOptions] = React.useState<ModeModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(true);

  const isSummarizing = summarizePhase === "running";

  const elapsedSeconds =
    isSummarizing && summarizeStartedAt > 0
      ? Math.floor((Date.now() - summarizeStartedAt) / 1000)
      : 0;

  React.useEffect(() => {
    if (!isSummarizing) return;
    const timer = window.setInterval(() => setElapsedTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isSummarizing]);

  React.useEffect(() => {
    if (!summarizeJobId || summarizePhase !== "running") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await getMemorySummarizeStatus(summarizeJobId);
        if (cancelled) return;
        if (status.error || (status.status !== "running" && status.status !== "done")) {
          window.localStorage.removeItem(MEMORY_BOX_JOB_KEY);
          setSummarizeStatus(status);
          if (status.error) setSummarizeError(status.error);
          setSummarizePhase("failed");
          return;
        }
        if (status.status === "done") {
          setSummarizeStatus(status);
          setSummarizePhase("done");
        }
      } catch (err) {
        if (cancelled) return;
        window.localStorage.removeItem(MEMORY_BOX_JOB_KEY);
        if (err instanceof ApiRequestError && err.status === 404) {
          setSummarizeError("The previous summary job was lost. Please run it again.");
        } else {
          setSummarizeError(err instanceof Error ? err.message : String(err));
        }
        setSummarizePhase("failed");
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [summarizeJobId, summarizePhase]);

  React.useEffect(() => {
    let cancelled = false;
    getControlModels()
      .then((rows) => {
        if (!cancelled) setModelOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartSummarize = async (days: 7 | 30) => {
    setSummarizeError(null);
    setSummarizeStatus(null);
    setResultMessage(null);
    try {
      const { jobId } = await postMemorySummarize(days, summarizeModel);
      window.localStorage.setItem(MEMORY_BOX_JOB_KEY, jobId);
      setSummarizeStartedAt(Date.now());
      setSummarizeJobId(jobId);
      setSummarizePhase("running");
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirm = async () => {
    const preview = summarizeStatus?.preview;
    if (!preview) return;
    setBatchBusy(true);
    setSummarizeError(null);
    try {
      const result = await confirmMemoryBatch(preview.id);
      window.localStorage.removeItem(MEMORY_BOX_JOB_KEY);
      setShowConfirmDialog(false);
      setSummarizeStatus(null);
      setSummarizeJobId(null);
      setSummarizePhase("idle");
      setResultMessage(
        `Saved. Deleted ${result.deletedTotal} messages (${formatDeletedByMode(result.deletedByMode)})`
      );
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchBusy(false);
    }
  };

  const handleDiscard = async () => {
    const preview = summarizeStatus?.preview;
    if (!preview) return;
    setBatchBusy(true);
    setSummarizeError(null);
    try {
      await discardMemoryBatch(preview.id);
      window.localStorage.removeItem(MEMORY_BOX_JOB_KEY);
      setSummarizeStatus(null);
      setSummarizeJobId(null);
      setSummarizePhase("idle");
      setResultMessage("Discarded. No messages were deleted.");
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchBusy(false);
    }
  };

  const deletedMessageIds = React.useMemo(() => {
    const preview = summarizeStatus?.preview;
    if (!preview) return [] as number[];
    const ids = new Set<number>();
    for (const entry of preview.entries) {
      for (const id of parseSourceIds(entry.source_message_ids)) ids.add(id);
    }
    return Array.from(ids);
  }, [summarizeStatus]);

  const [batchBusy, setBatchBusy] = React.useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);
  const [boxEntries, setBoxEntries] = React.useState<SavedMemoryEntry[]>([]);
  const [resultMessage, setResultMessage] = React.useState<string | null>(null);

  const loadBox = async () => {
    try {
      setBoxEntries(await getMemoryBox());
    } catch {
      setBoxEntries([]);
    }
  };

  React.useEffect(() => {
    const savedJobId = window.localStorage.getItem(MEMORY_BOX_JOB_KEY);
    if (savedJobId) {
      setSummarizeStartedAt(Date.now());
      setSummarizeJobId(savedJobId);
      setSummarizePhase("running");
    }
  }, []);

  React.useEffect(() => {
    if (activeView === "memory-box") {
      void loadBox();
      return;
    }

    const mode = activeView;
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);

    getModeMessages(mode, 200)
      .then((rows) => {
        if (cancelled) return;
        setModeMessages(rows);
        setMessagesLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModeMessages([]);
        setMessagesError(err instanceof Error ? err.message : String(err));
        setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, refreshTick]);

  const groupedMessages = React.useMemo(() => {
    const groups: { key: string; items: ModeMessage[] }[] = [];
    for (const message of modeMessages) {
      const key = toDateKey(message.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(message);
      } else {
        groups.push({ key, items: [message] });
      }
    }
    return groups;
  }, [modeMessages]);

  const groupedBox = React.useMemo(() => {
    const sorted = [...boxEntries].sort((a, b) => b.date_start.localeCompare(a.date_start));
    const groups: { key: string; items: SavedMemoryEntry[] }[] = [];
    for (const entry of sorted) {
      const key = entry.date_start;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(entry);
      } else {
        groups.push({ key, items: [entry] });
      }
    }
    return groups;
  }, [boxEntries]);

  return (
    <div className="space-y-6">
      <section className="space-y-4 p-4 bg-white/30 border border-white/40 rounded-xl">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">Memory box</h2>

        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            type="single"
            value={activeView}
            onValueChange={(value: string) => {
              if (value) setActiveView(value as MemoryView);
            }}
            className="flex gap-1 bg-white/30 border border-white/40 rounded-lg p-1"
            role="tablist"
            aria-label="Memory views"
          >
            {VIEW_ORDER.map((view) => (
              <ToggleGroupItem
                key={view}
                value={view}
                role="tab"
                aria-selected={activeView === view}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  "data-[state=on]:bg-white/60 data-[state=on]:text-foreground data-[state=on]:shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                )}
              >
                {VIEW_LABELS[view]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={isSummarizing || batchBusy}>
                Summarize
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-white border-zinc-200">
                <AlertDialogHeader>
                  <AlertDialogTitle>Summarize which period?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Choose the period you want to summarize.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <ModelPicker
                  options={modelOptions}
                  defaultAlias={DEFAULT_SUMMARIZE_ALIAS}
                  value={summarizeModel}
                  onChange={setSummarizeModel}
                  disabled={isSummarizing || batchBusy}
                  loading={modelsLoading}
                />
                <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isSummarizing || batchBusy}
                  onClick={() => handleStartSummarize(7)}
                >
                  Last 7 days
                </AlertDialogAction>
                <AlertDialogAction
                  disabled={isSummarizing || batchBusy}
                  onClick={() => handleStartSummarize(30)}
                >
                  Last 30 days
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {summarizeError && (
          <p className="text-xs text-destructive">{summarizeError}</p>
        )}

        {isSummarizing && (
          <p className="text-sm text-zinc-600">
            Summarizing... (this can take a few minutes) — {formatElapsed(elapsedSeconds)} elapsed
          </p>
        )}

        {summarizePhase === "failed" && !summarizeError && (
          <p className="text-sm text-destructive">Summarize failed.</p>
        )}

        {summarizePhase === "done" && summarizeStatus && (
          <div className="space-y-4">
            {summarizeStatus.preview ? (
              <>
                <p className="text-xs text-zinc-500">
                  {summarizeStatus.preview.period_start} → {summarizeStatus.preview.period_end}
                  {" · "}{summarizeStatus.preview.source_msg_count} messages scanned
                  {" · batch "}{summarizeStatus.preview.id}
                </p>

                <div className="space-y-3">
                  {summarizeStatus.preview.entries.map((entry, index) => (
                    <div
                      key={`${entry.title}-${index}`}
                      className="space-y-1 p-3 rounded-lg bg-white/40 border border-white/40"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-900">{entry.title}</span>
                        <span className="text-xs text-zinc-500">{formatModes(entry.modes)}</span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {entry.date_start} → {entry.date_end}
                      </p>
                      <p className="text-sm text-zinc-700 whitespace-pre-wrap">
                        {entry.summary_text}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {parseSourceIds(entry.source_message_ids).length} messages will be deleted if confirmed
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-1 pt-3 border-t border-white/40">
                  <p className="text-xs text-zinc-500">
                    {deletedMessageIds.length} unique messages would be deleted
                  </p>
                  <p className="text-xs text-zinc-500">
                    {summarizeStatus.skippedIds ?? 0} kept unchanged
                  </p>
                  <p className="text-xs text-zinc-500">
                    {summarizeStatus.failedChunks ?? 0} failed chunks
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={batchBusy}
                    onClick={handleDiscard}
                  >
                    Discard
                  </Button>
                  <AlertDialog
                    open={showConfirmDialog}
                    onOpenChange={(open) => {
                      if (!open && batchBusy) return;
                      setShowConfirmDialog(open);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={batchBusy}>
                        Confirm and delete {deletedMessageIds.length} messages
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-white border-zinc-200">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Save this summary?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This saves {summarizeStatus.preview.entries.length} summaries permanently
                          and deletes {deletedMessageIds.length} original messages. Deleted messages
                          cannot be restored. {summarizeStatus.skippedIds ?? 0} messages stay
                          unchanged.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={batchBusy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={batchBusy} onClick={handleConfirm}>
                          Yes, save and delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-600">
                Nothing worth keeping was found. No messages will be deleted.
              </p>
            )}
          </div>
        )}

        {resultMessage && (
          <p className="text-sm text-zinc-600">{resultMessage}</p>
        )}

        <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {activeView === "memory-box" ? (
            boxEntries.length === 0 ? (
              <p className="p-3 text-sm text-zinc-500">No saved memories yet.</p>
            ) : (
              <div className="space-y-4 p-1">
                {groupedBox.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-zinc-500 px-2">{group.key}</p>
                    {group.items.map((entry) => (
                      <div
                        key={entry.id}
                        className="space-y-1 p-3 rounded-lg bg-white/40 border border-white/40"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-zinc-900">{entry.title}</span>
                          <span className="text-xs text-zinc-500">{formatModes(entry.modes)}</span>
                        </div>
                        <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">
                          {entry.summary_text}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          ) : messagesError ? (
            <p className="p-3 text-sm text-destructive">{messagesError}</p>
          ) : messagesLoading ? null : modeMessages.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500">No messages in this mode.</p>
          ) : (
            <div className="space-y-4 p-1">
              {groupedMessages.map((group) => (
                <div key={group.key} className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-zinc-500 px-2">{group.key}</p>
                  {group.items.map((message) => (
                    <div
                      key={message.id}
                      className="space-y-1 p-3 rounded-lg bg-white/40 border border-white/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500 font-mono">
                          {toTimeLabel(message.created_at)}
                        </span>
                        <span className="text-xs font-medium text-zinc-700">
                          {ROLE_LABELS[message.role] ?? message.role}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">
                        {clipText(message.content)}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
