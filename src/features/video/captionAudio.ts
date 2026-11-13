/**
 * Audio extraction for auto-captions. Decodes a clip's asset blob into 16 kHz
 * mono PCM (what Whisper expects) and slices out the trim window. Runs on the
 * main thread because `decodeAudioData` needs an AudioContext.
 */

/** One shared, short-lived decode context (16 kHz = Whisper's input rate). */
let decodeCtx: AudioContext | null = null

function context(): AudioContext {
  if (!decodeCtx || decodeCtx.state === 'closed') {
    decodeCtx = new AudioContext({ sampleRate: 16000 })
  }
  return decodeCtx
}

export async function closeAudioContext(): Promise<void> {
  if (decodeCtx && decodeCtx.state !== 'closed') await decodeCtx.close()
  decodeCtx = null
}

/**
 * Decodes `blob` and returns mono 16 kHz samples for the clip's trim window
 * ([trimStart, trimEnd) in source seconds; null end = decode to the end).
 */
export async function extractClipAudio(blob: Blob, trimStart: number, trimEnd: number | null, maxSeconds = 600): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer()
  const audio = await context().decodeAudioData(buffer)
  const rate = audio.sampleRate
  const from = Math.max(0, Math.min(audio.length, Math.round(trimStart * rate)))
  let to = audio.length
  if (trimEnd !== null) to = Math.min(audio.length, Math.round(trimEnd * rate))
  // Never feed more than ~10 minutes to the model in one go.
  to = Math.min(to, from + Math.round(maxSeconds * rate))
  const channels = audio.numberOfChannels
  const out = new Float32Array(Math.max(0, to - from))
  for (let ch = 0; ch < channels; ch++) {
    const data = audio.getChannelData(ch)
    for (let i = 0; i < out.length; i++) out[i] += data[from + i] / channels
  }
  return out
}
