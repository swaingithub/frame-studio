import type { VideoEditDoc } from './model'

/**
 * Video export helpers. The stage engine plays the sequence (or a single clip
 * range) through the composited preview canvas in real time; the recorder
 * captures that canvas plus the mixed audio (clips + music) via WebAudio.
 */

/** Effective trim bounds for a doc + duration; the full clip when untrimmed. */
export function trimBounds(doc: VideoEditDoc, duration: number): { start: number; end: number } {
  const end = doc.trimEnd ?? Math.max(0, duration)
  return { start: Math.min(doc.trimStart, end), end: Math.max(doc.trimStart, end) }
}

/** Clamps a requested playhead into the playable region. */
export function clampToRange(t: number, bounds: { start: number; end: number }): number {
  return Math.min(bounds.end, Math.max(bounds.start, t))
}

export function exportClipName(baseName: string, format: string): string {
  const clean = baseName.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, '_')
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  return `${clean}-clip-${stamp}.${format}`
}

export function exportSequenceName(baseName: string, format: string): string {
  const clean = baseName.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, '_')
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  return `${clean}-video-${stamp}.${format}`
}

/** Container/codec MediaRecorder should produce, and the matching file suffix. */
export interface RecorderFormat {
  mimeType: string
  ext: 'webm' | 'mp4'
}

/**
 * Preference order: WebM (best support on Chrome/Firefox/Android) then MP4
 * H.264 (Safari/iOS, which cannot record WebM). The first supported one wins.
 */
export const RECORDER_CANDIDATES: readonly RecorderFormat[] = [
  { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mimeType: 'video/mp4', ext: 'mp4' },
]

/** Pure selection helper (exported so the fallback order is unit-testable). */
export function pickRecorderFormat(isSupported: (mimeType: string) => boolean): RecorderFormat | null {
  return RECORDER_CANDIDATES.find((candidate) => isSupported(candidate.mimeType)) ?? null
}

/** Picks the best supported recording profile for this browser. */
export function recorderFormat(): RecorderFormat | null {
  if (typeof MediaRecorder === 'undefined') return null
  return pickRecorderFormat((type) => MediaRecorder.isTypeSupported(type))
}

/** Backwards-compatible helper: the chosen MIME type, if any. */
export function recorderMimeType(): string | null {
  return recorderFormat()?.mimeType ?? null
}

/** Resolves on the next `seeked` event (or immediately if already there). */
export function seeked(video: HTMLVideoElement, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, timeoutMs)
    video.addEventListener('seeked', finish)
    // Already within a hair of the target?
    if (video.readyState >= 2) window.setTimeout(finish, 50)
  })
}

/** Convenience: kicks off a blob download the same way the photo exporter does. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.addEventListener('click', () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  })
  a.click()
  a.remove()
}

// ---------------------------------------------------------------------------
// Audio mixing — one shared AudioContext; MediaElementSource nodes are cached
// per element (creating them twice throws).
// ---------------------------------------------------------------------------

let sharedAudioCtx: AudioContext | null = null
const sourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

function audioCtx(): AudioContext {
  if (!sharedAudioCtx) sharedAudioCtx = new AudioContext()
  return sharedAudioCtx
}

/** The shared mixing context (WebCodecs export needs its sample rate too). */
export function audioContext(): AudioContext {
  return audioCtx()
}

export interface MixedAudio {
  track: MediaStreamTrack
  /** Detaches this export's destination connections (keeps the element cached). */
  dispose: () => void
}

/**
 * Mixes the given media elements into one audio track. Elements stay audible
 * (connected to the speakers too), so export playback behaves like preview.
 * Call `dispose()` when the recording finishes so repeated exports do not
 * accumulate destination-node connections.
 */
export function mixElements(elements: HTMLMediaElement[]): MixedAudio | null {
  if (elements.length === 0) return null
  try {
    const ctx = audioCtx()
    if (ctx.state === 'suspended') void ctx.resume()
    const dest = ctx.createMediaStreamDestination()
    const connected: MediaElementAudioSourceNode[] = []
    for (const element of elements) {
      let source: MediaElementAudioSourceNode | undefined = sourceCache.get(element)
      if (!source) {
        source = ctx.createMediaElementSource(element)
        sourceCache.set(element, source)
        source.connect(ctx.destination) // keep monitoring routed permanently
      }
      source.connect(dest)
      connected.push(source)
    }
    if (connected.length === 0) return null
    const track = dest.stream.getAudioTracks()[0]
    if (!track) return null
    const dispose = (): void => {
      for (const source of connected) {
        try {
          source.disconnect(dest)
        } catch {
          // already disconnected
        }
      }
    }
    return { track, dispose }
  } catch {
    return null // no audio available — record video only
  }
}

/**
 * Connects the given media elements to `node` on `ctx` (creating + caching
 * the MediaElementSource per element, like mixElements does). Elements stay
 * audible — their monitor connection to the speakers is kept.
 */
export function connectElements(
  ctx: AudioContext,
  elements: HTMLMediaElement[],
  node: AudioNode,
): { disconnect: () => void } {
  const connected: MediaElementAudioSourceNode[] = []
  for (const element of elements) {
    let source: MediaElementAudioSourceNode | undefined = sourceCache.get(element)
    if (!source) {
      source = ctx.createMediaElementSource(element)
      sourceCache.set(element, source)
      source.connect(ctx.destination) // keep monitoring routed permanently
    }
    source.connect(node)
    connected.push(source)
  }
  return {
    disconnect: (): void => {
      for (const source of connected) {
        try {
          source.disconnect(node)
        } catch {
          // already disconnected
        }
      }
    },
  }
}

export interface RecordStreamOptions {
  canvas: HTMLCanvasElement
  /** Media elements whose audio should be mixed in. */
  audioElements: HTMLMediaElement[]
  /** Expected duration (seconds) — only used for progress reporting. */
  seconds: number
  /** Starts playback; resolves when the playback engine reports the end. */
  run: () => Promise<void>
  onProgress?: (done: number, total: number) => void
}

/**
 * Records the composited canvas + mixed audio into a video Blob (WebM where
 * supported, MP4 H.264 on Safari). `run` is awaited, then the recorder stops.
 */
export async function recordStream(options: RecordStreamOptions): Promise<Blob> {
  const { canvas } = options
  const format = recorderFormat()
  if (!format) throw new Error('Video recording is not supported in this browser.')
  const mimeType = format.mimeType
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas recording is unavailable in this browser.')
  }

  const stream = canvas.captureStream(30)
  const mixed = mixElements(options.audioElements)
  if (mixed) stream.addTrack(mixed.track)

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Recording failed'))
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] as string }))
  })
  // The recorder can fail while `run` is still pending; don't leave the
  // rejection unhandled — the race below will surface it when awaited.
  void done.catch(() => undefined)

  recorder.start(250)
  const startedAt = performance.now()
  // Watchdog: playback should end within its own length plus a grace window.
  // If a decoder stalls, finish the export instead of hanging forever.
  let watchdog = 0
  const timedOut = new Promise<boolean>((resolve) => {
    watchdog = window.setTimeout(() => resolve(false), (Math.max(1, options.seconds) + 5) * 1000)
  })
  try {
    const finished = await Promise.race([options.run().then(() => true), timedOut])
    if (!finished) throw new Error('Recording timed out — playback did not finish.')
  } finally {
    window.clearTimeout(watchdog)
    const elapsed = (performance.now() - startedAt) / 1000
    options.onProgress?.(Math.min(options.seconds, elapsed), options.seconds)
    recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
    mixed?.dispose()
  }
  return done
}
