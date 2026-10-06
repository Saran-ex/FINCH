import { FormEvent, useEffect, useState } from 'react';
import { ArrowUp, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FinchViewport } from '@/components/finch/FinchViewport';
import { LiquidGlassEnvironment } from '@/components/finch/LiquidGlassEnvironment';
import type { TurnResponse, WebSource, SearchSourceKind } from '@/lib/api';
import { getRecentTurn } from '@/lib/api';
import { useModeModels, resolveModelValue } from "@/lib/useModeModels";
import { GlassResult } from "@/components/finch/GlassResult";
import { ExpandedInformation } from "@/components/finch/ExpandedInformation";
import { toSearchGlassResults, type SearchCardResult } from "@/lib/cardMapping";

const stages = ['Searching…', 'Finding sources…', 'Comparing information…', 'Collecting results…'];

export function SearchMode({
  onSubmit,
  selectedModel,
}: {
  onSubmit: (query: string, modelOverride?: string) => Promise<TurnResponse>;
  selectedModel?: string | undefined;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [stage, setStage] = useState(0);
  const [reply, setReply] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sources, setSources] = useState<WebSource[]>([]);
  const [searchSource, setSearchSource] = useState<SearchSourceKind | undefined>(undefined);
  const [cards, setCards] = useState<ReturnType<typeof toSearchGlassResults>>([]);
  const [selected, setSelected] = useState<SearchCardResult | null>(null);
  const { options, defaultAlias } = useModeModels("search");

  useEffect(() => {
    if (!searching) return;
    if (stage >= stages.length - 1) {
      const finish = window.setTimeout(() => { setSearching(false); }, 650);
      return () => window.clearTimeout(finish);
    }
    const timer = window.setTimeout(() => setStage((current) => current + 1), 650);
    return () => window.clearTimeout(timer);
  }, [searching, stage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const turn = await getRecentTurn("search", 24);
      if (cancelled || !turn) return;
      // Only populate if the screen is still empty (fresh mount, no prior submit).
      setReply(turn.reply ?? "");
      setSources((turn.payload.webSources ?? []) as WebSource[]);
      setSearchSource((turn.payload.searchSource ?? undefined) as SearchSourceKind | undefined);
      setCards(
        toSearchGlassResults(
          (turn.payload.topicCards ?? []) as never,
          (turn.payload.webSources ?? []) as never,
        ),
      );
      setSelected(null);
      setStage(0);
      setSearching(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setStage(0);
    setSearching(true);
    setReply('');
    setSources([]);
    setSearchSource(undefined);
    setCards([]);
    setSelected(null);
    try {
      const result = await onSubmit(
        query.trim(),
        resolveModelValue(options, defaultAlias, selectedModel),
      );
      setReply(result.reply);
      setSources(result.webSources ?? []);
      setSearchSource(result.searchSource);
      setCards(toSearchGlassResults(result.topicCards ?? [], result.webSources ?? []));
    } catch (err) {
      setReply('Unable to reach the backend. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <LiquidGlassEnvironment active={searching}>
      <section className='mode-scene discovery-scene' aria-label='Search mode'>
        <FinchViewport immersed />
        {(searching || isSubmitting) && (
          <div className='process-status' aria-live='polite'>
            <span />
            {isSubmitting
              ? (stage >= stages.length - 1
                  ? 'Still working… this can take a minute'
                  : stages[Math.min(stage, stages.length - 1)])
              : stages[stage]}
          </div>
        )}
        <div aria-live='polite' style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{reply}</div>
        {!isSubmitting && cards.length > 0 && (
          <div className='information-field search-field'>
            {cards.map(card => <GlassResult key={card.id} result={card} onSelect={() => setSelected(card)} />)}
          </div>
        )}
        {selected && (
          <ExpandedInformation
            eyebrow={selected.category}
            title={selected.title}
            detail={selected.detail}
            {...(selected.image ? { image: selected.image } : {})}
            {...(selected.links && selected.links.length > 0 ? { links: selected.links } : {})}
            onClose={() => setSelected(null)}
          />
        )}
        <form className='search-composer' onSubmit={submit}>
          <Search aria-hidden='true' />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search beyond the surface'
            aria-label='Search with Finch'
            disabled={isSubmitting}
          />
          <Button
            variant='glassIcon'
            size='icon'
            type='submit'
            aria-label='Begin search'
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className='size-5 animate-spin' /> : <ArrowUp />}
          </Button>
        </form>
      </section>
    </LiquidGlassEnvironment>
  );
}
