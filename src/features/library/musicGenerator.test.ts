import { describe, expect, it } from 'vitest'
import { composeEvents, generateTrack, MOODS } from './musicGenerator'

const MOOD_NAMES = Object.keys(MOODS) as (keyof typeof MOODS)[]

describe('composeEvents', () => {
  it('produces events for every mood', () => {
    for (const mood of MOOD_NAMES) {
      const { events, bpm, totalSecs } = composeEvents(mood, 42)
      expect(events.length).toBeGreaterThan(0)
      expect(bpm).toBeGreaterThan(0)
      expect(totalSecs).toBeGreaterThan(0)
      for (const e of events) {
        expect(typeof e.t).toBe('number')
        expect(typeof e.dur).toBe('number')
        expect(typeof e.freq).toBe('number')
        expect(typeof e.gain).toBe('number')
        expect(['pluck', 'pad', 'bass', 'kick', 'snare', 'hat']).toContain(e.kind)
      }
    }
  })

  it('is deterministic for the same seed', () => {
    const a = composeEvents('chill', 12345)
    const b = composeEvents('chill', 12345)
    expect(a.events).toEqual(b.events)
    expect(a.bpm).toBe(b.bpm)
    expect(a.totalSecs).toBe(b.totalSecs)
  })

  it('produces different events for different seeds', () => {
    const a = composeEvents('chill', 1)
    const b = composeEvents('chill', 2)
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events))
  })

  it('respects different durations per mood', () => {
    const ambient = composeEvents('ambient', 7)
    const cinematic = composeEvents('cinematic', 7)
    expect(ambient.totalSecs).not.toBe(cinematic.totalSecs)
  })

  it('keeps all event times inside the track duration', () => {
    for (const mood of MOOD_NAMES) {
      const { events, totalSecs } = composeEvents(mood, 42)
      for (const e of events) {
        expect(e.t).toBeGreaterThanOrEqual(0)
        expect(e.t + e.dur).toBeLessThanOrEqual(totalSecs + 0.01)
      }
    }
  })

  it('has at least one melodic (pluck) and one bass event', () => {
    const { events } = composeEvents('upbeat', 3)
    expect(events.some((e) => e.kind === 'pluck')).toBe(true)
    expect(events.some((e) => e.kind === 'bass')).toBe(true)
  })

  it('assigns sane frequencies (20 Hz – 12 kHz) to pitched events', () => {
    const { events } = composeEvents('cinematic', 9)
    for (const e of events) {
      if (e.kind === 'kick' || e.kind === 'snare' || e.kind === 'hat') continue
      expect(e.freq).toBeGreaterThan(20)
      expect(e.freq).toBeLessThan(12000)
    }
  })
})

/** Minimal OfflineAudioContext mock sufficient for renderEvents. */
function mockOfflineAudioContext(lengthSamples: number, sampleRate = 44100): OfflineAudioContext {
  const left = new Float32Array(lengthSamples)
  const right = new Float32Array(lengthSamples)
  return {
    sampleRate,
    currentTime: 0,
    destination: { connect: () => undefined },
    createOscillator: () => ({
      type: 'sine' as OscillatorType,
      frequency: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      detune: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
    createBuffer: () => ({
      getChannelData: () => new Float32Array(lengthSamples),
      length: lengthSamples,
      sampleRate,
      channelCount: 2,
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    startRendering: () =>
      Promise.resolve({
        getChannelData: (ch: number) => (ch === 0 ? left : right),
        length: lengthSamples,
        sampleRate,
        channelCount: 2,
        numberOfChannels: 2,
      } as unknown as AudioBuffer),
  } as unknown as OfflineAudioContext
}

describe('generateTrack', () => {
  it('produces a valid WAV blob', async () => {
    const ctx = mockOfflineAudioContext(44100 * 20, 44100)
    const result = await generateTrack('chill', 42, ctx)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.type).toBe('audio/wav')
    expect(result.blob.size).toBeGreaterThan(1000)
    expect(result.duration).toBeGreaterThan(0)
    expect(result.bpm).toBeGreaterThan(0)
    expect(typeof result.title).toBe('string')
  })

  it('is deterministic for the same seed', async () => {
    const ctx = mockOfflineAudioContext(44100 * 20, 44100)
    const a = await generateTrack('chill', 12345, ctx)
    const b = await generateTrack('chill', 12345, mockOfflineAudioContext(44100 * 20, 44100))
    expect(a.blob.size).toBe(b.blob.size)
    expect(a.duration).toBe(b.duration)
  })
})
