// Kitten TTS worker: runs sherpa-onnx Kitten generation on a worker thread so
// the main event loop is never blocked (model load and synthesis both take
// seconds). Spawned lazily by src/services/tts-kitten.ts and kept alive so
// the model stays in memory between requests (cold load happens once).
//
// Protocol (workerData in, messages out):
//   in : { kitten: { model, voices, tokens, dataDir }, numThreads, provider, speed }
//   out: { type: "ready", loadMs, sampleRate, numSpeakers }         once, after model load
//        { type: "audio", id, sampleRate, samples }                 reply to a speak job
//        { type: "error", id, message }                             job failed
import { parentPort, workerData } from "node:worker_threads";

const { kitten, numThreads, provider, speed } = workerData;

// sherpa-onnx-node is CommonJS and Node's export lexer misses OfflineTts in
// the named exports, so unwrap .default when present.
const mod = await import("sherpa-onnx-node");
const { OfflineTts } = mod.default ?? mod;
if (typeof OfflineTts !== "function") {
  throw new Error("sherpa-onnx-node did not expose OfflineTts");
}

const loadStart = Date.now();
const tts = new OfflineTts({
  model: { kitten },
  numThreads,
  provider,
});
const loadMs = Date.now() - loadStart;

parentPort.postMessage({
  type: "ready",
  loadMs,
  sampleRate: tts.sampleRate,
  numSpeakers: tts.numSpeakers,
});

parentPort.on("message", (msg) => {
  if (!msg || msg.type !== "speak") return;
  try {
    const audio = tts.generate({ text: msg.text, sid: msg.sid, speed });
    // No transferList: the addon's ArrayBuffer is not transferable, so
    // structured clone simply copies the samples (a few hundred KB).
    parentPort.postMessage({
      type: "audio",
      id: msg.id,
      sampleRate: audio.sampleRate,
      samples: audio.samples,
    });
  } catch (err) {
    parentPort.postMessage({
      type: "error",
      id: msg.id,
      message: err && err.message ? err.message : String(err),
    });
  }
});
