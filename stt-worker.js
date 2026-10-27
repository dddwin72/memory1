// Turns saved recordings into text with Whisper, entirely on the device.
// The model downloads once from Hugging Face and the browser caches it.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let asrModel = '';

async function load(model, onProgress) {
  if (asr && asrModel === model) return asr;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  asr = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: onProgress,
  });
  asrModel = model;
  return asr;
}

self.onmessage = async ({ data }) => {
  const { id, audio, model } = data;
  try {
    const files = {};
    const transcriber = await load(model, (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file] = [p.loaded, p.total];
      let loaded = 0, total = 0;
      for (const [l, t] of Object.values(files)) { loaded += l; total += t; }
      self.postMessage({ id, type: 'download', loaded, total });
    });
    self.postMessage({ id, type: 'running' });
    const out = await transcriber(audio, {
      language: 'korean',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) || '';
    self.postMessage({ id, type: 'done', text: text.replace(/\s+/g, ' ').trim() });
  } catch (e) {
    self.postMessage({ id, type: 'error', message: String((e && e.message) || e) });
  }
};
