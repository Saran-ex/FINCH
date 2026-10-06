import { useEffect, useState } from 'react';
import { FinchViewport } from '@/components/finch/FinchViewport';
import { LiquidGlassEnvironment } from '@/components/finch/LiquidGlassEnvironment';
import type { TurnResponse, WebSource, SearchSourceKind } from '@/lib/api';
import { getRecentTurn } from '@/lib/api';
import { useModeModels, resolveModelValue } from "@/lib/useModeModels";
import { GlassResearchField } from "@/components/finch/GlassResearchField";
import { ExpandedInformation } from "@/components/finch/ExpandedInformation";
import { toResearchGlassItems, toDirectionItems, type ResearchCardItem } from "@/lib/cardMapping";

const stages = ['Understanding context…', 'Reviewing conversation…', 'Connecting related information…', 'Analyzing relationships…', 'Building research…', 'Research complete.'];

export function ResearchMode({
  onSubmit,
  selectedModel,
  voiceResult,
  onVoiceResultConsumed,
}: {
  onSubmit: (query: string, modelOverride?: string, researchPath?: string[], researchCategory?: string) => Promise<TurnResponse>;
  selectedModel?: string | undefined;
  voiceResult?: TurnResponse | null;
  onVoiceResultConsumed?: () => void;
}) {
  const [stage, setStage] = useState(0);
  const [complete, setComplete] = useState(false);
  const [reply, setReply] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sources, setSources] = useState<WebSource[]>([]);
  const [searchSource, setSearchSource] = useState<SearchSourceKind | undefined>(undefined);
  const [cards, setCards] = useState<ReturnType<typeof toResearchGlassItems>>([]);
  const [selected, setSelected] = useState<ResearchCardItem | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [directions, setDirections] = useState<ResearchCardItem[]>([]);
  const [lastQuery, setLastQuery] = useState('');
  const { options, defaultAlias } = useModeModels("research");

  useEffect(() => {
    if (stage >= stages.length - 1) {
      const finish = window.setTimeout(() => setComplete(true), 600);
      return () => window.clearTimeout(finish);
    }
    const timer = window.setTimeout(() => setStage((current) => current + 1), 580);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const applyResult = (result: TurnResponse) => {
    setReply(result.reply);
    setSources(result.webSources ?? []);
    setSearchSource(result.searchSource);
    if (result.directions && result.directions.length > 0) {
      setDirections(toDirectionItems(result.directions));
      setCards([]);
      setSelected(null);
    } else {
      setCards(toResearchGlassItems(result.topicCards ?? [], result.webSources ?? []));
      setDirections([]);
    }
  };

  // A voice result is already fetched: only update the screen, never call onSubmit again.
  useEffect(() => {
    if (!voiceResult) return;
    setLastQuery(voiceResult.request || '');
    setPath([]);
    setStage(0);
    setComplete(false);
    setSelected(null);
    applyResult(voiceResult);
    onVoiceResultConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceResult]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const turn = await getRecentTurn("research", 24);
      if (cancelled || !turn) return;
      const payload = turn.payload;
      setReply(turn.reply ?? "");
      setSources((payload.webSources ?? []) as WebSource[]);
      setSearchSource((payload.searchSource ?? undefined) as SearchSourceKind | undefined);
      setLastQuery(turn.request ?? "");
      setPath(payload.researchPath ?? []);
      if (payload.directions && payload.directions.length > 0) {
        setDirections(toDirectionItems(payload.directions as never));
        setCards([]);
      } else {
        setCards(
          toResearchGlassItems(
            (payload.topicCards ?? []) as never,
            (payload.webSources ?? []) as never,
          ),
        );
        setDirections([]);
      }
      setSelected(null);
      setStage(0);
      setComplete(true);
      setIsSubmitting(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSubmit = async (queryText: string, submitPath: string[], category?: string) => {
    if (!queryText.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setStage(0);
    setComplete(false);
    setReply('');
    setSources([]);
    setSearchSource(undefined);
    setCards([]);
    setSelected(null);
    setDirections([]);
    try {
      const result = await onSubmit(
        queryText.trim(),
        resolveModelValue(options, defaultAlias, selectedModel),
        submitPath,
        category,
      );
      applyResult(result);
    } catch (err) {
      setReply('Unable to reach the backend. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectionSelect = (item: ResearchCardItem) => {
    const nextPath = [...path, item.title];
    setPath(nextPath);
    runSubmit(lastQuery, nextPath, item.aiCategory);
  };

  return (
    <LiquidGlassEnvironment active={!complete}>
      <section className='mode-scene discovery-scene research-scene' aria-label='Research mode'>
        <FinchViewport immersed />
        {(!complete || isSubmitting) && (
          <div className='process-status research-status' aria-live='polite'>
            <span />
            {isSubmitting
              ? (stage >= stages.length - 2
                  ? 'Still working… this can take a minute'
                  : stages[Math.min(stage, stages.length - 2)])
              : stages[stage]}
          </div>
        )}
        <div aria-live='polite' style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{reply}</div>
        {complete && !isSubmitting && directions.length > 0 && (
          <GlassResearchField items={directions} onSelect={(item) => handleDirectionSelect(item as ResearchCardItem)} />
        )}
        {complete && !isSubmitting && directions.length === 0 && cards.length > 0 && (
          <GlassResearchField items={cards} onSelect={(item) => setSelected(item as ResearchCardItem)} />
        )}
        {selected && (
          <ExpandedInformation
            eyebrow={selected.category}
            title={selected.title}
            detail={selected.detail}
            connections={selected.connections}
            {...(selected.image ? { image: selected.image } : {})}
            {...(selected.links && selected.links.length > 0 ? { links: selected.links } : {})}
            onClose={() => setSelected(null)}
          />
        )}
      </section>
    </LiquidGlassEnvironment>
  );
}
