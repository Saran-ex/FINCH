import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import PromptBar from "@/components/react-bits/PromptBar";
import ThoughtLine from "@/components/react-bits/ThoughtLine";
import { getPlanMessages, type TurnResponse } from "@/lib/api";
import { useModeModels, resolveModelValue } from "@/lib/useModeModels";

interface Message {
  role: "user" | "finch";
  content: string;
  // Set only on the newest reply while it is still being revealed word by
  // word; history rows and user messages never carry it.
  typing?: boolean;
}

// Plan submits are non-streaming, so there are no real progress events to
// report. These steps advance on a timer instead — same pattern SearchMode
// already uses for its `stages` array.
const PLAN_STEPS = [
  "Reading your prompt",
  "Gathering your context",
  "Structuring the plan",
  "Drafting the plan",
];
const STEP_INTERVAL_MS = 700;

// Typing reveal: one cut (about a word) every WORD_MS, clamped so a short
// reply doesn't flash by and a long one still lands inside five seconds.
const WORD_MS = 45;
const MIN_TYPE_MS = 500;
const MAX_TYPE_MS = 5000;
// ThoughtLine's settle transition is 350ms; keep the bubble hidden until it
// has finished so the trace collapses before the reply starts typing.
const SETTLE_BEFORE_TYPE_MS = 600;

const isWhitespace = (ch: string): boolean => /\s/.test(ch);
const isPunctuation = (ch: string): boolean => /[\p{P}\p{S}]/u.test(ch);

/**
 * Offsets at which `source.slice(0, offset)` is safe to hand to ReactMarkdown:
 * never mid-code-span, mid-fence, mid-tag, mid-link-destination, mid-bracket or
 * mid-emphasis, so the half-written reply parses exactly the way the finished
 * reply will. Always ends with `source.length` — the complete document is safe
 * by definition, balanced markdown or not.
 */
function markdownSafeCuts(source: string): number[] {
  const cuts: number[] = [];
  const length = source.length;
  let inFence = false;
  let inTicks = false;
  let inTag = false;
  let brackets = 0;
  let inLinkDest = false;
  let emphasis = 0;
  let wordStart = -1;
  let i = 0;

  const safe = (): boolean =>
    !inFence && !inTicks && !inTag && brackets === 0 && !inLinkDest && emphasis === 0;
  const record = (offset: number): void => {
    if (safe()) cuts.push(offset);
  };

  while (i < length) {
    const ch = source.charAt(i);

    if (ch === "`") {
      let end = i;
      while (end < length && source.charAt(end) === "`") end += 1;
      const run = end - i;
      if (run >= 3) inFence = !inFence;
      else if (!inFence) inTicks = !inTicks;
      i = end;
      continue;
    }

    if (isWhitespace(ch)) {
      if (wordStart >= 0) record(i);
      wordStart = -1;
      i += 1;
      continue;
    }

    if (!inFence && !inTicks) {
      const prev = source.charAt(i - 1);
      const next = source.charAt(i + 1);

      if (ch === "<") {
        if (/[A-Za-z]/.test(next)) inTag = true;
      } else if (ch === ">" && inTag) {
        inTag = false;
      } else if (ch === "[") {
        brackets += 1;
      } else if (ch === "]") {
        if (brackets > 0) brackets -= 1;
        if (next === "(") inLinkDest = true;
      } else if (ch === ")" && inLinkDest) {
        inLinkDest = false;
      } else if (ch === "*" || ch === "_") {
        // CommonMark flanking rules, so `5 * 3` and `snake_case` are literal
        // (no runaway emphasis count) while `**bold**` still balances.
        const prevIsSpace = i === 0 || isWhitespace(prev);
        const nextIsSpace = next === "" || isWhitespace(next);
        const prevIsPunct = prev !== "" && isPunctuation(prev);
        const nextIsPunct = next !== "" && isPunctuation(next);
        const leftFlanking = !nextIsSpace && (!nextIsPunct || prevIsSpace || prevIsPunct);
        const rightFlanking = !prevIsSpace && (!prevIsPunct || nextIsSpace || nextIsPunct);
        if (ch === "*") {
          if (leftFlanking) emphasis += 1;
          if (rightFlanking && emphasis > 0) emphasis -= 1;
        } else if (leftFlanking && (!rightFlanking || prevIsPunct)) {
          emphasis += 1;
        } else if (rightFlanking && (!leftFlanking || nextIsPunct) && emphasis > 0) {
          emphasis -= 1;
        }
      }
      if (wordStart < 0) wordStart = i;
    }
    i += 1;
  }

  if (wordStart >= 0) record(length);
  if (cuts[cuts.length - 1] !== length) cuts.push(length);
  return cuts;
}

/** Plain word boundaries — the graceful path when the markdown scan stalls. */
function wordCuts(source: string): number[] {
  const cuts: number[] = [];
  let inWord = false;
  for (let i = 0; i < source.length; i += 1) {
    if (isWhitespace(source.charAt(i))) {
      if (inWord) {
        cuts.push(i);
        inWord = false;
      }
    } else {
      inWord = true;
    }
  }
  if (inWord) cuts.push(source.length);
  return cuts;
}

/**
 * Cut points for the reveal: markdown-safe word boundaries when they are
 * evenly spread, plain word boundaries when the markdown is unbalanced enough
 * that one gap would swallow the reply (a stray `*` stops every later safe
 * cut) — a smooth reveal matters more than a perfectly balanced prefix.
 */
function revealCuts(source: string): number[] {
  const safe = markdownSafeCuts(source);
  if (safe.length > 1) {
    let previous = 0;
    let largest = 0;
    for (const at of safe) {
      largest = Math.max(largest, at - previous);
      previous = at;
    }
    if (largest * 2 <= source.length) return safe;
  }
  return wordCuts(source);
}

/**
 * Reads a design token off :root as a literal string.
 *
 * Needed for PromptBar's `sparkColor`, which is assigned straight to a canvas
 * `fillStyle` — a raw `var(--ring)` there is an invalid value and would render
 * black. Re-reads on every theme flip (controlRoomStore toggles the `dark`
 * class on <html>).
 */
function useThemeToken(name: string, fallback: string): string {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const read = () => {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      setValue(resolved || fallback);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [name, fallback]);

  return value;
}

export function PlanMode({
  onSubmit,
  selectedModel,
}: {
  onSubmit: (query: string, modelOverride?: string) => Promise<TurnResponse>;
  selectedModel?: string | undefined;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [showThought, setShowThought] = useState(false);
  const [visibleText, setVisibleText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Token of the in-flight turn. Bumped on stop and on each new send, so a
  // late reply from an abandoned turn can never land in a newer thread.
  const cancelledRef = useRef(0);
  const { options, defaultAlias } = useModeModels("plan");
  const ringToken = useThemeToken("--ring", "#3b82f6");

  // Only the newest reply can be mid-reveal; rows loaded from history render
  // in full because they never carry the `typing` flag.
  const lastMessage = messages[messages.length - 1];
  const revealSource = lastMessage && lastMessage.typing === true ? lastMessage.content : null;
  const isTyping = revealSource !== null;

  // Ends the reveal: the full text is already on the message, so only the
  // flag and the revealed slice need clearing.
  const finishTyping = useCallback(() => {
    setVisibleText("");
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.typing !== true) return prev;
      const next = [...prev];
      next[next.length - 1] = { role: last.role, content: last.content };
      return next;
    });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSubmitting]);

  // Follow each revealed slice without animation so the growing reply stays
  // in view; the smooth pass above already handles the message landing.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [visibleText]);

  // Reveals the newest reply word by word on a rAF clock, starting only once
  // ThoughtLine's settle transition has had time to finish.
  useEffect(() => {
    if (revealSource === null) return;
    setVisibleText("");
    const cuts = revealCuts(revealSource);
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (cuts.length <= 1 || reducedMotion) {
      finishTyping();
      return;
    }
    const duration = Math.min(MAX_TYPE_MS, Math.max(MIN_TYPE_MS, cuts.length * WORD_MS));
    const startAt = performance.now() + SETTLE_BEFORE_TYPE_MS;
    let shown = 0;
    let frame = 0;
    const step = (now: number): void => {
      const progress = (now - startAt) / duration;
      if (progress > 0) {
        const index = Math.min(cuts.length - 1, Math.floor(progress * cuts.length));
        const count = cuts[index] ?? 0;
        if (count !== shown) {
          shown = count;
          setVisibleText(revealSource.slice(0, count));
        }
        if (progress >= 1) {
          finishTyping();
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [revealSource, finishTyping]);

  // Simulated progress trace: reset to the first step on each new submit and
  // advance until the reply lands (never past the last step).
  useEffect(() => {
    if (!isSubmitting) {
      setStepIndex(-1);
      return;
    }
    setStepIndex(0);
    const id = setInterval(() => {
      setStepIndex((current) => (current >= PLAN_STEPS.length - 1 ? current : current + 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isSubmitting]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await getPlanMessages(24, 50);
      if (cancelled || rows.length === 0) return;
      // The API returns rows newest-first; the thread renders oldest-first.
      const ascending = [...rows].reverse();
      setMessages(
        ascending.map((row) => ({
          role: row.role === "user" ? "user" : "finch",
          content: row.content,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSend = async (text: string, detail: { model?: { key: string } | undefined }) => {
    const userQuery = text.trim();
    if (!userQuery || isSubmitting) return;

    const token = ++cancelledRef.current;
    setShowThought(true);
    setMessages((prev) => [...prev, { role: "user", content: userQuery }]);
    setIsSubmitting(true);

    try {
      const activeModel =
        detail.model?.key ?? resolveModelValue(options, defaultAlias, selectedModel);
      const result = await onSubmit(userQuery, activeModel);
      if (cancelledRef.current !== token) return;
      setMessages((prev) => [
        ...prev,
        // The reply types itself in; the error path below renders instantly.
        { role: "finch", content: result.reply || "No response received.", typing: true },
      ]);
    } catch {
      if (cancelledRef.current !== token) return;
      setMessages((prev) => [
        ...prev,
        {
          role: "finch",
          content: "Unable to reach the backend. Please try again.",
        },
      ]);
    } finally {
      // Only the still-current turn may clear the busy state — an abandoned
      // one resolving late must not un-busy a newer in-flight turn.
      if (cancelledRef.current === token) setIsSubmitting(false);
    }
  };

  // Stops showing the busy state immediately. The HTTP request itself is NOT
  // aborted — postTurn takes no AbortSignal and onSubmit is supplied by the
  // parent — so it completes in the background and its reply is discarded.
  const handleStop = () => {
    cancelledRef.current += 1;
    setIsSubmitting(false);
    // Stops the reveal too: the reply is already complete, so show it whole.
    finishTyping();
  };

  const steps = stepIndex >= 0 ? PLAN_STEPS.slice(0, stepIndex + 1) : [];

  return (
    <section className="mode-scene plan-scene" aria-label="Plan mode">
      <div className="plan-orbit" aria-hidden="true" />
      <div className="plan-workspace">
        <span className="scene-kicker">FINCH / PLAN</span>
        <div className="plan-thread pr-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="plan-greeting">
              <p>What would you like to plan?</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const revealing = idx === messages.length - 1 && msg.typing === true;
            const text = revealing ? visibleText : msg.content;
            // Held out of the layout until the first slice lands, so the
            // empty bubble never flashes while ThoughtLine settles.
            if (revealing && text.length === 0) return null;
            return (
              <div key={idx} className={`plan-message ${msg.role === "user" ? "user" : "finch"}`}>
                <div className={`message-bubble ${msg.role === "user" ? "max-w-[75%] mr-4" : ""}`}>
                  {msg.role === "finch" ? (
                    <div className="plan-reply-text">
                      <ReactMarkdown>{text}</ReactMarkdown>
                    </div>
                  ) : (
                    text
                  )}
                </div>
              </div>
            );
          })}
          {showThought && (
            <ThoughtLine
              working={isSubmitting}
              steps={steps}
              label="Planning…"
              doneLabel="Planned in"
              glyph="sparkle"
              color="var(--ink-soft)"
              glyphColor={ringToken}
              fontSize={15}
              collapseOnSettle
              showTimer
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        <PromptBar
          placeholder="What would you like to plan?"
          sources={[]}
          commands={[]}
          models={options.map((o) => ({
            key: o.alias,
            name: o.displayName,
            tag: o.paramSize,
          }))}
          defaultModel={resolveModelValue(options, defaultAlias, selectedModel) ?? ""}
          busy={isSubmitting || isTyping}
          onSend={handleSend}
          onStop={handleStop}
          background="var(--glass)"
          color="var(--foreground)"
          menuBackground="var(--popover)"
          sparkColor={ringToken}
          width={688}
          radius={20}
        />
        <p className="plan-footnote">A quiet space for turning intention into direction.</p>
      </div>
    </section>
  );
}
