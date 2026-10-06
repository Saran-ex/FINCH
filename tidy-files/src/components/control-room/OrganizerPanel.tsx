import * as React from "react";
import { ModelPicker } from "@/components/finch/ModelPicker";
import { VoiceEnginePicker } from "@/components/finch/VoiceEnginePicker";
import {
  resolveModelValue,
  refreshModeModels,
  useModeModels,
  type ModeModels,
} from "@/lib/useModeModels";
import {
  getModelLibrary,
  setLibraryModelEnabled,
  setModeAllowedModels,
  type LibraryModel,
  type ModeModelConfig,
  type ModelLibrary,
} from "@/lib/api";
import {
  ORGANIZER_MODES,
  setOrganizerModel,
  setOrganizerVoiceEngine,
  useOrganizer,
  type OrganizerMode,
} from "@/lib/organizerStore";
import { computeModelFallbackPlan, type ModeAllowedSets } from "@/lib/modelLibrary";

const MODE_LABELS: Record<OrganizerMode, string> = {
  conversation: "Conversation",
  search: "Search",
  research: "Research",
  plan: "Plan",
};

const MODE_BLURBS: Record<OrganizerMode, string> = {
  conversation:
    "Models Finch may use while you talk. Tick as many as you like, then pick the one to use now.",
  search: "Models Finch may use for Search queries.",
  research: "Models Finch may use for Research queries.",
  plan: "Models Finch may use for Plan mode.",
};

type Notice = { tone: "info" | "error"; text: string };

// Every mode's model picker, bound to the persisted per-mode active pick.
function ActiveModelSetting({ mode, state }: { mode: OrganizerMode; state: ModeModels }) {
  const { models } = useOrganizer();

  if (state.loading || state.options.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs uppercase tracking-wider text-zinc-500">Active model</span>
      <ModelPicker
        options={state.options}
        defaultAlias={state.defaultAlias}
        value={models[mode]}
        onChange={(alias) => setOrganizerModel(mode, alias)}
        loading={state.loading}
      />
    </div>
  );
}

// The allowed set for one mode, as chips. Filled chip = allowed; clicking adds
// or removes that model from the set. Wraps, so a 5th or 6th model just flows
// onto the next line.
function AllowedChips({
  mode,
  candidates,
  allowedAliases,
  busy,
  loading,
  onToggle,
}: {
  mode: OrganizerMode;
  candidates: LibraryModel[];
  allowedAliases: string[];
  busy: boolean;
  loading: boolean;
  onToggle: (model: LibraryModel, allow: boolean) => void;
}) {
  const label = MODE_LABELS[mode];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Allowed models</span>
        <span className="text-xs text-zinc-400">
          {allowedAliases.length} of {candidates.length} allowed
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="text-xs text-zinc-400">
          No models available — enable one in the Model library below.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.map((model) => {
            const on = allowedAliases.includes(model.alias);
            const lastOne = on && allowedAliases.length <= 1;
            const disabled = busy || loading || lastOne;
            return (
              <button
                key={model.alias}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                aria-label={`${on ? "Remove" : "Allow"} ${model.displayName} in ${label}`}
                title={lastOne ? `${label} must allow at least one model` : undefined}
                onClick={() => onToggle(model, !on)}
                className={[
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-black/70 bg-black text-white"
                    : "border-black/15 bg-white/70 text-zinc-600 hover:border-black/40 hover:bg-white",
                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={
                    on
                      ? "size-2 shrink-0 rounded-full bg-white"
                      : "size-2 shrink-0 rounded-full border border-zinc-400"
                  }
                />
                <span className="whitespace-nowrap">
                  {model.displayName}
                  <span className={on ? "text-white/60" : "text-zinc-400"}>
                    {" "}
                    — {model.ollamaModel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 p-4 bg-white/30 border border-white/40 rounded-xl">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-zinc-700">{title}</h2>
        <p className="text-xs text-zinc-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

// Settings → Organizer: the four modes are the main structure, each with its
// allowed model set and its active pick, then the machine-wide Model library.
export function OrganizerPanel() {
  const { models: modePicks, voiceEngine } = useOrganizer();

  const conversation = useModeModels("conversation");
  const search = useModeModels("search");
  const research = useModeModels("research");
  const plan = useModeModels("plan");
  const modeStates: Record<OrganizerMode, ModeModels> = {
    conversation,
    search,
    research,
    plan,
  };

  const [library, setLibrary] = React.useState<ModelLibrary | null>(null);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  const loadLibrary = React.useCallback(async () => {
    try {
      setLibrary(await getModelLibrary());
      setLibraryError(null);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "Could not load the model library");
    }
  }, []);

  React.useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // What a mode is actually using: its saved pick when it is still allowed,
  // otherwise the mode default. The four live pickers read the same rule, so
  // Organizer and the mode pages can never disagree.
  const effectiveValue = (mode: OrganizerMode): string | undefined =>
    resolveModelValue(modeStates[mode].options, modeStates[mode].defaultAlias, modePicks[mode]);

  const allowedFor = (mode: OrganizerMode): string[] =>
    modeStates[mode].options.map((option) => option.alias);

  const enabledModels = library?.models.filter((model) => model.enabled) ?? [];

  // Chips show every enabled library model. Until the library loads, fall back
  // to what the mode itself reports so the section is never blank.
  const chipCandidates = (mode: OrganizerMode): LibraryModel[] => {
    if (enabledModels.length > 0) return enabledModels;
    return modeStates[mode].options.map((option) => ({
      alias: option.alias,
      ollamaModel: option.alias,
      displayName: option.displayName,
      description: null,
      enabled: true,
    }));
  };

  const labelOf = (alias: string): string => {
    const inLibrary = library?.models.find((model) => model.alias === alias);
    if (inLibrary) return inLibrary.displayName;
    for (const mode of ORGANIZER_MODES) {
      const hit = modeStates[mode].options.find((option) => option.alias === alias);
      if (hit) return hit.displayName;
    }
    return alias;
  };

  // Rebuilds each considered mode's allowed set from the refreshed config so
  // the fallback is computed against exactly what its picker will show.
  const planFallback = (
    configs: ModeModelConfig[],
    removedAlias: string,
    usingBefore: Partial<Record<OrganizerMode, string | undefined>>,
    scope: OrganizerMode[],
  ) => {
    const allowedAfter: ModeAllowedSets = {};
    const defaultAfter: Partial<Record<OrganizerMode, string | undefined>> = {};
    for (const mode of scope) {
      const config = configs.find((c) => c.mode === mode);
      allowedAfter[mode] = config?.allowedModels.map((option) => option.alias) ?? [];
      defaultAfter[mode] = config?.defaultAlias;
    }
    return computeModelFallbackPlan({
      disabledAlias: removedAlias,
      allowedAfter,
      usingBefore,
      defaultAfter,
    });
  };

  const applyChanges = (changes: { mode: OrganizerMode; to: string }[]) => {
    for (const change of changes) setOrganizerModel(change.mode, change.to);
    if (changes.length === 0) return null;
    return changes
      .map((change) => `${MODE_LABELS[change.mode]} → ${labelOf(change.to)}`)
      .join(", ");
  };

  const handleLibraryToggle = async (model: LibraryModel, nextEnabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const usingBefore: Partial<Record<OrganizerMode, string | undefined>> = {};
      for (const mode of ORGANIZER_MODES) usingBefore[mode] = effectiveValue(mode);

      await setLibraryModelEnabled(model.alias, nextEnabled);
      const configs = await refreshModeModels();
      setLibrary(await getModelLibrary());

      if (nextEnabled) {
        setNotice({
          tone: "info",
          text: `${model.displayName} is enabled. Tick it in a mode below to allow it there.`,
        });
        return;
      }

      const changes = planFallback(configs, model.alias, usingBefore, [...ORGANIZER_MODES]);
      const switched = applyChanges(changes);
      const removed = `${model.displayName} was disabled and removed from every mode's allowed list.`;
      setNotice({
        tone: "info",
        text: switched ? `${removed} Switched: ${switched}.` : removed,
      });
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not update the model library.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAllowToggle = async (mode: OrganizerMode, model: LibraryModel, allow: boolean) => {
    if (busy || modeStates[mode].loading) return;
    const current = allowedFor(mode);
    const next = allow ? [...current, model.alias] : current.filter((a) => a !== model.alias);
    // A mode must always be able to offer at least one model.
    if (next.length === 0) return;

    setBusy(true);
    try {
      const usingBefore = effectiveValue(mode);
      await setModeAllowedModels(mode, next);
      const configs = await refreshModeModels();

      const label = MODE_LABELS[mode];
      if (allow) {
        setNotice({ tone: "info", text: `${model.displayName} allowed in ${label}.` });
        return;
      }

      const changes = planFallback(configs, model.alias, { [mode]: usingBefore }, [mode]);
      const switched = applyChanges(changes);
      setNotice({
        tone: "info",
        text: switched
          ? `${model.displayName} removed from ${label}. Switched: ${switched}.`
          : `${model.displayName} removed from ${label}.`,
      });
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not update the allowed models.",
      });
    } finally {
      setBusy(false);
    }
  };

  const modeSection = (mode: OrganizerMode, extra?: React.ReactNode) => {
    const state = modeStates[mode];
    const allowed = allowedFor(mode);
    return (
      <Section key={mode} title={MODE_LABELS[mode]} description={MODE_BLURBS[mode]}>
        <AllowedChips
          mode={mode}
          candidates={chipCandidates(mode)}
          allowedAliases={allowed}
          busy={busy}
          loading={state.loading}
          onToggle={(model, allow) => void handleAllowToggle(mode, model, allow)}
        />
        <ActiveModelSetting mode={mode} state={state} />
        {extra}
      </Section>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xs uppercase tracking-wider text-zinc-500">Organizer</h2>

      {notice && (
        <p
          role="status"
          aria-live="polite"
          className={
            notice.tone === "error"
              ? "rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"
              : "rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
          }
        >
          {notice.text}
        </p>
      )}

      {modeSection(
        "conversation",
        <VoiceEnginePicker value={voiceEngine} onChange={setOrganizerVoiceEngine} />,
      )}
      {modeSection("search")}
      {modeSection("research")}
      {modeSection("plan")}

      <Section
        title="Model library"
        description="Detected from Ollama on this machine. Unticking a model removes it from every mode above — the model itself is never deleted."
      >
        {libraryError && (
          <p role="alert" className="text-sm text-red-600">
            {libraryError}
          </p>
        )}
        {!libraryError && library !== null && !library.ollamaReachable && (
          <p className="text-sm text-amber-700">
            Ollama is not responding, so no models could be detected.
          </p>
        )}
        {!libraryError &&
          library !== null &&
          library.ollamaReachable &&
          library.models.length === 0 && (
            <p className="text-sm text-zinc-500">
              No models installed yet — pull one with <code>ollama pull &lt;name&gt;</code>.
            </p>
          )}

        {library !== null && library.models.length > 0 && (
          <ul className="space-y-3">
            {library.models.map((model) => {
              const allowedIn = ORGANIZER_MODES.filter((mode) =>
                allowedFor(mode).includes(model.alias),
              ).length;
              return (
                <li key={model.alias}>
                  <label className="flex items-start gap-3 rounded-lg border border-white/50 bg-white/50 px-4 py-3 transition-colors hover:bg-white/70">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      disabled={busy || (model.enabled && enabledModels.length <= 1)}
                      onChange={(event) => void handleLibraryToggle(model, event.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-black"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-zinc-800">
                        {model.displayName} — {model.ollamaModel}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-400">
                        {model.enabled
                          ? `Allowed in ${allowedIn} of ${ORGANIZER_MODES.length} modes`
                          : "Disabled — hidden from every mode"}
                      </span>
                    </span>
                    <span
                      className={
                        model.enabled
                          ? "shrink-0 rounded-full bg-black px-2.5 py-1 text-[11px] text-white"
                          : "shrink-0 rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500"
                      }
                    >
                      {model.enabled ? "On" : "Off"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
