import { useCallback, useEffect, useRef, useState } from 'react';
import { postVoiceTranscribe } from '@/lib/api';

export type VoiceRecognitionState =
  | 'idle'
  | 'waiting'
  | 'listening'
  | 'processing'
  | 'error'
  | 'unsupported';

export interface UseLocalVoiceReturn {
  state: VoiceRecognitionState;
  transcript: string;
  error: string | null;
  turnId: string;
  startListening: () => void;
  stopListening: () => void;
  startWakeSession: () => void;
  stopWakeSession: () => void;
  pauseWakeListening: () => void;
  reset: () => void;
  isSupported: boolean;
  isSecureContext: boolean;
}

const TARGET_SAMPLE_RATE = 16000;
const MAX_RECORDING_MS = 30000;
const SCRIPT_PROCESSOR_SIZE = 4096;

// --- Always-on wake word tuning ---
// Recent audio kept in memory so a wake check (and the capture that follows a
// wake word) can look back to the start of the speech segment.
const ROLLING_MAX_SECONDS = 10;
// Max audio sent in one wake check: segment start + pre-roll, capped so a
// long segment never gets truncated at the front (the wake phrase lives there).
const WAKE_CHECK_MAX_WINDOW_SECONDS = 8;
const WAKE_CHECK_MIN_WINDOW_MS = 500;
// Audio kept from before the segment start so a clipped first word survives.
const WAKE_CHECK_PREROLL_MS = 300;
// Quiet gap that ends a speech segment and triggers the segment's single check.
const WAKE_CHECK_SEGMENT_END_GAP_MS = 700;
// A check that never comes back is abandoned after this long.
const WAKE_CHECK_TIMEOUT_MS = 12000;
// RMS hysteresis for "someone is speaking" while in the background.
const SPEECH_ON_RMS = 0.012;
const SPEECH_OFF_RMS = 0.006;
// Peak fallback used to seed speech detection from the pre-roll buffer.
const SPEECH_PEAK = 0.05;
// After the wake word: stop capturing once this much silence follows speech.
const CAPTURE_SILENCE_MS = 1500;
// If nothing at all is said after the wake word, drop back to background.
const CAPTURE_NO_SPEECH_MS = 4000;

// Greetings allowed right before a near-"finch" word in a wake match.
const WAKE_GREETINGS = new Set(['hey', 'hi', 'hay', 'hello']);
// Fillers ignored ahead of the wake phrase when stripping it from a transcript.
const WAKE_FILLERS = new Set(['um', 'uh', 'ok', 'okay', 'hey', 'hi', 'hay', 'hello', 'excuse', 'me']);

function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / (samples.length || 1));
}

function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}

function tokenizeWords(text: string): { word: string; end: number }[] {
  const words: { word: string; end: number }[] = [];
  const re = /[A-Za-z']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) words.push({ word: m[0], end: m.index + m[0].length });
  return words;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// True once the Levenshtein distance is <= max (row-min early stop).
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return false;
    prev = curr;
  }
  return (prev[b.length] ?? 0) <= max;
}

// "finch" plus common mishearings (finish, fench, pinch, vinch, french, ...).
function isFinchLike(word: string): boolean {
  const w = normalizeWord(word);
  if (w === 'finch') return true;
  if (w.length < 4 || w.length > 7) return false;
  return withinEditDistance(w, 'finch', 2);
}

// Char index just after the wake phrase, or -1 when the transcript has none.
// Accepts greeting + near-"finch" anywhere ("Hey fench, ..."), or a leading
// "Finch" (possibly after fillers like "um, finch ...").
function wakePhraseEnd(text: string): number {
  const words = tokenizeWords(text);
  for (let i = 0; i + 1 < words.length; i++) {
    const before = words[i];
    const after = words[i + 1];
    if (!before || !after) continue;
    if (WAKE_GREETINGS.has(normalizeWord(before.word)) && isFinchLike(after.word)) {
      return after.end;
    }
  }
  for (const { word, end } of words) {
    const w = normalizeWord(word);
    if (WAKE_FILLERS.has(w)) continue;
    return w === 'finch' ? end : -1;
  }
  return -1;
}

// Removes the leading wake phrase from a wake-initiated transcript using the
// same tolerant rules as wakePhraseEnd. Returns the text unchanged when the
// wake phrase is not at the start.
function stripWakePhrase(text: string): string {
  const words = tokenizeWords(text);
  let i = 0;
  while (i < words.length && WAKE_FILLERS.has(normalizeWord(words[i]?.word ?? ''))) i++;
  if (i >= words.length) return text;
  const target = words[i];
  if (!target) return text;
  const targetWord = normalizeWord(target.word);
  const prev = i > 0 ? words[i - 1] : undefined;
  const leadingWake =
    targetWord === 'finch' ||
    (isFinchLike(target.word) && !!prev && WAKE_GREETINGS.has(normalizeWord(prev.word)));
  if (!leadingWake) return text;
  return text.slice(target.end).replace(/^[\s,.:;!?-]+/, '').trim();
}

function newTurnId(prefix: 'vt' | 'wk'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// First mic use needs a user gesture in some browsers, so before the mic
// button has granted permission we only auto-start when the browser already
// reports microphone access as granted.
async function queryMicGranted(): Promise<boolean> {
  try {
    const permissions = navigator.permissions;
    if (!permissions || typeof permissions.query !== 'function') return false;
    const status = await permissions.query({ name: 'microphone' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

function downsampleTo16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE || sourceRate <= 0) return samples;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const t = position - left;
    const a = samples[left] ?? 0;
    const b = samples[right] ?? 0;
    out[i] = a * (1 - t) + b * t;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type CaptureMode = 'manual' | 'wake' | null;
type WakeSessionState = 'off' | 'starting' | 'on';
type CaptureStopReason = 'manual' | 'silence-timeout' | 'no-speech' | 'max-duration';

export function useLocalVoice(): UseLocalVoiceReturn {
  const [state, setState] = useState<VoiceRecognitionState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnId, setTurnId] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [isSecureContext, setIsSecureContext] = useState(true);

  // Synchronous mirror of `state` so audio callbacks never read a stale value.
  const stateRef = useRef<VoiceRecognitionState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]); // current capture (manual or wake)
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false); // getUserMedia (permission) in progress
  const recordingRef = useRef(false);
  const cancelStartRef = useRef(false);
  // Lets the 30s cap timer (created inside startListening) reach stopListening.
  const stopListeningRef = useRef<() => void>(() => {});
  // Shared id for the current voice turn (frontend logs + x-voice-turn-id header).
  const turnIdRef = useRef('');

  // Always-on wake session state.
  const sessionRef = useRef<WakeSessionState>('off');
  const captureModeRef = useRef<CaptureMode>(null);
  const micGrantedRef = useRef(false);
  const captureStartedAtRef = useRef(0);
  const captureHeardSpeechRef = useRef(false);
  const captureLastSpeechAtRef = useRef(0);

  // Rolling background window (global sample counters for the current epoch).
  const rollingRef = useRef<Float32Array[]>([]);
  const rollingLengthRef = useRef(0);
  const totalSamplesRef = useRef(0);
  const sampleRateRef = useRef(0);
  const epochRef = useRef(0);

  // Background speech segmentation + wake-check bookkeeping.
  const speechActiveRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const segmentOpenRef = useRef(false);
  // Global sample index where the current segment's speech began.
  const segmentStartSampleRef = useRef(0);
  const wakeCheckInFlightRef = useRef(false);
  const wakeCheckIdRef = useRef('');
  const wakeCheckSentAtRef = useRef(0);
  // Latest segment whose check could not start yet (only the latest is kept).
  const pendingSegmentRef = useRef<{
    start: number;
    end: number;
    segmentMs: number;
    epoch: number;
  } | null>(null);

  const applyState = useCallback((next: VoiceRecognitionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const applyMicError = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      setError('Microphone access denied. Please allow microphone access in browser settings.');
    } else if (err instanceof DOMException && err.name === 'NotFoundError') {
      setError('Microphone not found. Please check your microphone.');
    } else {
      setError(err instanceof Error ? err.message : 'Failed to start microphone.');
    }
  }, []);

  const teardownRecording = useCallback(() => {
    if (capTimerRef.current) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    if (wakeWatchdogRef.current) {
      clearTimeout(wakeWatchdogRef.current);
      wakeWatchdogRef.current = null;
    }
    const processor = processorRef.current;
    processorRef.current = null;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // already disconnected
      }
    }
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    recordingRef.current = false;
  }, []);

  const pushRolling = useCallback((chunk: Float32Array) => {
    const rate = sampleRateRef.current || TARGET_SAMPLE_RATE;
    const max = Math.ceil(ROLLING_MAX_SECONDS * rate);
    rollingRef.current.push(chunk);
    rollingLengthRef.current += chunk.length;
    totalSamplesRef.current += chunk.length;
    const chunks = rollingRef.current;
    while (chunks.length > 1 && rollingLengthRef.current - (chunks[0]?.length ?? 0) > max) {
      const first = chunks.shift();
      if (!first) break;
      rollingLengthRef.current -= first.length;
    }
  }, []);

  // Copies [startSample, endSample) of the rolling window by global sample
  // index, clamped to whatever is still buffered.
  const sliceRolling = useCallback((startSample: number, endSample: number): Float32Array => {
    const chunks = rollingRef.current;
    const total = totalSamplesRef.current;
    const oldest = total - rollingLengthRef.current;
    const from = Math.max(startSample, oldest);
    const to = Math.min(endSample, total);
    const size = Math.max(0, to - from);
    if (size === 0) return new Float32Array(0);
    const out = new Float32Array(size);
    let globalIndex = oldest;
    let writeOffset = 0;
    for (const chunk of chunks) {
      const chunkStart = globalIndex;
      const chunkEnd = globalIndex + chunk.length;
      globalIndex = chunkEnd;
      if (chunkEnd <= from || chunkStart >= to) continue;
      const copyFrom = Math.max(0, from - chunkStart);
      const copyTo = Math.min(chunk.length, to - chunkStart);
      out.set(chunk.subarray(copyFrom, copyTo), writeOffset);
      writeOffset += copyTo - copyFrom;
    }
    return out;
  }, []);

  const transcribe = useCallback(
    async (voiceTurn: string, sampleRate: number, chunks: Float32Array[], wakeInitiated = false) => {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (totalLength === 0) {
        // Nothing captured — go back to idle without sending anything.
        setTranscript('');
        applyState('idle');
        return;
      }

      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const resampled = downsampleTo16k(merged, sampleRate);
      const wav = encodeWav(resampled, TARGET_SAMPLE_RATE);

      const uploadStart = Date.now();
      console.log(
        `[voice-timing] turn=${voiceTurn} stage=upload-begin at=${new Date().toISOString()} bytes=${wav.size}`,
      );

      try {
        const { text } = await postVoiceTranscribe(wav, voiceTurn);
        const trimmed = text.trim();
        console.log(
          `[voice-timing] turn=${voiceTurn} stage=transcript-back at=${new Date().toISOString()} ms=${Date.now() - uploadStart} text="${trimmed}"`,
        );
        let finalText = trimmed;
        if (wakeInitiated && trimmed.length > 0) {
          finalText = stripWakePhrase(trimmed);
          if (finalText.length === 0) {
            // The capture only held the wake phrase itself — never send it.
            console.log(
              `[voice-timing] turn=${voiceTurn} stage=turn-discarded at=${new Date().toISOString()} reason=wake-only`,
            );
            setTranscript('');
            applyState('idle');
            return;
          }
        }
        setTranscript(finalText);
        // Empty transcript returns to idle so the caller never sends an empty turn.
        applyState(finalText.length > 0 ? 'processing' : 'idle');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Voice transcription failed';
        console.log(
          `[voice-timing] turn=${voiceTurn} stage=transcript-error at=${new Date().toISOString()} ms=${Date.now() - uploadStart} error="${message}"`,
        );
        setError(message);
        applyState('error');
      }
    },
    [applyState],
  );

  // Short two-tone chime: the audible cue that the wake word was caught.
  const playWakeChime = useCallback(() => {
    const context = contextRef.current;
    if (!context || context.state === 'closed') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      const start = context.currentTime;
      oscillator.frequency.setValueAtTime(784, start);
      oscillator.frequency.setValueAtTime(1175, start + 0.1);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
      oscillator.onended = () => {
        try {
          gain.disconnect();
          oscillator.disconnect();
        } catch {
          // already disconnected
        }
      };
    } catch {
      // The cue is best-effort; never let it break the wake flow.
    }
  }, []);

  const finishCapture = useCallback(
    (reason: CaptureStopReason) => {
      if (captureModeRef.current === null) return;
      const wasWake = captureModeRef.current === 'wake';
      const sampleRate = contextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      captureModeRef.current = null;
      if (capTimerRef.current) {
        clearTimeout(capTimerRef.current);
        capTimerRef.current = null;
      }
      if (wakeWatchdogRef.current) {
        clearTimeout(wakeWatchdogRef.current);
        wakeWatchdogRef.current = null;
      }
      const id = turnIdRef.current;
      console.log(
        `[voice-timing] turn=${id} stage=capture-stop at=${new Date().toISOString()} reason=${reason} ms=${Date.now() - captureStartedAtRef.current} chunks=${chunks.length}`,
      );
      if (sessionRef.current !== 'on') teardownRecording();
      if (reason === 'no-speech') {
        // Wake word heard but nothing followed it: back to background quietly.
        applyState('idle');
        return;
      }
      applyState('processing');
      void transcribe(id, sampleRate, chunks, wasWake);
    },
    [teardownRecording, transcribe, applyState],
  );

  // Wake word matched: play the cue and start capturing from the START of
  // the matched segment (wake phrase included), then keep recording live
  // audio on top of it.
  const handleWakeDetected = useCallback(
    (checkTurn: string, text: string, segmentStartSample: number, rate: number) => {
      const now = Date.now();

      const captureTurn = newTurnId('vt');
      turnIdRef.current = captureTurn;
      setTurnId(captureTurn);

      const preRoll = sliceRolling(segmentStartSample, totalSamplesRef.current);
      chunksRef.current = preRoll.length > 0 ? [preRoll] : [];
      captureModeRef.current = 'wake';
      captureStartedAtRef.current = now;
      captureLastSpeechAtRef.current = now;
      captureHeardSpeechRef.current =
        computeRms(preRoll) >= SPEECH_ON_RMS || computePeak(preRoll) >= SPEECH_PEAK;

      console.log(
        `[voice-timing] turn=${captureTurn} stage=wake-detected at=${new Date().toISOString()} check=${checkTurn} text="${text}"`,
      );
      console.log(
        `[voice-timing] turn=${captureTurn} stage=capture-start at=${new Date().toISOString()} preRollMs=${Math.round((preRoll.length / rate) * 1000)}`,
      );

      playWakeChime();
      wakeWatchdogRef.current = setTimeout(() => finishCapture('max-duration'), MAX_RECORDING_MS);
      applyState('listening');
    },
    [sliceRolling, playWakeChime, finishCapture, applyState],
  );

  // Sends one segment's audio to the existing Whisper endpoint and checks
  // the transcript for the wake phrase. At most one check is in flight.
  const sendWakeCheck = useCallback(
    (startSample: number, endSample: number, now: number, segmentMs: number) => {
      const rate = sampleRateRef.current || TARGET_SAMPLE_RATE;
      const windowSamples = Math.max(0, endSample - startSample);
      if (windowSamples < Math.floor((WAKE_CHECK_MIN_WINDOW_MS / 1000) * rate)) return;

      const samples = sliceRolling(startSample, endSample);
      const wav = encodeWav(downsampleTo16k(samples, rate), TARGET_SAMPLE_RATE);
      const checkTurn = newTurnId('wk');
      const sentEpoch = epochRef.current;

      wakeCheckInFlightRef.current = true;
      wakeCheckIdRef.current = checkTurn;
      wakeCheckSentAtRef.current = now;

      console.log(
        `[voice-timing] turn=${checkTurn} stage=wake-check-send at=${new Date().toISOString()} windowMs=${Math.round((windowSamples / rate) * 1000)} segmentMs=${segmentMs} bytes=${wav.size}`,
      );

      postVoiceTranscribe(wav, checkTurn)
        .then(({ text }) => {
          const trimmed = text.trim();
          const matchEnd = wakePhraseEnd(trimmed);
          console.log(
            `[voice-timing] turn=${checkTurn} stage=wake-check-back at=${new Date().toISOString()} ms=${Date.now() - now} segmentMs=${segmentMs} match=${matchEnd >= 0} text="${trimmed}"`,
          );
          if (wakeCheckIdRef.current === checkTurn) wakeCheckInFlightRef.current = false;
          if (sessionRef.current !== 'on' || stateRef.current !== 'waiting') {
            pendingSegmentRef.current = null;
            return;
          }
          if (epochRef.current !== sentEpoch) {
            pendingSegmentRef.current = null;
            return;
          }
          if (matchEnd < 0) return;
          pendingSegmentRef.current = null;
          handleWakeDetected(checkTurn, trimmed, startSample, rate);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'wake check failed';
          console.log(
            `[voice-timing] turn=${checkTurn} stage=wake-check-error at=${new Date().toISOString()} ms=${Date.now() - now} error="${message}"`,
          );
          if (wakeCheckIdRef.current === checkTurn) wakeCheckInFlightRef.current = false;
        });
    },
    [sliceRolling, handleWakeDetected],
  );

  // Background state machine: energy-gated speech segmentation. Nothing is
  // sent while the user is still talking — each segment produces exactly one
  // wake check, once the segment has ended.
  const evaluateBackground = useCallback(
    (rms: number, now: number) => {
      const wasActive = speechActiveRef.current;
      if (rms >= SPEECH_ON_RMS) speechActiveRef.current = true;
      else if (rms <= SPEECH_OFF_RMS) speechActiveRef.current = false;

      if (speechActiveRef.current) {
        lastSpeechAtRef.current = now;
        if (!wasActive && !segmentOpenRef.current) {
          segmentOpenRef.current = true;
          segmentStartSampleRef.current = totalSamplesRef.current;
        }
      }

      // Abandon a check that never came back so the pipeline cannot wedge.
      if (wakeCheckInFlightRef.current && now - wakeCheckSentAtRef.current > WAKE_CHECK_TIMEOUT_MS) {
        console.log(
          `[voice-timing] turn=${wakeCheckIdRef.current} stage=wake-check-timeout at=${new Date().toISOString()}`,
        );
        wakeCheckInFlightRef.current = false;
        wakeCheckIdRef.current = '';
      }

      const rate = sampleRateRef.current || TARGET_SAMPLE_RATE;

      // Segment ended: one check covering the whole segment (plus pre-roll),
      // capped at the max window while keeping the segment start.
      if (
        !speechActiveRef.current &&
        segmentOpenRef.current &&
        now - lastSpeechAtRef.current >= WAKE_CHECK_SEGMENT_END_GAP_MS
      ) {
        segmentOpenRef.current = false;
        const total = totalSamplesRef.current;
        const oldest = total - rollingLengthRef.current;
        const prerollSamples = Math.floor((WAKE_CHECK_PREROLL_MS / 1000) * rate);
        const start = Math.max(segmentStartSampleRef.current - prerollSamples, oldest);
        const end = Math.min(total, start + Math.floor(WAKE_CHECK_MAX_WINDOW_SECONDS * rate));
        const segmentMs = Math.round(((end - start) / rate) * 1000);
        if (wakeCheckInFlightRef.current) {
          pendingSegmentRef.current = { start, end, segmentMs, epoch: epochRef.current };
        } else {
          // A newer segment supersedes anything still waiting.
          pendingSegmentRef.current = null;
          sendWakeCheck(start, end, now, segmentMs);
        }
      }

      // A check finished while this segment was queued: run the latest one.
      if (!wakeCheckInFlightRef.current && pendingSegmentRef.current) {
        const pending = pendingSegmentRef.current;
        pendingSegmentRef.current = null;
        if (pending.epoch === epochRef.current) {
          sendWakeCheck(pending.start, pending.end, now, pending.segmentMs);
        }
      }
    },
    [sendWakeCheck],
  );

  // Active capture after a wake word: stop after ~4s of silence (or if
  // nothing at all was said after the wake word).
  const evaluateWakeCapture = useCallback(
    (rms: number, now: number) => {
      if (rms >= SPEECH_ON_RMS) {
        captureHeardSpeechRef.current = true;
        captureLastSpeechAtRef.current = now;
      }
      if (captureHeardSpeechRef.current && now - captureLastSpeechAtRef.current >= CAPTURE_SILENCE_MS) {
        finishCapture('silence-timeout');
      } else if (!captureHeardSpeechRef.current && now - captureStartedAtRef.current >= CAPTURE_NO_SPEECH_MS) {
        finishCapture('no-speech');
      }
    },
    [finishCapture],
  );

  const handleAudioProcess = useCallback(
    (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0);
      const block = new Float32Array(input); // copy: buffer is reused
      // Keep the output silent so the mic is never routed to the speakers.
      event.outputBuffer.getChannelData(0).fill(0);
      const now = Date.now();
      const rms = computeRms(block);

      if (captureModeRef.current !== null) chunksRef.current.push(block);
      if (sessionRef.current === 'on') pushRolling(block);

      if (captureModeRef.current === 'wake') {
        evaluateWakeCapture(rms, now);
      } else if (
        captureModeRef.current === null &&
        sessionRef.current === 'on' &&
        stateRef.current === 'waiting'
      ) {
        evaluateBackground(rms, now);
      }
    },
    [pushRolling, evaluateWakeCapture, evaluateBackground],
  );

  const ensureStream = useCallback(async () => {
    if (recordingRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (cancelStartRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    streamRef.current = stream;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('Audio recording is not supported in this browser.');
    }

    const context = new AudioContextCtor();
    contextRef.current = context;
    if (context.state === 'suspended') await context.resume();
    sampleRateRef.current = context.sampleRate;

    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_SIZE, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = handleAudioProcess;

    source.connect(processor);
    processor.connect(context.destination);
    recordingRef.current = true;
  }, [handleAudioProcess]);

  // Enters (or re-enters) background wake listening with a fresh window so
  // audio from a previous reply can never trigger a stale wake check.
  const enterBackground = useCallback(() => {
    rollingRef.current = [];
    rollingLengthRef.current = 0;
    totalSamplesRef.current = 0;
    epochRef.current += 1;
    speechActiveRef.current = false;
    lastSpeechAtRef.current = 0;
    segmentOpenRef.current = false;
    segmentStartSampleRef.current = 0;
    pendingSegmentRef.current = null;
    wakeCheckInFlightRef.current = false;
    wakeCheckIdRef.current = '';
    applyState('waiting');
    console.log(`[voice-timing] turn=- stage=wake-listening at=${new Date().toISOString()}`);
  }, [applyState]);

  const beginManualCapture = useCallback(() => {
    setTranscript('');
    setError(null);
    const id = newTurnId('vt');
    turnIdRef.current = id;
    setTurnId(id);
    captureModeRef.current = 'manual';
    captureStartedAtRef.current = Date.now();
    chunksRef.current = [];
    applyState('listening');
    // Push-to-talk safety net: never record longer than 30s.
    capTimerRef.current = setTimeout(() => stopListeningRef.current(), MAX_RECORDING_MS);
  }, [applyState]);

  const startListening = useCallback(() => {
    if (busyRef.current) return;
    if (recordingRef.current) {
      // The always-on session already owns the mic: capture on the open stream.
      if (
        sessionRef.current === 'on' &&
        captureModeRef.current === null &&
        (stateRef.current === 'waiting' || stateRef.current === 'idle')
      ) {
        beginManualCapture();
      }
      return;
    }

    setTranscript('');
    setError(null);
    applyState('idle');
    cancelStartRef.current = false;
    const id = newTurnId('vt');
    turnIdRef.current = id;
    setTurnId(id);

    if (!isSupported) {
      applyState('unsupported');
      return;
    }

    captureModeRef.current = 'manual';
    captureStartedAtRef.current = Date.now();
    chunksRef.current = [];
    busyRef.current = true;
    (async () => {
      try {
        await ensureStream();
        if (cancelStartRef.current) {
          captureModeRef.current = null;
          return;
        }
        micGrantedRef.current = true;
        applyState('listening');
        capTimerRef.current = setTimeout(() => stopListeningRef.current(), MAX_RECORDING_MS);
      } catch (err) {
        captureModeRef.current = null;
        applyMicError(err);
        teardownRecording();
        applyState('error');
      } finally {
        busyRef.current = false;
      }
    })();
  }, [isSupported, ensureStream, beginManualCapture, applyMicError, applyState, teardownRecording]);

  const stopListening = useCallback(() => {
    if (!recordingRef.current) {
      // Permission prompt still open — cancel the pending start instead.
      if (busyRef.current) cancelStartRef.current = true;
      return;
    }
    if (captureModeRef.current === null) return;
    finishCapture('manual');
  }, [finishCapture]);

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  // Starts (or resumes) always-on background listening for the wake word.
  const startWakeSession = useCallback(() => {
    if (!isSupported) {
      applyState('unsupported');
      return;
    }
    if (busyRef.current) return;
    if (sessionRef.current === 'on') {
      if (stateRef.current === 'idle') enterBackground();
      return;
    }
    if (sessionRef.current === 'starting') return;

    cancelStartRef.current = false;
    sessionRef.current = 'starting';
    busyRef.current = true;
    (async () => {
      try {
        if (!micGrantedRef.current && (await queryMicGranted())) {
          micGrantedRef.current = true;
        }
        if (!micGrantedRef.current) {
          // Browser restriction: the first mic use needs a click on the mic
          // button. Once granted, the session auto-starts from then on.
          sessionRef.current = 'off';
          return;
        }
        if (cancelStartRef.current || sessionRef.current !== 'starting') {
          sessionRef.current = 'off';
          return;
        }
        await ensureStream();
        if (cancelStartRef.current || sessionRef.current !== 'starting') {
          sessionRef.current = 'off';
          if (captureModeRef.current === null) teardownRecording();
          return;
        }
        micGrantedRef.current = true;
        sessionRef.current = 'on';
        enterBackground();
      } catch (err) {
        sessionRef.current = 'off';
        captureModeRef.current = null;
        applyMicError(err);
        teardownRecording();
        applyState('error');
      } finally {
        busyRef.current = false;
      }
    })();
  }, [isSupported, ensureStream, enterBackground, applyMicError, applyState, teardownRecording]);

  // Stops background listening and releases the mic (unless a manual capture
  // is still in progress, which finishes on its own).
  const stopWakeSession = useCallback(() => {
    if (sessionRef.current === 'off') return;
    cancelStartRef.current = true;
    sessionRef.current = 'off';
    if (captureModeRef.current === 'manual') return;
    captureModeRef.current = null;
    chunksRef.current = [];
    pendingSegmentRef.current = null;
    wakeCheckInFlightRef.current = false;
    wakeCheckIdRef.current = '';
    teardownRecording();
    if (stateRef.current === 'waiting' || stateRef.current === 'listening') {
      applyState('idle');
    }
  }, [teardownRecording, applyState]);

  // Pauses wake checks (e.g. while a reply is being spoken) but keeps the
  // mic stream open so listening resumes instantly.
  const pauseWakeListening = useCallback(() => {
    if (sessionRef.current === 'on' && stateRef.current === 'waiting') {
      applyState('idle');
    }
  }, [applyState]);

  const reset = useCallback(() => {
    applyState('idle');
    setTranscript('');
    setError(null);
  }, [applyState]);

  useEffect(() => {
    setIsSecureContext(window.isSecureContext === true);
    const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    setIsSupported(supported);
    if (!supported) applyState('unsupported');

    return () => {
      sessionRef.current = 'off';
      captureModeRef.current = null;
      teardownRecording();
    };
  }, [teardownRecording, applyState]);

  return {
    state,
    transcript,
    error,
    turnId,
    startListening,
    stopListening,
    startWakeSession,
    stopWakeSession,
    pauseWakeListening,
    reset,
    isSupported,
    isSecureContext,
  };
}
