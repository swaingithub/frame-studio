/**
 * Voiceover captions: transcribes Kokoro-generated voiceover audio to
 * timeline captions using the same Whisper pipeline as auto-captions
 * (whisper-tiny via the captions worker — on-device, opt-in model).
 */

import { extractClipAudio } from './captionAudio'
import { sanitizeSegments, type CaptionSegment, type RawCaptionSegment } from './captions'

interface WorkerReply {
  type: 'segments' | 'progress' | 'ready' | 'error'
  segments?: RawCaptionSegment[]
  message?: string
}

let worker: Worker | null = null

/** One worker for all voiceover transcriptions (model cached inside it). */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/**
 * Transcribes a voiceover WAV into caption segments (timestamps relative to
 * the start of the WAV, in sequence-time seconds of the owner voiceover).
 */
export async function transcribeVoiceoverWav(blob: Blob, onProgress?: () => void): Promise<CaptionSegment[]> {
  const audio = await extractClipAudio(blob, 0, null)
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const onMessage = (event: MessageEvent<WorkerReply>): void => {
      const reply = event.data
      if (reply.type === 'segments') {
        w.removeEventListener('message', onMessage)
        resolve(sanitizeSegments(reply.segments))
      } else if (reply.type === 'error') {
        w.removeEventListener('message', onMessage)
        reject(new Error(reply.message ?? 'Transcription failed.'))
      } else {
        // progress / ready — ignore; the model download is cached in the worker
        onProgress?.()
      }
    }
    w.addEventListener('message', onMessage)
    const buffer = audio.buffer as ArrayBuffer
    w.postMessage({ type: 'transcribe', audio }, [buffer])
  })
}
