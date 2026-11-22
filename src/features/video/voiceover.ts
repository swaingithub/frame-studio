/**
 * Voiceover TTS (Kokoro, on-device): generates spoken audio from text via
 * kokoro-js + the ONNX Community Kokoro port, entirely in the browser. The
 * model is ~92 MB (q8 quantized) — it downloads once, then is cached by the
 * browser. No upload, no API key, no account — like the rest of the app.
 */

import { KokoroTTS, type GenerateOptions } from 'kokoro-js'

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let ttsInstance: KokoroTTS | null = null

/** Lazy KokoroTTS singleton — downloads + warms on first use. */
export async function getKokoroTTS(): Promise<KokoroTTS> {
  if (!ttsInstance) {
    ttsInstance = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
    })
  }
  return ttsInstance
}

/** Voice names Kokoro supports, from the loaded model. */
export async function kokoroVoiceNames(): Promise<string[]> {
  const tts = await getKokoroTTS()
  return Object.keys(tts.voices)
}

type KokoroVoice = NonNullable<GenerateOptions['voice']>

/**
 * Generates speech from `text` and returns it as a WAV blob (16-bit PCM,
 * mono) + duration in seconds.
 */
export async function generateVoiceover(
  text: string,
  voice: string,
  onProgress?: (stage: 'model' | 'generate', done: number) => void,
): Promise<{ blob: Blob; duration: number }> {
  const tts = await getKokoroTTS()
  onProgress?.('generate', 0)
  const raw = await tts.generate(text, { voice: voice as KokoroVoice })
  const blob = encodeWav(raw.audio, raw.sampling_rate)
  onProgress?.('generate', 1)
  return { blob, duration: raw.audio.length / raw.sampling_rate }
}

/** Minimal 16-bit PCM mono WAV encoder from a float32 PCM buffer. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const write = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i))
  }
  write(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM format tag
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  write(36, 'data')
  v.setUint32(40, dataLen, true)
  const out = new Int16Array(buf, 44, samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  }
  return new Blob([buf], { type: 'audio/wav' })
}
