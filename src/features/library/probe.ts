/**
 * Metadata probing for videos and audio via media elements.
 * (When WebCodecs lands in Phase 4 this becomes an optimization path;
 * element-based probing stays the universal fallback.)
 */

export interface VideoMeta {
  duration: number
  width: number
  height: number
  thumb: Blob | null
}

export interface AudioMeta {
  duration: number
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.85)
    } catch {
      resolve(null)
    }
  })
}

function drawStill(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const MAX_EDGE = 480
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvasToBlob(canvas)
}

/**
 * Streaming WebMs (MediaRecorder output) report a non-finite duration until
 * the demuxer has seen the file end. Seeking far past the end forces the
 * browser to scan the whole file, after which `durationchange` carries the
 * true value. Resolves the finite duration, or rejects on timeout.
 */
export function resolveElementDuration(video: HTMLVideoElement, timeoutMs = 5000): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(video.duration)
  return new Promise((resolve, reject) => {
    const done = (value: number): void => {
      video.removeEventListener('durationchange', onChange)
      window.clearTimeout(timer)
      resolve(value)
    }
    const onChange = (): void => {
      if (Number.isFinite(video.duration) && video.duration > 0) done(video.duration)
    }
    const timer = window.setTimeout(() => {
      video.removeEventListener('durationchange', onChange)
      reject(new Error('Could not determine this video\u2019s duration.'))
    }, timeoutMs)
    video.addEventListener('durationchange', onChange)
    // ±1e101 is the canonical "seek the demuxer to the end" value. Some
    // browsers clamp instead of honoring huge values; try both.
    try {
      video.currentTime = 1e101
      if (!Number.isFinite(video.duration) || video.duration <= 0) video.currentTime = video.seekable.end(0) ?? 0
    } catch {
      // No seekable range yet — the durationchange listener is already armed.
    }
  })
}

/** Loads video metadata and captures one thumbnail frame at ~10% duration. */
export function probeVideo(file: File | Blob): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'

    const cleanup = (): void => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }

    const fail = (message: string): void => {
      cleanup()
      reject(new Error(message))
    }

    video.onloadedmetadata = () => {
      const { videoWidth, videoHeight } = video
      if (videoWidth === 0) {
        fail('This video has no decodable picture track in this browser.')
        return
      }
      void resolveElementDuration(video)
        .then((realDuration) => {
          const at = Math.min(Math.max(realDuration * 0.1, 0), realDuration - 0.05)
          const seekTimeout = window.setTimeout(() => {
            void drawStill(video, videoWidth, videoHeight).then((thumb) => {
              cleanup()
              resolve({ duration: realDuration, width: videoWidth, height: videoHeight, thumb })
            })
          }, 4000)
          video.onseeked = () => {
            window.clearTimeout(seekTimeout)
            void drawStill(video, videoWidth, videoHeight).then((thumb) => {
              cleanup()
              resolve({ duration: realDuration, width: videoWidth, height: videoHeight, thumb })
            })
          }
          try {
            video.currentTime = at
          } catch {
            window.clearTimeout(seekTimeout)
            void drawStill(video, videoWidth, videoHeight).then((thumb) => {
              cleanup()
              resolve({ duration: realDuration, width: videoWidth, height: videoHeight, thumb })
            })
          }
        })
        .catch((err: unknown) => {
          cleanup()
          reject(err instanceof Error ? err : new Error('Cannot probe this video.'))
        })
    }
    video.onerror = () => fail('Cannot decode this video format in this browser.')
    video.src = url
  })
}

/** Reads audio duration via the `<audio>` element metadata. */
export function probeAudio(file: File | Blob): Promise<AudioMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    const cleanup = (): void => {
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
      audio.load()
    }
    audio.onloadedmetadata = () => {
      const { duration } = audio
      cleanup()
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Cannot read audio duration in this browser.'))
        return
      }
      resolve({ duration })
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('Cannot decode this audio format in this browser.'))
    }
    audio.src = url
  })
}
