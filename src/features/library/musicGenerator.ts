/**
 * Local music generator.
 *
 * Synthesizes original, royalty-free music entirely in the browser using the
 * Web Audio API. Nothing is downloaded, nothing is streamed, nothing leaves
 * your machine. Output is a WAV file you can import into Frame Studio's
 * library and use in any project.
 *
 * The generator picks a key, writes a chord progression, lays a melody over
 * it, adds bass + drums + pad, and renders through an OfflineAudioContext.
 */

const SAMPLE_RATE = 44100

/** Chromatic note frequencies (A4 = 440). */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Major / minor scales as semitone offsets from root. */
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
}

export const MOODS: Record<string, {
  scale: keyof typeof SCALES
  root: number // index into NOTE_NAMES
  bpm: number
  bars: number
  chords: number[] // degree offsets within scale
}> = {
  chill: { scale: 'major', root: 7, bpm: 84, bars: 8, chords: [0, 5, 3, 4] }, // G - D - Em - C
  upbeat: { scale: 'major', root: 0, bpm: 120, bars: 8, chords: [0, 2, 4, 5] }, // C - Dm - F - G
  ambient: { scale: 'minor', root: 5, bpm: 60, bars: 6, chords: [0, 3, 1, 0] }, // F - Dm - Gm - F
  cinematic: { scale: 'minor', root: 2, bpm: 70, bars: 8, chords: [0, 1, 3, 5] }, // Dm - Em - F - G
  gentle: { scale: 'major', root: 7, bpm: 72, bars: 8, chords: [5, 0, 3, 4] }, // D - G - Em - C
  hiphop: { scale: 'minor', root: 9, bpm: 88, bars: 8, chords: [0, 2, 4, 0] }, // Am - Bm - D - Am
  corporate: { scale: 'major', root: 4, bpm: 110, bars: 8, chords: [4, 0, 5, 2] }, // E - C - G - Dm
  horror: { scale: 'minor', root: 4, bpm: 50, bars: 6, chords: [0, 4, 0, 4] }, // Em - C - Em - C
  retrowave: { scale: 'major', root: 0, bpm: 118, bars: 8, chords: [0, 6, 5, 4] }, // C - Am - G - F
}

/** MIDI note → frequency. */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Note name + octave → midi. */
function nameToMidi(name: string, octave: number): number {
  const pc = NOTE_NAMES.indexOf(name)
  if (pc < 0) return 60
  return (octave + 1) * 12 + pc
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Simple linear congruential rng so tracks are reproducible given a seed. */
class Rng {
  private seed: number
  constructor(seed: number) {
    this.seed = seed
  }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return (this.seed >>> 0) / 0xffffffff
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
}

// ---------------------------------------------------------------------------
// Synthesis voices
// ---------------------------------------------------------------------------

/** Plucked string-ish voice: two detuned saws with fast decay. */
function pluck(
  ctx: OfflineAudioContext,
  t0: number,
  dur: number,
  freq: number,
  gain: number,
): void {
  const detune = [0, 7]
  detune.forEach((d) => {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'sawtooth'
    osc.detune.setValueAtTime(d, t0)
    osc.frequency.setValueAtTime(freq, t0)
    osc.connect(env)
    env.connect(ctx.destination)
    env.gain.setValueAtTime(gain * 0.5, t0)
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.6)
    osc.start(t0)
    osc.stop(t0 + dur)
  })
}

/** Soft pad voice: triangle + sine with slow attack. */
function pad(
  ctx: OfflineAudioContext,
  t0: number,
  dur: number,
  freq: number,
  gain: number,
): void {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, t0)
  osc.connect(env)
  env.connect(ctx.destination)
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(gain * 0.3, t0 + 0.5)
  env.gain.linearRampToValueAtTime(0, t0 + dur)
  osc.start(t0)
  osc.stop(t0 + dur)
}

/** Bass: sine with slight square layer, fast attack, slow release. */
function bass(
  ctx: OfflineAudioContext,
  t0: number,
  dur: number,
  freq: number,
  gain: number,
): void {
  [freq, freq / 2].forEach((f, i) => {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = i === 0 ? 'sine' : 'square'
    osc.frequency.setValueAtTime(f, t0)
    osc.connect(env)
    env.connect(ctx.destination)
    env.gain.setValueAtTime(gain * (i === 0 ? 1 : 0.4), t0)
    env.gain.linearRampToValueAtTime(0, t0 + dur * 0.8)
    osc.start(t0)
    osc.stop(t0 + dur * 0.9)
  })
}

/** Kick drum: sine pitch slide + noise burst. */
function kick(ctx: OfflineAudioContext, t0: number, gain: number): void {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, t0)
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.15)
  osc.connect(env)
  env.connect(ctx.destination)
  env.gain.setValueAtTime(gain, t0)
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18)
  osc.start(t0)
  osc.stop(t0 + 0.18)

  const n = ctx.createBufferSource()
  const b = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 400)
  n.buffer = b
  const nEnv = ctx.createGain()
  n.connect(nEnv)
  nEnv.connect(ctx.destination)
  nEnv.gain.setValueAtTime(gain * 0.4, t0)
  nEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06)
  n.start(t0)
  n.stop(t0 + 0.06)
}

/** Snare: noise + tone. */
function snare(ctx: OfflineAudioContext, t0: number, gain: number): void {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(180, t0)
  osc.connect(env)
  env.connect(ctx.destination)
  env.gain.setValueAtTime(gain * 0.3, t0)
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
  osc.start(t0)
  osc.stop(t0 + 0.12)

  const n = ctx.createBufferSource()
  const b = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  n.buffer = b
  const nEnv = ctx.createGain()
  n.connect(nEnv)
  nEnv.connect(ctx.destination)
  nEnv.gain.setValueAtTime(gain * 0.5, t0)
  nEnv.gain.linearRampToValueAtTime(0, t0 + 0.12)
  n.start(t0)
  n.stop(t0 + 0.12)
}

/** Closed hi-hat: noise bandpass-ish. */
function hat(ctx: OfflineAudioContext, t0: number, gain: number, open = false): void {
  const n = ctx.createBufferSource()
  const b = ctx.createBuffer(1, ctx.sampleRate * (open ? 0.3 : 0.08), ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (open ? 60 : 30))
  n.buffer = b
  const nEnv = ctx.createGain()
  n.connect(nEnv)
  nEnv.connect(ctx.destination)
  nEnv.gain.setValueAtTime(gain, t0)
  nEnv.gain.exponentialRampToValueAtTime(0.001, t0 + (open ? 0.25 : 0.06))
  n.start(t0)
  n.stop(t0 + (open ? 0.3 : 0.08))
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface NoteEvent {
  t: number
  dur: number
  freq: number
  gain: number
  kind: 'pluck' | 'pad' | 'bass' | 'kick' | 'snare' | 'hat'
}

function degreeFreq(keyRoot: number, scale: number[], degree: number, octave: number): number {
  const pc = (keyRoot + scale[degree % scale.length]) % 12
  // wrap octave as we climb past B
  const laps = Math.floor((keyRoot + scale[degree % scale.length]) / 12)
  return midiToFreq(nameToMidi(NOTE_NAMES[pc], octave + laps))
}

function chordFreqs(keyRoot: number, scale: number[], rootDeg: number, octave: number): number[] {
  // triad: root, third, fifth (scale degrees 0, 2, 4)
  return [0, 2, 4].map((i) => degreeFreq(keyRoot, scale, rootDeg + i, octave))
}

/**
 * Composes the note events for one original track. Pure — no audio context,
 * so it's fully testable and runs in any environment.
 */
export function composeEvents(mood: keyof typeof MOODS, seed = Date.now()): {
  events: NoteEvent[]
  bpm: number
  totalSecs: number
  title: string
} {
  const style = MOODS[mood]
  const rng = new Rng(seed)
  const scale = SCALES[style.scale]
  const root = style.root
  const bpm = style.bpm
  const spb = 60 / bpm // seconds per beat
  const bar = spb * 4
  const totalSecs = style.bars * bar
  const events: NoteEvent[] = []

  // ---- chord progression: pick `style.bars` chords from the mood's list ----
  const progression: number[] = []
  for (let i = 0; i < style.bars; i++) {
    progression.push(rng.choice(style.chords))
  }

  // ---- pads: whole-note chords, one per bar ----
  for (let b = 0; b < style.bars; b++) {
    const deg = progression[b]
    const t = b * bar
    const dur = bar * 0.95
    const fs = chordFreqs(root, scale, deg, 3)
    fs.forEach((f) => events.push({ t, dur, freq: f, gain: 0.06, kind: 'pad' }))
  }

  // ---- pluck melody: 2 notes per bar, scale-aware, occasional leaps ----
  let melodyDeg = 4
  for (let b = 0; b < style.bars; b++) {
    const deg = progression[b]
    const barStart = b * bar
    for (let n = 0; n < 2; n++) {
      const t = barStart + n * (bar / 2) + rng.range(0, 0.05)
      let nextDeg = melodyDeg + rng.choice([-2, -1, 0, 1, 2, 0])
      // keep melody near the current chord tones sometimes
      if (rng.next() < 0.5) nextDeg = deg + rng.choice([0, 2, 4])
      nextDeg = clamp(nextDeg, 0, 12)
      melodyDeg = nextDeg
      const f = degreeFreq(root, scale, nextDeg, 5)
      events.push({ t, dur: bar / 2 * 0.7, freq: f, gain: 0.14, kind: 'pluck' })
    }
  }

  // ---- bass: root + fifth on beat 1 and 3 of each bar ----
  for (let b = 0; b < style.bars; b++) {
    const deg = progression[b]
    const barStart = b * bar
    const f = degreeFreq(root, scale, deg, 2)
    events.push({ t: barStart, dur: bar * 0.5, freq: f, gain: 0.22, kind: 'bass' })
    events.push({ t: barStart + bar / 2, dur: bar * 0.5, freq: degreeFreq(root, scale, deg + 4, 1), gain: 0.16, kind: 'bass' })
  }

  // ---- drums ----
  const kickEvery = mood === 'hiphop' ? 2 : 1 // kick on every beat or every other
  for (let beat = 0; beat <= style.bars * 4; beat += kickEvery) {
    const t = beat * spb
    if (t > totalSecs - 0.2) break
    events.push({ t, dur: 0.18, freq: 0, gain: 0.5, kind: 'kick' })
  }
  for (let beat = 2; beat <= style.bars * 4; beat += 2) {
    const t = beat * spb
    if (t > totalSecs - 0.2) break
    events.push({ t, dur: 0.12, freq: 0, gain: 0.3, kind: 'snare' })
  }
  for (let eighth = 0; eighth <= style.bars * 8; eighth++) {
    const t = eighth * spb / 2
    if (t > totalSecs - 0.05) break
    const open = eighth % 8 === 0
    events.push({ t, dur: 0.06, freq: 0, gain: open ? 0.18 : 0.09, kind: 'hat' })
  }

  return { events, bpm, totalSecs, title: `${mood.charAt(0).toUpperCase()}${mood.slice(1)} Original` }
}

/** Renders composed note events through an OfflineAudioContext. */
async function renderEvents(ctx: OfflineAudioContext, events: NoteEvent[]): Promise<AudioBuffer> {
  events.forEach((e) => {
    if (e.kind === 'kick') kick(ctx, e.t, e.gain)
    else if (e.kind === 'snare') snare(ctx, e.t, e.gain)
    else if (e.kind === 'hat') hat(ctx, e.t, e.gain)
    else if (e.kind === 'pluck') pluck(ctx, e.t, e.dur, e.freq, e.gain)
    else if (e.kind === 'pad') pad(ctx, e.t, e.dur, e.freq, e.gain)
    else if (e.kind === 'bass') bass(ctx, e.t, e.dur, e.freq, e.gain)
  })
  return ctx.startRendering()
}

/**
 * Generates one original track: composes, renders to audio, encodes as WAV.
 * Returns a WAV Blob + metadata (title, bpm, duration, mood).
 *
 * `ctx` is optional and only used in tests; the browser path creates its own
 * OfflineAudioContext.
 */
export async function generateTrack(
  mood: keyof typeof MOODS,
  seed = Date.now(),
  ctx?: OfflineAudioContext,
): Promise<{
  blob: Blob
  title: string
  duration: number
  bpm: number
}> {
  const { events, bpm, totalSecs, title } = composeEvents(mood, seed)

  const audioCtx = ctx ?? new OfflineAudioContext(2, totalSecs * SAMPLE_RATE, SAMPLE_RATE)
  const rendered = await renderEvents(audioCtx, events)

  // Apply fade in/out + normalize so there are no clicks
  const fade = 0.5
  const left = rendered.getChannelData(0)
  const right = rendered.getChannelData(1)
  let peak = 0
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  const gain = peak > 0 ? Math.min(1, 0.9 / peak) : 1
  const fadeSamples = fade * SAMPLE_RATE
  for (let i = 0; i < left.length; i++) {
    let f = 1
    if (i < fadeSamples) f = i / fadeSamples
    if (i > left.length - fadeSamples) f = (left.length - i) / fadeSamples
    left[i] *= gain * f
    right[i] *= gain * f
  }

  return { blob: wavBlob(rendered), title, duration: totalSecs, bpm }
}

/** Encode an AudioBuffer as WAV (PCM16). */
function wavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const totalSamples = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = totalSamples * blockAlign
  const headerSize = 44
  const buf = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buf)

  const writeString = (off: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let off = headerSize
  for (let i = 0; i < totalSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = clamp(buffer.getChannelData(ch)[i], -1, 1)
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}
