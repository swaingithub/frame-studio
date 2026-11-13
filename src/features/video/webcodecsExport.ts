/**
 * WebCodecs export: encodes the composited preview canvas frame-by-frame
 * through VideoEncoder and the mixed clip/music audio through AudioEncoder,
 * muxed into a real MP4 (H.264 + AAC). Compared to the MediaRecorder path
 * this gives fixed-rate precise frames (no dropped/skewed capture), a
 * broadly compatible container and hardware encoders where available.
 *
 * Everything still runs in real time (the engine plays the sequence while we
 * encode); this module only upgrades the encoder/container. The stage falls
 * back to the MediaRecorder path when WebCodecs is unavailable or errors.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { audioContext, connectElements, type RecordStreamOptions } from './exportVideo'

export interface WcFormat {
  /** Muxer video codec id. */
  video: 'avc' | 'vp9'
  /** Muxer audio codec id. */
  audio: 'aac' | 'opus'
  /** Codec strings for the encoders. */
  videoCodec: string
  audioCodec: string
  /** Container/extension this format produces. */
  mime: 'video/mp4' | 'video/webm'
  ext: 'mp4' | 'webm'
}

/** Candidate formats, best first: MP4 (H.264/AAC), then Opus-in-MP4, then WebM. */
export const WC_CANDIDATES: readonly WcFormat[] = [
  { video: 'avc', audio: 'aac', videoCodec: 'avc1.42001f', audioCodec: 'mp4a.40.2', mime: 'video/mp4', ext: 'mp4' },
  { video: 'avc', audio: 'opus', videoCodec: 'avc1.42001f', audioCodec: 'opus', mime: 'video/mp4', ext: 'mp4' },
  { video: 'vp9', audio: 'opus', videoCodec: 'vp09.00.10.08', audioCodec: 'opus', mime: 'video/webm', ext: 'webm' },
]

/**
 * Async capability probe (VideoEncoder/AudioEncoder must exist and accept a
 * config). Returns the first fully supported format, or null → the
 * MediaRecorder path is used instead.
 */
export async function pickWcFormat(): Promise<WcFormat | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null
  const probeVideo = async (codec: string): Promise<boolean> => {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width: 640, height: 360, bitrate: 8_000_000, framerate: 30 })
      return support?.supported === true
    } catch {
      return false
    }
  }
  const probeAudio = async (codec: string, sampleRate: number): Promise<boolean> => {
    try {
      const support = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate: 128_000 })
      return support?.supported === true
    } catch {
      return false
    }
  }
  const rate = audioContext().sampleRate
  for (const candidate of WC_CANDIDATES) {
    if (await probeVideo(candidate.videoCodec)) {
      if (await probeAudio(candidate.audioCodec, rate)) return candidate
    }
  }
  return null
}

/** MP4 requires even dimensions; clamp down to the previous even value. */
export function evenDimensions(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(2, w - (w % 2)), h: Math.max(2, h - (h % 2)) }
}

/** Microseconds since start (VideoFrame/AudioData timestamp unit). */
export function micros(startedAt: number, now: number): number {
  return Math.max(0, Math.round((now - startedAt) * 1000))
}

export interface RecordWebCodecsOptions extends RecordStreamOptions {
  /** Chosen format (from pickWcFormat). */
  format: WcFormat
}

/** Throttle target: encode at ~30 fps regardless of display refresh rate. */
const FRAME_INTERVAL_US = 33_333
/** Keyframe roughly every 2 seconds. */
const KEYFRAME_INTERVAL_S = 2

/**
 * Encodes the canvas + mixed audio while `run()` plays the sequence. Mirrors
 * `recordStream`'s contract (same options, same Blob result) so the stage can
 * swap between the two transparently.
 */
export async function recordWebCodecs(options: RecordWebCodecsOptions): Promise<Blob> {
  const { canvas, format } = options
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    throw new Error('WebCodecs is not available in this browser.')
  }
  const { w, h } = evenDimensions(canvas.width, canvas.height)
  if (w < 2 || h < 2) throw new Error('Canvas is too small to encode.')

  const ctx = audioContext()
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  const rate = ctx.sampleRate

  // --- audio capture: elements → script processor → AudioEncoder -----------
  interface AudioChunk {
    // Planar F32 data for one 4096-frame block, 2 channels.
    left: Float32Array
    right: Float32Array
    frames: number
  }
  let audioPump: { node: ScriptProcessorNode; disconnect: () => void } | null = null
  const audioQueue: AudioChunk[] = []
  let audioFrames = 0
  let audioError: Error | null = null
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      audioError = err instanceof Error ? err : new Error(String(err))
    },
  })

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: format.video, width: w, height: h, frameRate: 30 },
    ...(options.audioElements.length > 0 ? { audio: { codec: format.audio, sampleRate: rate, numberOfChannels: 2 } } : {}),
    // Wall-clock capture starts the first frame ~1 frame after t=0; 'offset'
    // rebases all timestamps to zero ('strict', the default, would reject
    // every chunk and leave the muxer with an empty track).
    firstTimestampBehavior: 'offset',
    fastStart: 'in-memory',
  })

  const configureAudio = async (): Promise<boolean> => {
    if (options.audioElements.length === 0) return false
    try {
      audioEncoder.configure({ codec: format.audioCodec, sampleRate: rate, numberOfChannels: 2, bitrate: 128_000 })
      return true
    } catch {
      return false
    }
  }
  const hasAudio = await configureAudio()

  if (hasAudio) {
    const node = ctx.createScriptProcessor(4096, 2, 2)
    // Zero-gain path so Chrome keeps pumping the processor without doubling
    // the audible monitor feed.
    const silent = ctx.createGain()
    silent.gain.value = 0
    const link = connectElements(ctx, options.audioElements, node)
    node.onaudioprocess = (event) => {
      if (audioError) return
      const input = event.inputBuffer
      const left = new Float32Array(input.getChannelData(0))
      const right = new Float32Array(input.numberOfChannels > 1 ? input.getChannelData(1) : input.getChannelData(0))
      audioQueue.push({ left, right, frames: left.length })
      audioFrames += left.length
    }
    node.connect(silent).connect(ctx.destination)
    audioPump = {
      node,
      disconnect: (): void => {
        link.disconnect()
        try {
          node.disconnect()
          silent.disconnect()
        } catch {
          // already disconnected
        }
      },
    }
  }

  // --- video encoder --------------------------------------------------------
  let videoError: Error | null = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      videoError = err instanceof Error ? err : new Error(String(err))
    },
  })
  videoEncoder.configure({ codec: format.videoCodec, width: w, height: h, bitrate: 12_000_000, framerate: 30 })

  let raf = 0
  let lastKeyAt = -Infinity
  let lastEncodeUs = -Infinity
  let pumpError: Error | null = null

  const done = new Promise<Blob>((resolve, reject) => {
    options.run().then(
      () => resolve(new Blob([''], { type: 'unused' })),
      (err) => {
        pumpError = err instanceof Error ? err : new Error(String(err))
        reject(pumpError)
      },
    )
  })
  void done.catch(() => undefined)

  const startedAt = performance.now()
  const loop = (): void => {
    if (videoError || audioError || pumpError) return
    const now = performance.now()
    const ts = micros(startedAt, now)
    if (ts - lastEncodeUs >= FRAME_INTERVAL_US && canvas.width > 0) {
      try {
        const frame = new VideoFrame(canvas, { timestamp: ts, duration: FRAME_INTERVAL_US })
        videoEncoder.encode(frame, { keyFrame: ts - lastKeyAt >= KEYFRAME_INTERVAL_S * 1_000_000 })
        frame.close()
        if (ts - lastKeyAt >= KEYFRAME_INTERVAL_S * 1_000_000) lastKeyAt = ts
        lastEncodeUs = ts
        options.onProgress?.(Math.min(options.seconds, ts / 1e6), options.seconds)
      } catch (err) {
        videoError = err instanceof Error ? err : new Error(String(err))
        return
      }
    }
    // Drain the audio queue into the encoder.
    while (hasAudio && audioQueue.length > 0) {
      const chunk = audioQueue.shift()
      if (!chunk) break
      try {
        const planar = new Float32Array(chunk.frames * 2)
        planar.set(chunk.left, 0)
        planar.set(chunk.right, chunk.frames)
        const data = new AudioData({
          format: 'f32-planar',
          sampleRate: rate,
          numberOfFrames: chunk.frames,
          numberOfChannels: 2,
          timestamp: Math.round(((audioFrames - chunk.frames) / rate) * 1_000_000),
          data: planar,
        })
        audioEncoder.encode(data)
        data.close()
      } catch (err) {
        audioError = err instanceof Error ? err : new Error(String(err))
        break
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  // Watchdog: playback should end within its own length plus a grace window.
  let watchdog = 0
  const timedOut = new Promise<boolean>((resolve) => {
    watchdog = window.setTimeout(() => resolve(false), (Math.max(1, options.seconds) + 5) * 1000)
  })
  try {
    const finished = await Promise.race([done.then(() => true), timedOut])
    if (!finished) throw new Error('Recording timed out — playback did not finish.')
    if (videoError) throw videoError
    if (audioError) throw audioError
  } finally {
    window.clearTimeout(watchdog)
    cancelAnimationFrame(raf)
    audioPump?.disconnect()
  }

  // Flush BEFORE closing: the hardware H.264 encoder only emits its buffered
  // chunks (including the avcC decoder description) on flush, and flushing a
  // closed encoder is a no-op — closing first left the muxer with no track
  // data and crashed at finalize.
  await videoEncoder.flush().catch((err) => {
    if (videoError === null && err instanceof Error) videoError = err
  })
  if (hasAudio) {
    await audioEncoder.flush().catch((err) => {
      if (audioError === null && err instanceof Error) audioError = err
    })
  }
  try {
    videoEncoder.close()
  } catch {
    // already closed
  }
  try {
    audioEncoder.close()
  } catch {
    // already closed
  }
  if (videoError) throw videoError
  if (audioError) throw audioError
  muxer.finalize()
  const buffer = (muxer.target as ArrayBufferTarget).buffer
  if (!buffer || buffer.byteLength < 64) throw new Error('Encoding produced no data.')
  return new Blob([buffer], { type: format.mime })
}
