import { logger } from "../services/logger.js";
import { config } from "../config/index.js";
import type { Mode } from "../config/constants.js";
import { routeMode } from "../modes/router.js";
import { resolveAllowedAliases, getDefaultAlias } from "../modes/manager.js";
import { getAlias, getAdapter, listAliases } from "../models/registry.js";
import { ollamaAdapter } from "../models/ollamaAdapter.js";
import { buildSystemPrompt, STREAM_REPLY_GUIDANCE } from "./promptBuilder.js";
import { MAX_REPLY_LENGTH, type ValidatedIntent } from "./responseValidator.js";
import type { StreamDeltaHandler } from "../models/adapter.js";
import { fallbackIntent } from "./fallbackIntent.js";
import { getOrCreateActiveConversation, maybeSetTitleFromFirstMessage } from "../memory/conversationService.js";
import { buildMemoryContext } from "../memory/retrieval.js";
import { addTurn } from "../memory/messageService.js";
import { routedSearch } from "../search/searchRouter.js";
import { getMemoryStatus } from "../search/memoryCheck.js";
import { rankAndFilterResults } from "../search/trust.js";
import { filterRelevant } from "../search/relevance.js";
import { buildSearchUserPrompt, SEARCH_CARDS_PROMPT_DRAFT, buildResearchDirectionsPrompt } from "../search/answerBuilder.js";
import { parseCardsJson, buildCardsPrompt, buildCardsFromSources, type TopicCard } from "../search/cardBuilder.js";
import { rewriteSearchQuery } from "../search/queryRewriter.js";
import { researchSearch } from "../search/researchSearch.js";
import { addWikipediaImages } from "../search/imageEnricher.js";
import { fetchQueryImages } from "../search/queryImageFetcher.js";
import { listResearchResourceCategoryNames, listResearchResourceSitesForCategory } from "../services/researchResources.js";
import { saveTurnResult } from "../services/turnResults.js";
import { searxngSiteSearch } from "../search/siteSearch.js";
import { SearchError } from "../search/searxngClient.js";
import type { SearchResult, SearchSource } from "../search/types.js";

function nowMs(): number { return Date.now(); }
function fmt(ms: number): string { return `${ms}ms`; }

// Interleaves site results with academic results (site first), dedupes by URL
// (first occurrence wins, so site results win ties) and caps at `max`.
// Never mutates the inputs.
function mergeWithSiteResults(
  siteResults: SearchResult[],
  academicResults: SearchResult[],
  max: number
): SearchResult[] {
  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  const rounds = Math.max(siteResults.length, academicResults.length);

  for (let i = 0; i < rounds && merged.length < max; i += 1) {
    const pair = [siteResults[i], academicResults[i]];
    for (const candidate of pair) {
      if (!candidate) continue;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      merged.push(candidate);
      if (merged.length >= max) break;
    }
  }

  return merged;
}

export type TurnInput = {
  transcript: string;
  currentMode: Mode;
  modelOverride?: string;
  researchPath?: string[];
  researchCategory?: string;
};

export type TurnResult = ValidatedIntent & {
  conversationId: number;
  webSources?: SearchResult[];
  searchSource?: SearchSource;
  topicCards?: TopicCard[];
  directions?: TopicCard[];
};

// Picks the model for this turn: override if allowed in this mode, otherwise
// the mode's normal selection (router primary/fallback). Any chosen alias is
// then checked against the mode's allowed list as a final guard.
function chooseAlias(input: TurnInput, transcript: string): string {
  const allowedAliases = resolveAllowedAliases(input.currentMode);
  let chosenAlias: string;
  if (input.modelOverride) {
    if (allowedAliases.includes(input.modelOverride)) {
      chosenAlias = input.modelOverride;
      logger.info("turn: using model override", { override: chosenAlias });
    } else {
      logger.warn("turn: model override not allowed for mode, using mode default", {
        override: input.modelOverride,
        currentMode: input.currentMode,
        allowed: allowedAliases,
      });
      chosenAlias = routeMode(input.currentMode, transcript).modelAlias;
    }
  } else {
    chosenAlias = routeMode(input.currentMode, transcript).modelAlias;
  }

  if (!allowedAliases.includes(chosenAlias)) {
    chosenAlias = getDefaultAlias(input.currentMode);
  }
  return chosenAlias;
}

export async function processTurn(input: TurnInput): Promise<TurnResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return {
      action: "answer",
      mode: input.currentMode,
      request: "",
      reply: "",
      source: "fallback",
      conversationId: 0,
    };
  }

  const conversation = getOrCreateActiveConversation(input.currentMode);
  maybeSetTitleFromFirstMessage(conversation.id, transcript);

  const chosenAlias = chooseAlias(input, transcript);

  logger.info("turn: routing", {
    currentMode: input.currentMode,
    chosenAlias,
    transcriptLen: transcript.length,
    conversationId: conversation.id,
  });

  const systemPrompt = buildSystemPrompt(input.currentMode);
  const alias = getAlias(chosenAlias);
  const adapter = getAdapter(chosenAlias);

  let validated: ValidatedIntent;
  let modelAliasForStorage: string | null = chosenAlias;
  let tokensIn = 0;
  let tokensOut = 0;
  let webSources: SearchResult[] | undefined;
  let searchSource: SearchSource | undefined;
  let topicCards: TopicCard[] = [];
  let directions: TopicCard[] | undefined = undefined;

  const rewriteGenerate = async (prompt: string): Promise<string> => {
    const r = await adapter.generate(alias.alias, alias.ollamaModel, prompt, {
      mode: input.currentMode,
      maxTokens: 30,
      temperature: 0,
    });
    return r.text;
  };

  // For plan and research modes: plain text generation with system + user messages
  if (input.currentMode === "plan") {
    try {
      const result = await adapter.generate(alias.alias, alias.ollamaModel, transcript, {
        mode: input.currentMode,
        systemPrompt,
      });

      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
      modelAliasForStorage = chosenAlias;

      // Build response object in code - plain text reply
      validated = {
        action: "answer",
        mode: input.currentMode,
        request: transcript,
        reply: result.text.trim(),
        source: "qwen",
      };
    } catch (err) {
      logger.error("turn: model call failed, using fallback", { err });
      validated = fallbackIntent(transcript, input.currentMode, "fallback");
      modelAliasForStorage = null;
      tokensIn = 0;
      tokensOut = 0;
    }
  } else if (input.currentMode === "research") {
    const t0 = nowMs();
    // Research mode: fetch web sources first, then answer from them in plain text.
    // Free RAM first: unload every other Finch model so the research model has room.
    // Ollama no-ops for models that are not loaded, so this is safe and cheap.
    logger.info("timing: research start", { ms: fmt(nowMs() - t0) });
    const seenOllamaModels = new Set<string>();
    for (const candidate of listAliases()) {
      if (candidate.ollamaModel === alias.ollamaModel) continue;
      if (seenOllamaModels.has(candidate.ollamaModel)) continue;
      seenOllamaModels.add(candidate.ollamaModel);
      void ollamaAdapter.unload(candidate.ollamaModel);
    }
    logger.info("timing: after unload dispatch", { ms: fmt(nowMs() - t0) });

    const researchPath = input.researchPath ?? [];
    const hasPath = researchPath.length > 0;

    if (!hasPath) {
      // No direction chosen yet: suggest directions instead of searching.
      try {
        const categoryNames = listResearchResourceCategoryNames();
        const directionsInstructions = buildResearchDirectionsPrompt(categoryNames);
        logger.info("timing: directions call start", { ms: fmt(nowMs() - t0) });
        const directionsResult = await adapter.generate(
          alias.alias,
          alias.ollamaModel,
          buildCardsPrompt(transcript, [], directionsInstructions),
          { mode: "research", maxTokens: 700, temperature: 0.3, format: "json" }
        );
        logger.info("timing: directions call done", { ms: fmt(nowMs() - t0) });
        const parsedDirections = parseCardsJson(directionsResult.text).slice(0, 5);
        logger.info("turn: directions categorised", {
          categories: parsedDirections.map((d) => ({ headline: d.headline, category: d.category ?? "(none)" })),
        });
        if (parsedDirections.length > 0) {
          logger.info("timing: directions early return", { ms: fmt(nowMs() - t0), count: parsedDirections.length });
          addTurn({
            conversationId: conversation.id,
            mode: input.currentMode,
            userText: transcript,
            finchText: "Pick a direction to explore.",
            modelAlias: alias.alias,
            tokensIn: null,
            tokensOut: null,
          });

          saveTurnResult({
            conversationId: conversation.id,
            mode: "research",
            request: transcript,
            reply: "Pick a direction to explore.",
            payload: {
              webSources: [],
              topicCards: [],
              directions: parsedDirections,
              searchSource: null,
              researchPath: [],
            },
          });
          return {
            action: "answer",
            mode: "research",
            request: transcript,
            reply: "Pick a direction to explore.",
            source: "qwen",
            conversationId: conversation.id,
            topicCards: [],
            directions: parsedDirections,
          };
        }
        logger.warn("turn: research directions parsed empty — falling through to search", { rawLength: directionsResult.text.length });
      } catch (err) {
        logger.error("turn: research directions failed", { err });
      }
      // Directions unavailable: fall through to the normal research flow.
      directions = [];
    }

    const focusedQuery = hasPath
      ? `${transcript} ${researchPath.join(" ")}`
      : transcript;

    logger.info("timing: rewriter start", { ms: fmt(nowMs() - t0) });
    const query = await rewriteSearchQuery(focusedQuery, rewriteGenerate);
    logger.info("timing: rewriter done", { ms: fmt(nowMs() - t0) });
    logger.info("turn: query", { mode: "research", query });

    try {
      logger.info("timing: research search start", { ms: fmt(nowMs() - t0) });
      const outcome = await researchSearch(query);
      logger.info("timing: research search done", { ms: fmt(nowMs() - t0), found: outcome.results.length });

      // Stage 3: search the chosen category's trusted sites in parallel.
      const categorySites = input.researchCategory
        ? listResearchResourceSitesForCategory(input.researchCategory)
        : [];
      const siteOutcomes = await Promise.allSettled(
        categorySites.map((site) => searxngSiteSearch(site, query, { maxResults: 4 }))
      );
      const flatSiteResults: SearchResult[] = [];
      for (const o of siteOutcomes) {
        if (o.status === "fulfilled") flatSiteResults.push(...o.value);
      }

      let ranked = outcome.searchSource === "research"
        ? outcome.results.slice(0, 8)
        : await addWikipediaImages(filterRelevant(rankAndFilterResults(outcome.results), query).slice(0, 8));
      if (flatSiteResults.length > 0) {
        ranked = mergeWithSiteResults(flatSiteResults, ranked, 8);
      }
      logger.info("turn: site search", {
        category: input.researchCategory ?? "(none)",
        sites: categorySites.length,
        siteResults: flatSiteResults.length,
        totalAfterMerge: ranked.length,
      });

      webSources = ranked;
      searchSource = outcome.searchSource;
      logger.info("turn: research", {
        decision: outcome.decision,
        searchSource,
        sourcesUsed: outcome.sourcesUsed,
        found: outcome.results.length,
        kept: ranked.length,
      });

      if (ranked.length === 0) {
        validated = {
          action: "answer",
          mode: "research",
          request: transcript,
          reply: "I could not find enough web sources for that. Try rephrasing your question.",
          source: "fallback",
        };
        modelAliasForStorage = null;
        tokensIn = 0;
        tokensOut = 0;
      } else {
        // Plain reply is hidden by the frontend (accessibility-only), so skip the
        // wasted generation and keep a short static reply instead.
        tokensIn = 0;
        tokensOut = 0;
        validated = {
          action: "answer",
          mode: "research",
          request: transcript,
          reply: "Research prepared.",
          source: "qwen",
        };

        logger.info("timing: build cards start", { ms: fmt(nowMs() - t0) });
        topicCards = buildCardsFromSources(ranked, 5);
        logger.info("timing: build cards done", { ms: fmt(nowMs() - t0), count: topicCards.length });

        logger.info("timing: image fetch start", { ms: fmt(nowMs() - t0) });
        const cardImages = await fetchQueryImages(focusedQuery, 5);
        logger.info("timing: image fetch done", { ms: fmt(nowMs() - t0), images: cardImages.length });
        topicCards = topicCards.map((card, index) =>
          index < cardImages.length ? { ...card, image: cardImages[index] } : card
        );

        logger.info("turn: cards", { mode: input.currentMode, count: topicCards.length });
      }
    } catch (err) {
      logger.error("turn: research failed", {
        searchError: err instanceof SearchError,
        err: err instanceof Error ? err.message : String(err),
      });
      validated = {
        action: "answer",
        mode: "research",
        request: transcript,
        reply: "Search is unavailable right now. Please try again in a moment.",
        source: "fallback",
      };
      webSources = [];
      modelAliasForStorage = null;
      tokensIn = 0;
      tokensOut = 0;
    }
    logger.info("timing: research branch total", { ms: fmt(nowMs() - t0) });
  } else if (input.currentMode === "search") {
    // Search mode: fetch web sources first, then answer from them in plain text.
    const ramBeforeRewrite = getMemoryStatus().usedPercent;
    const query = await rewriteSearchQuery(transcript, rewriteGenerate);
    logger.info("turn: query", { mode: "search", query });

    try {
      // RAM is read before the rewrite loads the model, so loading it does not trigger the low-RAM fallback.
      const outcome = await routedSearch(query, { getUsedPercent: () => ramBeforeRewrite });
      const ranked = await addWikipediaImages(filterRelevant(rankAndFilterResults(outcome.results), query).slice(0, 5));
      webSources = ranked;
      searchSource = outcome.searchSource;
      logger.info("turn: search", {
        decision: outcome.decision,
        searchSource,
        found: outcome.results.length,
        kept: ranked.length,
      });

      if (ranked.length === 0) {
        validated = {
          action: "answer",
          mode: "search",
          request: transcript,
          reply: "I could not find any web results for that. Try rephrasing your question.",
          source: "fallback",
        };
        modelAliasForStorage = null;
        tokensIn = 0;
        tokensOut = 0;
      } else {
        try {
          const result = await adapter.generate(
            alias.alias,
            alias.ollamaModel,
            buildSearchUserPrompt(transcript, ranked, outcome.searchSource),
            { mode: "search", systemPrompt }
          );

          tokensIn = result.tokensIn;
          tokensOut = result.tokensOut;

          const replyText = result.text.trim();
          validated = {
            action: "answer",
            mode: "search",
            request: transcript,
            reply:
              replyText.length > 0
                ? replyText
                : "I could not produce an answer from the sources. Please check the links below.",
            source: "qwen",
          };
        } catch (err) {
          logger.error("turn: search model call failed, using fallback", { err });
          validated = fallbackIntent(transcript, input.currentMode, "fallback");
          modelAliasForStorage = null;
          tokensIn = 0;
          tokensOut = 0;
        }

        try {
          const cardsResult = await adapter.generate(alias.alias,
            alias.ollamaModel,
            buildCardsPrompt(transcript, ranked, SEARCH_CARDS_PROMPT_DRAFT),
            { mode: "search", maxTokens: 700, temperature: 0.3 });
          topicCards = parseCardsJson(cardsResult.text).slice(0, 4);
        } catch (err) {
          logger.error("turn: search cards failed", { err });
          topicCards = [];
        }
        logger.info("turn: cards", { mode: input.currentMode, count: topicCards.length });
      }
    } catch (err) {
      logger.error("turn: search failed", {
        searchError: err instanceof SearchError,
        err: err instanceof Error ? err.message : String(err),
      });
      validated = {
        action: "answer",
        mode: "search",
        request: transcript,
        reply: "Search is unavailable right now. Please try again in a moment.",
        source: "fallback",
      };
      webSources = [];
      modelAliasForStorage = null;
      tokensIn = 0;
      tokensOut = 0;
    }
  } else {
    // Conversation mode (single-shot path): plain prose reply. Intent
    // classification was removed — no router call, no change_mode.
    const memoryContext = input.currentMode === "conversation" 
      ? buildMemoryContext(conversation.id, input.currentMode)
      : "";
    const plainSystem = [systemPrompt, memoryContext, STREAM_REPLY_GUIDANCE]
      .filter((part) => part.length > 0)
      .join("\n\n");

    try {
      const result = await adapter.generate(alias.alias, alias.ollamaModel, transcript, {
        mode: input.currentMode,
        systemPrompt: plainSystem,
      });

      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;

      const reply = result.text.trim().slice(0, MAX_REPLY_LENGTH);
      if (reply.length > 0) {
        validated = {
          action: "answer",
          mode: input.currentMode,
          request: "",
          reply,
          source: "qwen",
        };
      } else {
        logger.warn("turn: empty reply, using fallback");
        validated = fallbackIntent(transcript, input.currentMode, "fallback");
        modelAliasForStorage = null;
        tokensIn = 0;
        tokensOut = 0;
      }
    } catch (err) {
      logger.error("turn: model call failed, using fallback", { err });
      validated = fallbackIntent(transcript, input.currentMode, "fallback");
      modelAliasForStorage = null;
      tokensIn = 0;
      tokensOut = 0;
    }
  }

  addTurn({
    conversationId: conversation.id,
    mode: input.currentMode,
    userText: transcript,
    finchText: validated.reply,
    modelAlias: modelAliasForStorage,
    tokensIn,
    tokensOut,
  });

  if (input.currentMode === "search" || input.currentMode === "research") {
    saveTurnResult({
      conversationId: conversation.id,
      mode: input.currentMode,
      request: transcript,
      reply: validated.reply,
      payload: {
        webSources: webSources ?? [],
        topicCards: topicCards ?? [],
        directions: directions ?? [],
        searchSource: searchSource ?? null,
        researchPath: input.researchPath ?? [],
      },
    });
  }

  return { ...validated, conversationId: conversation.id, webSources, searchSource, topicCards, directions };
}

// Two-phase streaming turn for conversation mode:
//   Phase 1 — stream the plain-text reply as it generates (no JSON format, so
//             partial deltas are always valid prose; the client shows/speaks
//             them immediately).
//   The streamed text IS the final result: there is no intent call (intent
//   generation was removed — mode switching happens via keyboard shortcut).
// Non-conversation modes keep the old single-shot behaviour (one delta with
// the finished reply) so one client path can serve every mode.
export async function processTurnStream(
  input: TurnInput,
  onDelta: StreamDeltaHandler,
  signal?: AbortSignal,
  onStreamEnd?: () => void
): Promise<TurnResult> {
  const turnStart = nowMs();
  const transcript = input.transcript.trim();
  if (!transcript) {
    return {
      action: "answer",
      mode: input.currentMode,
      request: "",
      reply: "",
      source: "fallback",
      conversationId: 0,
    };
  }

  if (input.currentMode !== "conversation") {
    const result = await processTurn(input);
    if (result.reply) onDelta(result.reply, result.reply);
    onStreamEnd?.();
    return result;
  }

  const conversation = getOrCreateActiveConversation(input.currentMode);
  maybeSetTitleFromFirstMessage(conversation.id, transcript);

  const chosenAlias = chooseAlias(input, transcript);
  logger.info("turn: routing", {
    currentMode: input.currentMode,
    chosenAlias,
    transcriptLen: transcript.length,
    conversationId: conversation.id,
  });

  const systemPrompt = buildSystemPrompt(input.currentMode);
  const alias = getAlias(chosenAlias);
  const adapter = getAdapter(chosenAlias);

  const memoryContext = buildMemoryContext(conversation.id, input.currentMode);
  const streamSystem = [systemPrompt, memoryContext, STREAM_REPLY_GUIDANCE]
    .filter((part) => part.length > 0)
    .join("\n\n");

  // Phase 1: stream the reply. `handleDelta` enforces the 1500-char reply cap
  // and stops the model early once reached.
  // Sequential pipeline (VOICE_PIPELINE_MODE=sequential): generate the WHOLE
  // reply with one non-streaming call and emit it as a single delta — the
  // client holds speech until "done", so no TTS can overlap this call.
  const sequential = config.voicePipelineMode === "sequential";
  let replyText = "";
  let streamTokensIn = 0;
  let streamTokensOut = 0;
  const handleDelta: StreamDeltaHandler = (delta, full) => {
    replyText = full;
    const keep = onDelta(delta, full);
    if (keep === false) return false;
    if (full.length >= MAX_REPLY_LENGTH) return false;
    return true;
  };

  try {
    if (sequential) {
      const r = await adapter.generate(alias.alias, alias.ollamaModel, transcript, {
        mode: input.currentMode,
        systemPrompt: streamSystem,
        signal,
      });
      streamTokensIn = r.tokensIn;
      streamTokensOut = r.tokensOut;
      if (r.text.length > 0) {
        replyText = r.text.slice(0, MAX_REPLY_LENGTH);
        onDelta(replyText, replyText);
      }
    } else if (adapter.generateStream) {
      const r = await adapter.generateStream(alias.alias, alias.ollamaModel, transcript, {
        mode: input.currentMode,
        systemPrompt: streamSystem,
        signal,
      }, handleDelta);
      streamTokensIn = r.tokensIn;
      streamTokensOut = r.tokensOut;
      if (r.text.length > 0) replyText = r.text;
    } else {
      // Adapter without streaming: single-shot, forward the whole reply at once.
      const r = await adapter.generate(alias.alias, alias.ollamaModel, transcript, {
        mode: input.currentMode,
        systemPrompt: streamSystem,
        signal,
      });
      streamTokensIn = r.tokensIn;
      streamTokensOut = r.tokensOut;
      if (r.text.length > 0) {
        replyText = r.text.slice(0, MAX_REPLY_LENGTH);
        onDelta(replyText, replyText);
      }
    }
  } catch (err) {
    // Caller aborted (client disconnected): stop all further work.
    if (signal?.aborted) throw err;
    logger.error("turn: reply stream failed", { err, partialLen: replyText.length });
  }

  if (signal?.aborted) {
    throw new Error("turn stream aborted");
  }

  // The reply text is now complete (or as complete as it will get): signal it
  // so the caller can flush buffered text to speech immediately.
  const textCompleteMs = nowMs() - turnStart;
  logger.info("timing: reply-stream phase", { ms: fmt(textCompleteMs) });
  onStreamEnd?.();

  // No intent phase: the streamed text is always the spoken reply.
  const trimmedReply = replyText.trim();
  let modelAliasForStorage: string | null = chosenAlias;
  let validated: ValidatedIntent;
  if (trimmedReply.length > 0) {
    validated = {
      action: "answer",
      mode: input.currentMode,
      request: "",
      reply: trimmedReply.slice(0, MAX_REPLY_LENGTH),
      source: "qwen",
    };
  } else {
    validated = fallbackIntent(transcript, input.currentMode, "fallback");
    modelAliasForStorage = null;
  }

  addTurn({
    conversationId: conversation.id,
    mode: input.currentMode,
    userText: transcript,
    finchText: validated.reply,
    modelAlias: modelAliasForStorage,
    tokensIn: streamTokensIn,
    tokensOut: streamTokensOut,
  });

  logger.info("timing: stream turn total", { ms: fmt(nowMs() - turnStart) });

  return { ...validated, conversationId: conversation.id };
}