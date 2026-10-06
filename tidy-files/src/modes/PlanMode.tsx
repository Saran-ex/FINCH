import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import AITextLoading from "@/components/ui/ai-text-loading";
import ReactMarkdown from "react-markdown";
import { getPlanMessages, type TurnResponse } from "@/lib/api";
import { useModeModels, resolveModelValue } from "@/lib/useModeModels";

interface Message {
  role: "user" | "finch";
  content: string;
}

export function PlanMode({
  onSubmit,
  selectedModel,
}: {
  onSubmit: (query: string, modelOverride?: string) => Promise<TurnResponse>;
  selectedModel?: string | undefined;
}) {
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { options, defaultAlias } = useModeModels("plan");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSubmitting]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle Enter key submit vs Shift+Enter new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!value.trim() || isSubmitting) return;

    const userQuery = value.trim();
    setValue("");

    // Append User Message
    setMessages((prev) => [...prev, { role: "user", content: userQuery }]);
    setIsSubmitting(true);

    try {
      const activeModel = resolveModelValue(options, defaultAlias, selectedModel);
      const result = await onSubmit(userQuery, activeModel);
      setMessages((prev) => [
        ...prev,
        { role: "finch", content: result.reply || "No response received." },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "finch",
          content: "Unable to reach the backend. Please try again.",
        },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

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
          {messages.map((msg, idx) => (
            <div key={idx} className={`plan-message ${msg.role === "user" ? "user" : "finch"}`}>
              <div className={`message-bubble ${msg.role === "user" ? "max-w-[75%] mr-4" : ""}`}>
                {msg.role === "finch" ? (
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {isSubmitting && (
            <div className="plan-message finch">
              <div className="message-bubble">
                <AITextLoading
                  texts={[
                    "Analyzing your prompt...",
                    "Building strategy...",
                    "Formulating plan...",
                    "Thinking...",
                  ]}
                />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          className="plan-composer flex items-center justify-between w-full rounded-2xl border border-black/10 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-all focus-within:ring-2 focus-within:ring-black/20"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What would you like to plan?"
            disabled={isSubmitting}
            rows={1}
            className="flex-1 w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus:border-none resize-none px-2 py-1 text-base text-gray-800 placeholder-gray-400 overflow-hidden"
          />
          <button
            type="submit"
            disabled={isSubmitting || !value.trim()}
            className="flex items-center justify-center h-10 w-10 rounded-xl bg-black text-white hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity shrink-0 ml-2"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
      <p className="plan-footnote">A quiet space for turning intention into direction.</p>
    </section>
  );
}
