import { useCallback, useEffect, useRef, useState } from 'react'
import { getBlob } from '../../core/db/blobStore'
import { db } from '../../core/db/schema'
import { extractClipAudio } from './captionAudio'
import { captionsForSequence, type CaptionSegment, type RawCaptionSegment } from './captions'
import { layoutOf, useVideoEditor } from './store'

/** Lifecycle of a "Generate captions" run. */
export type CaptionStatus = 'idle' | 'loading-model' | 'decoding' | 'transcribing' | 'done' | 'error'

interface WorkerProgress {
  type: 'progress'
  stage: 'model' | 'transcribe'
  progress: number
}
interface WorkerSegments {
  type: 'segments'
  segments: RawCaptionSegment[]
}
interface WorkerError {
  type: 'error'
  message: string
}
type WorkerReply = WorkerProgress | WorkerSegments | WorkerError | { type: 'ready' }

/**
 * Runs Whisper over every clip's trim window (in timeline order), maps the
 * chunks onto the sequence and stores them as caption overlays. The model
 * downloads once from the CDN — clearly labelled in the UI — then runs fully
 * offline on the user's device.
 */
export function useCaptions(): {
  status: CaptionStatus
  progress: number
  error: string | null
  busy: boolean
  generate: (language?: string) => Promise<void>
} {
  const [status, setStatus] = useState<CaptionStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const generate = useCallback(async (language?: string): Promise<void> => {
    const state = useVideoEditor.getState()
    if (state.sequence.length === 0) {
      setError('Add a video clip to the timeline first.')
      setStatus('error')
      return
    }
    const assetList = await db.assets.toArray()
    const blobOf = new Map(assetList.map((a) => [a.id, a]))
    const layout = layoutOf(state.sequence, state.durations)
    const windows = layout.entries.map((entry) => ({
      clipId: entry.clip.id,
      globalStart: entry.globalStart,
      trimStart: entry.clip.edit.trimStart,
      trimEnd: entry.clip.edit.trimEnd,
      speed: entry.clip.edit.speed,
      out: entry.out,
    }))

    setError(null)
    setProgress(0)
    try {
      // Lazy, module-scoped worker — one instance serves every run.
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' })
      }
      const worker = workerRef.current

      const transcripts: RawCaptionSegment[][] = []
      for (let i = 0; i < windows.length; i++) {
        const windowInfo = windows[i]
        const clip = layout.entries[i].clip
        const asset = blobOf.get(clip.assetId)
        if (!asset) {
          transcripts.push([])
          continue
        }
        setStatus('decoding')
        const blob = await getBlob({ key: asset.storageKey, storage: asset.storage })
        if (!blob) {
          transcripts.push([])
          continue
        }
        const audio = await extractClipAudio(blob, windowInfo.trimStart, windowInfo.trimEnd)
        if (audio.length === 0) {
          transcripts.push([])
          continue
        }
        setStatus('transcribing')
        setProgress(i / Math.max(1, windows.length))
        const segments = await new Promise<RawCaptionSegment[]>((resolve, reject) => {
          const onMessage = (event: MessageEvent<WorkerReply>): void => {
            const reply = event.data
            if (reply.type === 'progress') {
              setProgress((i + (reply.stage === 'model' ? reply.progress / 100 : 0.5)) / Math.max(1, windows.length))
              if (reply.stage === 'model') setStatus('loading-model')
              return
            }
            // "ready" fires whenever the model finishes loading — not a reply.
            if (reply.type === 'ready') return
            worker.removeEventListener('message', onMessage)
            if (reply.type === 'segments') resolve(reply.segments)
            else if (reply.type === 'error') reject(new Error(reply.message))
            else reject(new Error('Transcription failed.'))
          }
          worker.addEventListener('message', onMessage)
          const buffer = audio.buffer as ArrayBuffer
          worker.postMessage({ type: 'transcribe', audio, language: language || undefined }, [buffer])
        })
        transcripts.push(segments)
      }

      const captions: CaptionSegment[] = captionsForSequence(windows, transcripts)
      if (captions.length === 0) {
        setError('No speech found in these clips.')
        setStatus('error')
        return
      }
      useVideoEditor.getState().addCaptions(captions)
      setStatus('done')
      setProgress(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [])

  return { status, progress, error, busy: status === 'loading-model' || status === 'decoding' || status === 'transcribing', generate }
}
