/**
 * Video converter: re-encodes any local video to another format/codec/size
 * via WebCodecs (MP4 H.264 + AAC or WebM VP9 + Opus), keeping audio, entirely
 * in the browser — the converted file stays on the user's device. Used by the
 * inspector's Convert tool; doubles as the local "video enhancer"
 * (resolution upscale/downscale via `scale`).
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { evenDimensions, type WcFormat } from './webcodecsExport'
import { audioContext } from './exportVideo'
import { db } from '../../core/db/schema'
import { getBlob } from '../../core/db/blobStore'

export interface ConvertOptions {
  /** Target format — from WC_CANDIDATES. */
  format: WcFormat
  /** Optional resolution scale (0.75 = downscale to 3/4 of the source). */
  scale?: number
  /** Progress of the current encode, 0..1. */
  onProgress?: (t: number, total: number) => void
}

async function loadVideo(blob: Blob): Promise<HTMLVideoElement> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error('Could not load the video.'))
  })
}

/** Decodes the source audio (when present) into a planar AudioBuffer. */
async function loadAudio(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = audioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    return await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Picks an H.264 codec string that fits the target dimensions: Level 3.1
 * supports ≤1280×720 (coded area ≤ 921600); higher levels handle 1080p and
 * beyond. Uses `isConfigSupported` so the ladder is verified, not guessed.
 */
async function pickAvcCodec(w: number, h: number): Promise<string> {
  const candidates = ['avc1.42001f', 'avc1.640028', 'avc1.640029', 'avc1.64002A', 'avc1.640033']
  for (const codec of candidates) {
    try {
      const sup = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 12_000_000, framerate: 30 })
      if (sup.supported) return codec
    } catch {
      /* keep looking */
    }
  }
  return candidates[candidates.length - 1]
}

/** Converts a decoded video element + blob through WebCodecs to `options.format`. */
export async function convertVideoBlob(
  blob: Blob,
  video: HTMLVideoElement,
  options: ConvertOptions,
): Promise<Blob> {
  const { format, onProgress } = options
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    throw new Error('WebCodecs is not available in this browser.')
  }

  const duration = (() => {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
    try {
      const end = video.seekable.end(0)
      if (Number.isFinite(end) && end > 0) return end
    } catch {
      /* no seek range yet */
    }
    return 0
  })()
  if (duration <= 0) throw new Error('Could not determine the video duration.')

  let w = video.videoWidth
  let h = video.videoHeight
  if (!w || !h) throw new Error('The video could not be decoded.')
  if (options.scale && options.scale !== 1) {
    const s = Math.min(1, Math.max(0.05, options.scale))
    w = Math.round(w * s)
    h = Math.round(h * s)
  }
  ({ w, h } = evenDimensions(w, h))
  if (w < 2 || h < 2) throw new Error('The video is too small to convert.')

  const audioBuffer = await loadAudio(blob)
  const videoCodec = format.video === 'avc' ? await pickAvcCodec(w, h) : format.videoCodec

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: format.video, width: w, height: h, frameRate: 30 },
    ...(format.audio && audioBuffer ? { audio: { codec: format.audio, sampleRate: audioBuffer.sampleRate, numberOfChannels: 2 } } : {}),
    firstTimestampBehavior: 'offset',
    fastStart: 'in-memory',
  })

  let videoError: Error | null = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      videoError = err instanceof Error ? err : new Error(String(err))
    },
  })
  videoEncoder.configure({ codec: videoCodec, width: w, height: h, bitrate: 12_000_000, framerate: 30 })

  let audioError: Error | null = null
  let audioEncoder: AudioEncoder | null = null
  if (format.audio && audioBuffer) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        audioError = err instanceof Error ? err : new Error(String(err))
      },
    })
    audioEncoder.configure({ codec: format.audioCodec, sampleRate: audioBuffer.sampleRate, numberOfChannels: 2, bitrate: 128_000 })
  }

  const frameCanvas = document.createElement('canvas')
  frameCanvas.width = w
  frameCanvas.height = h
  const ctx = frameCanvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context.')

  // --- decode → encode loop -------------------------------------------------
  const step = 0.04 // ~25 fps decode/encode cadence
  let t = 0
  let lastKeyAt = -Infinity
  while (t < duration - 0.001) {
    t = Math.min(duration, t + step)
    video.currentTime = t
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true })
      video.addEventListener('error', () => resolve(), { once: true })
    })
    if (video.readyState >= 1) {
      ctx.drawImage(video, 0, 0, w, h)
      const isKey = t - lastKeyAt >= 2.0
      const frame = new VideoFrame(frameCanvas, { timestamp: Math.round(t * 1_000_000), duration: 33_333 })
      videoEncoder.encode(frame, { keyFrame: isKey })
      frame.close()
      if (isKey) lastKeyAt = t
      onProgress?.(t, duration)
    }
  }

  // --- audio → encode --------------------------------------------------------
  if (audioEncoder && audioBuffer) {
    const rate = audioBuffer.sampleRate
    const frames = audioBuffer.length
    const channels = Math.min(audioBuffer.numberOfChannels, 2)
    const planar = new Float32Array(frames * 2)
    for (let c = 0; c < channels; c++) planar.set(audioBuffer.getChannelData(c), c === 0 ? 0 : frames)
    const BLOCK = 1024
    for (let off = 0; off < planar.length; off += BLOCK * 2) {
      const n = Math.min(BLOCK, (planar.length - off) / 2)
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: rate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((off / 2 / rate) * 1_000_000),
        data: planar.subarray(off, off + n * 2),
      })
      audioEncoder.encode(data)
      data.close()
    }
  }

  // --- flush + finalize ------------------------------------------------------
  await videoEncoder.flush().catch((err) => {
    if (videoError === null && err instanceof Error) videoError = err
  })
  videoEncoder.close()
  if (audioEncoder) {
    await audioEncoder.flush().catch((err) => {
      if (audioError === null && err instanceof Error) audioError = err
    })
    audioEncoder.close()
  }
  if (videoError) throw videoError
  if (audioError) throw audioError

  muxer.finalize()
  const buffer = (muxer.target as ArrayBufferTarget).buffer
  if (!buffer || buffer.byteLength < 64) throw new Error('Encoding produced no data.')
  frameCanvas.width = 0
  frameCanvas.height = 0
  return new Blob([buffer], { type: format.mime })
}

/** Converts a stored video asset. Returns the encoded Blob. */
export async function convertVideoAsset(assetId: string, options: ConvertOptions): Promise<Blob> {
  const asset = await db.assets.get(assetId)
  if (!asset) throw new Error('Video not found.')
  const blob = await getBlob({ key: asset.storageKey, storage: asset.storage ?? 'idb' })
  if (!blob) throw new Error('Video is no longer available.')
  const video = await loadVideo(blob)
  try {
    return await convertVideoBlob(blob, video, options)
  } finally {
    URL.revokeObjectURL(video.src ?? '')
  }
}
