import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModeIndicator } from "@/components/finch/ModeIndicator";
import { VoiceControl } from "@/components/finch/VoiceControl";
import { ConversationMode } from "@/modes/ConversationMode";
import { PlanMode } from "@/modes/PlanMode";
import { SearchMode } from "@/modes/SearchMode";
import { ResearchMode } from "@/modes/ResearchMode";
import type { Mode, VoiceState } from "@/types/mode";
import { useLocalVoice } from "@/hooks/useLocalVoice";
import {
  postTurn,
  postTurnStream,
  postVoiceSpeak,
  type TurnResponse,
  type VoiceEngine,
} from "@/lib/api";
import { useOrganizer } from "@/lib/organizerStore";
import { useModeModels, resolveModelValue } from "@/lib/useModeModels";
import "@/lib/controlRoomStore"; // ensures the stored theme is applied on load
import { SpeechBuffer } from "@/lib/speechBuffer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Finch — AI Companion" },
      {
        name: "description",
        content: "A cinematic, spatial interface for conversation, planning, search, and research.",
      },
      { property: "og:title", content: "Finch — AI Companion" },
      {
        property: "og:description",
        content: "A cinematic, spatial interface for conversation, planning, search, and research.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// Fragments shorter than this are merged with the next sentence so playback
// of pieces like "Yes." does not sound choppy.
const MIN_SEGMENT_CHARS = 12;

// Splits a finished reply into speakable segments on sentence enders so the
// first sentence can be synthesised and played without waiting for the rest.
function splitIntoSpeechSegments(text: string): string[] {
  const pieces = text
    .split(/(?<=[.!?])\s+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  if (pieces.length === 0) {
    const trimmed = text.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const segments: string[] = [];
  for (const piece of pieces) {
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.length < MIN_SEGMENT_CHARS) {
      segments[segments.length - 1] = `${previous} ${piece}`;
    } else {
      segments.push(piece);
    }
  }
  return segments;
}

// One turn's speech queue: chunks are fed while the model is still streaming
// and played in order by a single consumer — never more than one clip loading
// or playing at a time, so audio never overlaps.
type SpeechQueue = {
  pending: string[];
  done: boolean;
  cancelled: boolean;
  waiters: Array<() => void>;
  replyShownAt?: number | undefined;
};

function createSpeechQueue(): SpeechQueue {
  return { pending: [], done: false, cancelled: false, waiters: [] };
}

// Wakes a queue consumer that is waiting for the next chunk, end of stream,
// or cancellation.
function wakeQueue(queue: SpeechQueue): void {
  const waiters = queue.waiters;
  queue.waiters = [];
  for (const resolve of waiters) resolve();
}

function Index() {
  const [mode, setMode] = useState<Mode>("conversation");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceResult, setVoiceResult] = useState<TurnResponse | null>(null);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  // Set only when a live turn's speech never reached the speaker, since the
  // conversation reply is heard rather than read.
  const [speechError, setSpeechError] = useState<string | null>(null);
  // Every mode reads its persisted model pick from Settings → Organizer.
  const organizer = useOrganizer();

  const modelFor = (targetMode: Mode): string | undefined => organizer.models[targetMode];
  const online = mode === "search" || mode === "research";
  const modeModelState = useModeModels(mode);
  const effectiveModel = resolveModelValue(
    modeModelState.options,
    modeModelState.defaultAlias,
    organizer.models[mode],
  );
  const activeModelName =
    modeModelState.options.find((option) => option.alias === effectiveModel)?.displayName ??
    effectiveModel ??
    "Default";

  const {
    state: recognitionState,
    transcript,
    error,
    turnId,
    startListening,
    stopListening,
    startWakeSession,
    stopWakeSession,
    pauseWakeListening,
    reset: resetRecognition,
    isSupported,
    isSecureContext,
  } = useLocalVoice();

  useEffect(() => {
    if (recognitionState === "listening") {
      setVoiceState("listening");
    } else if (recognitionState === "waiting") {
      // Never interrupt an in-progress spoken reply.
      setVoiceState((prev) => (prev === "speaking" ? prev : "waiting"));
    } else if (recognitionState === "processing") {
      setVoiceState("thinking");
    } else if (recognitionState === "error") {
      setVoiceState("idle");
    } else if (recognitionState === "unsupported") {
      setVoiceState("idle");
    } else if (recognitionState === "idle") {
      // Also fires when transcription came back empty (nothing to send).
      setVoiceState((prev) => (prev === "speaking" ? prev : "idle"));
    }
  }, [recognitionState]);

  // Always-on wake word: Conversation and Research keep the mic live in the
  // background. The session pauses while a turn or a spoken reply is in
  // flight, and releases entirely when leaving those modes.
  const voiceModeActive = mode === "conversation" || mode === "research";
  const wakeDesired =
    voiceModeActive &&
    (recognitionState === "idle" || recognitionState === "waiting") &&
    (voiceState === "idle" || voiceState === "waiting") &&
    isSupported &&
    isSecureContext;

  useEffect(() => {
    if (!voiceModeActive) {
      stopWakeSession();
      return;
    }
    if (!wakeDesired) {
      pauseWakeListening();
      return;
    }
    // Short delay so the brief idle gap before a spoken reply starts does not
    // churn the mic session on and off.
    const timer = setTimeout(() => startWakeSession(), 150);
    return () => clearTimeout(timer);
  }, [voiceModeActive, wakeDesired, startWakeSession, stopWakeSession, pauseWakeListening]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every stop/new speak so a queued sentence sequence can notice
  // it has been cancelled and abandon its remaining segments.
  const speechSeqRef = useRef(0);
  // The active turn's speech queue (null when nothing is queued or playing).
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  // Resolves the promise awaiting the current clip's end when playback stops.
  const pendingPlayResolveRef = useRef<(() => void) | null>(null);

  const stopSpeaking = useCallback(() => {
    speechSeqRef.current += 1;
    const queue = speechQueueRef.current;
    speechQueueRef.current = null;
    if (queue) {
      queue.cancelled = true;
      wakeQueue(queue);
    }
    const cancelPlay = pendingPlayResolveRef.current;
    pendingPlayResolveRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audio.src = "";
      audioRef.current = null;
    }
    setVoiceState((prev) => (prev === "speaking" ? "idle" : prev));
    // Unblocks a queue waiting for the current clip to finish.
    cancelPlay?.();
  }, []);

  // Plays one turn's speech queue to completion: each chunk is synthesised,
  // then played while the next chunk is prefetched (one loading + one playing
  // at most), so audio starts on the first ready chunk and never overlaps.
  // Best-effort: any failure must leave the text reply intact.
  const speakFromQueue = useCallback(
    async (queue: SpeechQueue, voiceTurn: string, engine?: VoiceEngine) => {
      const seq = speechSeqRef.current;
      const sentStart = Date.now();
      // Whether speech was actually owed, and whether any audio ever started —
      // if the first never happens the turn was silent by design (no reply, or
      // a non-conversation mode), if the second never happens it failed.
      let speechOwed = false;
      let speechStarted = false;

      const loadChunk = async (chunk: string, index: number): Promise<string | null> => {
        if (index === 0) {
          console.log(
            `[voice-timing] turn=${voiceTurn} stage=speak-request-sent at=${new Date().toISOString()} chars=${chunk.length}`,
          );
        }
        try {
          const wav = await postVoiceSpeak(chunk, voiceTurn, engine);
          console.log(
            `[voice-timing] turn=${voiceTurn} stage=sentence-ready at=${new Date().toISOString()} index=${index} ms=${Date.now() - sentStart}`,
          );
          return URL.createObjectURL(wav);
        } catch {
          return null;
        }
      };

      // Plays one clip to completion. Resolves false when it stopped early
      // (decode/play error, or the user cancelled via the mic button).
      const playSegment = (url: string, isFirst: boolean): Promise<boolean> =>
        new Promise<boolean>((resolve) => {
          const audio = new Audio(url);
          let settled = false;
          const settle = (completed: boolean) => {
            if (settled) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            URL.revokeObjectURL(url);
            if (audioRef.current === audio) audioRef.current = null;
            if (pendingPlayResolveRef.current === settle) pendingPlayResolveRef.current = null;
            resolve(completed);
          };
          audio.onended = () => settle(true);
          audio.onerror = () => settle(false);
          audioRef.current = audio;
          pendingPlayResolveRef.current = () => settle(false);
          setVoiceState("speaking");
          void audio
            .play()
            .then(() => {
              speechStarted = true;
              if (settled || !isFirst) return;
              console.log(
                `[voice-timing] turn=${voiceTurn} stage=playing at=${new Date().toISOString()} ms=${Date.now() - sentStart}`,
              );
              const shownAt = queue.replyShownAt;
              if (shownAt !== undefined) {
                console.log(
                  `[voice-timing] turn=${voiceTurn} stage=first-audio-after-text at=${new Date().toISOString()} ms=${Date.now() - shownAt}`,
                );
              }
            })
            .catch(() => settle(false));
        });

      const isStale = (): boolean => queue.cancelled || speechSeqRef.current !== seq;
      // Revokes a clip that was prefetched but will never play.
      const drop = (pending: Promise<string | null> | null): void => {
        if (pending) {
          void pending.then((url) => {
            if (url !== null) URL.revokeObjectURL(url);
          });
        }
      };

      let index = 0;
      // Chunk being synthesised right now (awaited before play), or null.
      let loading: Promise<string | null> | null = null;

      try {
        for (;;) {
          if (isStale()) return;

          if (loading === null) {
            // Wait for the next chunk, end of stream, or cancellation.
            while (
              queue.pending.length === 0 &&
              !queue.done &&
              !queue.cancelled &&
              speechSeqRef.current === seq
            ) {
              await new Promise<void>((resolve) => queue.waiters.push(resolve));
            }
            if (isStale()) return;
            const chunk = queue.pending.shift();
            if (chunk === undefined) {
              if (queue.done) break; // stream over and queue drained
              continue;
            }
            speechOwed = true;
            loading = loadChunk(chunk, index);
          }

          const url = await loading;
          loading = null;
          if (isStale()) {
            if (url !== null) URL.revokeObjectURL(url);
            return;
          }
          if (url === null) break; // synthesis failed: stop the queue, keep the text

          // Prefetch the next chunk while the current one plays.
          const nextChunk = queue.pending.shift();
          const next = nextChunk !== undefined ? loadChunk(nextChunk, index + 1) : null;

          const completed = await playSegment(url, index === 0);
          index += 1;
          if (!completed) {
            drop(next);
            break;
          }
          loading = next;
        }
      } finally {
        drop(loading);
        // Only the live sequence may put the mic back to idle; a cancelled one
        // has already done so in stopSpeaking.
        if (speechSeqRef.current === seq) {
          setVoiceState((prev) => (prev === "speaking" ? "idle" : prev));
          // A live turn that owed speech but never started playing: the reply
          // is no longer shown on screen either, so say what happened.
          if (speechOwed && !speechStarted) {
            setSpeechError("Speech playback failed. Check your audio output.");
          }
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (recognitionState !== "processing" || !transcript) return;

    let cancelled = false;
    let streamFinished = false;
    const currentMode = mode; // capture mode at effect start
    const currentModelOverride = modelFor(currentMode); // capture model selection at effect start
    const currentVoiceTurnId = turnId; // capture voice-turn id at effect start
    const currentVoiceEngine = organizer.voiceEngine; // capture voice-engine pick at effect start
    const abort = new AbortController();
    const speechBuffer = new SpeechBuffer();

    async function handleTranscript() {
      setIsThinking(true);
      setBackendError(null);
      setSpeechError(null);
      console.log(
        `[voice-timing] turn=${currentVoiceTurnId || "-"} stage=turn-sent at=${new Date().toISOString()} mode=${currentMode}`,
      );
      // A new reply supersedes whatever was still playing.
      stopSpeaking();

      // Streamed chunks feed this queue while the model is still generating;
      // a single consumer speaks them in order (never overlapping clips).
      const queue = createSpeechQueue();
      speechQueueRef.current = queue;
      void speakFromQueue(queue, currentVoiceTurnId || "-", currentVoiceEngine);

      let spoken = "";
      let bufferLogged = false;
      // Sequential pipeline (backend VOICE_PIPELINE_MODE=sequential): the
      // reply arrives as ONE delta, is held here without any sentence TTS,
      // and is spoken as a single full-text synthesis request once the turn
      // fully resolves — so generation and TTS never overlap.
      let sequentialReply = false;

      // Queues the given text as ONE speech item → one /speak request.
      const speakWholeReply = (text: string): void => {
        if (text.length === 0 || queue.cancelled) return;
        if (currentMode !== "conversation") return;
        queue.pending.push(text);
        wakeQueue(queue);
      };

      const enqueueText = (text: string): void => {
        if (currentMode !== "conversation" || queue.cancelled || text.length === 0) return;
        for (const segment of splitIntoSpeechSegments(text)) {
          queue.pending.push(segment);
        }
        wakeQueue(queue);
      };

      // Handles one streamed delta: show it immediately, then feed the speech
      // buffer so the first sentence speaks before the reply is finished.
      const feedStream = (delta: string, pipeline?: string): void => {
        if (pipeline === "sequential") sequentialReply = true;
        spoken += delta;
        if (queue.replyShownAt === undefined) {
          queue.replyShownAt = Date.now();
          console.log(
            `[voice-timing] turn=${currentVoiceTurnId || "-"} stage=reply-on-screen at=${new Date().toISOString()}`,
          );
        }
        if (currentMode !== "conversation" || queue.cancelled) return;
        if (sequentialReply) return; // hold: one full-reply TTS call after done
        const chunks = speechBuffer.feed(delta);
        if (chunks.length > 0) {
          if (!bufferLogged) {
            bufferLogged = true;
            console.log(
              `[voice-timing] turn=${currentVoiceTurnId || "-"} stage=speech-buffer-ready at=${new Date().toISOString()} chunks=${chunks.length}`,
            );
          }
          for (const chunk of chunks) queue.pending.push(chunk);
          wakeQueue(queue);
        }
      };

      // Speaks whatever text the buffer still holds (end of stream or failure).
      const flushBuffer = (): void => {
        if (currentMode !== "conversation" || queue.cancelled) return;
        const rest = speechBuffer.flush();
        if (rest !== null) enqueueText(rest);
      };

      try {
        const result = await postTurnStream(
          transcript,
          currentMode,
          currentModelOverride,
          currentVoiceTurnId,
          {
            signal: abort.signal,
            onDelta: feedStream,
            onEnd: (pipeline?: string) => {
              if (pipeline === "sequential") sequentialReply = true;
              if (!sequentialReply) {
                // Reply text complete: flush the remainder so a
                // single-sentence reply speaks immediately.
                flushBuffer();
                if (spoken.length > 0) {
                  queue.done = true;
                  wakeQueue(queue);
                }
              }
              // Sequential: hold everything until the promise resolves so the
              // one synthesis request starts with no LLM work left to overlap.
              console.log(
                `[voice-timing] turn=${currentVoiceTurnId || "-"} stage=reply-stream-ended at=${new Date().toISOString()}`,
              );
            },
          },
        );
        streamFinished = true;
        if (cancelled) return;

        if (sequentialReply) {
          // Turn fully resolved: exactly one synthesis request for the whole
          // reply, with no LLM work left to overlap it.
          speakWholeReply(spoken.length > 0 ? spoken : result.reply);
        } else {
          flushBuffer();
        }
        queue.done = true;
        wakeQueue(queue);
        console.log(
          `[voice-timing] turn=${currentVoiceTurnId || "-"} stage=stream-done at=${new Date().toISOString()}`,
        );

        setVoiceResult(result);

        // The backend streams every spoken character as a delta; this only
        // fires when the reply arrived as a single fallback event.
        if (!spoken && result.reply && !sequentialReply) {
          enqueueText(result.reply);
        }
      } catch (err) {
        // The stream attempt is over either way — mark it so the effect
        // cleanup does not cancel the partial reply queued below.
        streamFinished = true;
        if (cancelled) return;
        // Keep any partial reply that already arrived on screen and on speaker.
        if (sequentialReply) {
          speakWholeReply(spoken);
        } else {
          flushBuffer();
        }
        queue.done = true;
        wakeQueue(queue);
        setBackendError("Backend unreachable — please try again");
      } finally {
        if (!cancelled) {
          setIsThinking(false);
          // Never interrupt an in-progress spoken reply.
          setVoiceState((prev) => (prev === "speaking" ? prev : "idle"));
          resetRecognition();
        }
      }
    }

    void handleTranscript();

    return () => {
      cancelled = true;
      if (!streamFinished) {
        // Superseded mid-stream (new capture, cancel, mode change, unmount):
        // abort the request and any speech it already started.
        abort.abort();
        stopSpeaking();
      }
    };
  }, [recognitionState, transcript, resetRecognition, stopSpeaking, speakFromQueue]);

  const handleModeSubmit = async (
    query: string,
    modelOverride?: string,
    researchPath?: string[],
    researchCategory?: string,
  ) => {
    return postTurn(query, mode, modelOverride, researchPath, researchCategory);
  };

  const handleVoiceClick = () => {
    // Clicking the mic while Finch is speaking stops the playback.
    if (voiceState === "speaking") {
      stopSpeaking();
      return;
    }

    if (!isSupported) {
      alert("Voice input is not supported in this browser. You can use text input instead.");
      return;
    }

    if (voiceState === "idle") {
      setVoiceState("listening");
      startListening();
    } else if (voiceState === "waiting") {
      // Manual override: skip the wake word and capture immediately on the
      // stream the always-on session already holds open.
      startListening();
    } else if (voiceState === "listening") {
      // Stop the in-progress capture but leave the recognition state on
      // 'processing' (finishCapture sets it) so background wake listening
      // stays closed until the turn fully finishes.
      stopListening();
    } else if (voiceState === "thinking") {
      // Cancel an in-flight turn outright.
      stopListening();
      setVoiceState("idle");
      resetRecognition();
    }
  };

  const currentModeComponent = (
    <>
      {mode === "conversation" && (
        <ConversationMode
          voiceState={voiceState}
          onVoiceChange={handleVoiceClick}
          speechError={speechError}
        />
      )}
      {mode === "plan" && <PlanMode onSubmit={handleModeSubmit} selectedModel={modelFor("plan")} />}
      {mode === "search" && (
        <SearchMode onSubmit={handleModeSubmit} selectedModel={modelFor("search")} />
      )}
      {mode === "research" && (
        <ResearchMode
          onSubmit={handleModeSubmit}
          selectedModel={modelFor("research")}
          voiceResult={mode === "research" ? voiceResult : null}
          onVoiceResultConsumed={() => setVoiceResult(null)}
        />
      )}
    </>
  );

  return (
    <main className="finch-app" data-mode={mode}>
      <a href="#finch-experience" className="skip-link">
        Skip to Finch
      </a>
      <div className="brand-mark" aria-label="Finch">
        F<span>•</span>
      </div>
      <ModeIndicator mode={mode} onChange={setMode} />
      <div id="finch-experience" className="mode-transition" key={mode}>
        {currentModeComponent}
      </div>
      {(mode === "conversation" || mode === "research") && (
        <VoiceControl state={voiceState} onClick={handleVoiceClick} disabled={!isSupported} />
      )}
      <div className="system-status" aria-hidden="true">
        <span className={online ? undefined : "offline"} />
        {online ? "FINCH ONLINE" : "FINCH OFFLINE"}
      </div>
      <div className="mode-model-indicator" aria-hidden="true">
        Model: {activeModelName}
        {mode === "conversation" && (
          <>
            <br />
            Voice: {organizer.voiceEngine ?? "Default"}
          </>
        )}
      </div>
      {!isSupported && (
        <div className="voice-unsupported-notice" role="alert">
          Voice input is not supported in this browser. You can use text input instead.
        </div>
      )}
      {!isSecureContext && isSupported && (
        <div className="voice-unsupported-notice" role="alert" style={{ bottom: "8.5rem" }}>
          Voice recognition requires HTTPS. Use localhost or deploy with SSL.
        </div>
      )}
      {error && voiceState !== "listening" && (
        <div className="voice-error-notice" role="alert">
          {error}
        </div>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to="/control-room">
            <Button
              variant="glassIcon"
              size="icon"
              className="fixed bottom-6 right-6 z-40"
              aria-label="Control Room"
            >
              <Settings className="size-5" aria-hidden="true" />
            </Button>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="left" align="center">
          Control Room
        </TooltipContent>
      </Tooltip>
    </main>
  );
}
