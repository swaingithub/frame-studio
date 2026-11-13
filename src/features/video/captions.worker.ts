/**
 * Whisper transcription worker.
 *
 * Loads the (opt-in downloaded) whisper-tiny ONNX model through
 * transformers.js and transcribes raw 16 kHz mono PCM. Kept in a worker so
 * the engine loop and UI stay responsive while the model runs. The model is
 * fetched once from the CDN and cached by the browser — after that the whole
 * pipeline runs fully offline, on-device.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { sanitizeSegments, type RawCaptionSegment } from './captions'

// Never look for local model files — downloads always go to the CDN and are
// then cached by the browser.
env.allowLocalModels = false
// WASM threads need cross-origin isolation headers we don't ship; stay single
// threaded so the first run works out of the box.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

type AsrPipeline = AutomaticSpeechRecognitionPipeline

let transcriber: AsrPipeline | null = null
let loading: Promise<AsrPipeline> | null = null

/** The small model: ~40 MB, good enough for captions and fast on WASM. */
export const WHISPER_MODEL = 'onnx-community/whisper-tiny'

async function getTranscriber(): Promise<AsrPipeline> {
  if (transcriber) return transcriber
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8',
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && typeof info.progress === 'number') {
          self.postMessage({ type: 'progress', stage: 'model', progress: info.progress })
        }
      },
    })
  }
  transcriber = await loading
  self.postMessage({ type: 'ready' })
  return transcriber
}

interface TranscribeRequest {
  type: 'transcribe'
  audio: Float32Array
  /** ISO language code, or undefined for auto-detect. */
  language?: string
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const message = event.data
  if (message?.type !== 'transcribe') return
  try {
    const asr = await getTranscriber()
    self.postMessage({ type: 'progress', stage: 'transcribe', progress: 0 })
    const output = await asr(message.audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(message.language ? { language: message.language } : {}),
    })
    const chunks = Array.isArray(output.chunks) ? output.chunks : []
    const raw = chunks.map((chunk) => {
      const stamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : []
      return { start: stamp[0], end: stamp[1], text: chunk.text }
    })
    const segments: RawCaptionSegment[] = sanitizeSegments(raw)
    self.postMessage({ type: 'segments', segments })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
