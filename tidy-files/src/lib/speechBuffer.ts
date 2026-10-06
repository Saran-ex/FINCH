// Buffers streamed reply text and emits chunks at natural speech boundaries,
// so TTS can start on the first sentence while the model is still generating.

const DEFAULT_MIN_CHUNK_CHARS = 20;
const DEFAULT_MAX_CHUNK_CHARS = 240;

// Natural speech boundary: a sentence end (., !, ?) optionally followed by
// closing quotes/brackets and then spaces/tabs — or a hard line break.
// Decimals like "3.5" never match because the dot must be followed by space.
const BOUNDARY_RE = /[.!?][)"'’”]*[ \t]+|\n+/g;

export type SpeechBufferOptions = {
  minChunkChars?: number | undefined;
  maxChunkChars?: number | undefined;
};

export class SpeechBuffer {
  private buffer = "";
  private readonly minChars: number;
  private readonly maxChars: number;

  constructor(options?: SpeechBufferOptions) {
    this.minChars = options?.minChunkChars ?? DEFAULT_MIN_CHUNK_CHARS;
    this.maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  }

  // Appends streamed text and returns every chunk that reached a natural
  // boundary. Fragments shorter than the minimum are held back and merged
  // with the following sentence so short pieces never speak choppy.
  feed(text: string): string[] {
    this.buffer += text;
    const chunks: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (chunk.length > 0) chunks.push(chunk);
    }
    return chunks;
  }

  // Remaining buffered text at end of stream, spoken as-is (or null when the
  // buffer is empty). Clears the buffer; later feeds start fresh.
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }

  // Characters currently held back (for logs/tests).
  pendingChars(): number {
    return this.buffer.length;
  }

  // Returns the cut position (index just after the boundary) or -1 when no
  // speakable chunk is ready yet.
  private findCut(): number {
    BOUNDARY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BOUNDARY_RE.exec(this.buffer)) !== null) {
      if (match.index >= this.minChars) {
        return match.index + match[0].length;
      }
    }
    // No natural boundary yet. Over the cap: force a cut at a word boundary
    // so one giant chunk is never handed to TTS; never cut mid-word if avoidable.
    if (this.buffer.length >= this.maxChars) {
      const lastSpace = this.buffer.lastIndexOf(" ", this.maxChars - 1);
      if (lastSpace > this.minChars) return lastSpace + 1;
      return this.maxChars;
    }
    return -1;
  }
}
