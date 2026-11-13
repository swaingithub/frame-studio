import { describe, expect, it } from 'vitest'
import { detectBeats, nearestBeat, snapTime } from './beatDetect'

/** Synthesises a click track: one impulse per beat of `bpm`. */
function clickTrack(bpm: number, seconds: number, sampleRate = 8000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  const interval = 60 / bpm * sampleRate
  for (let t = Math.round(interval); t < out.length - 10; t += interval) {
    const start = Math.round(t)
    for (let i = 0; i < 400 && start + i < out.length; i++) {
      out[start + i] = Math.exp(-i / 60) * Math.sin((i / sampleRate) * 2 * Math.PI * 440)
    }
  }
  return out
}

describe('detectBeats', () => {
  it('finds a steady 120 BPM click track', () => {
    const info = detectBeats(clickTrack(120, 12), 8000)
    expect(info.bpm).toBeGreaterThanOrEqual(100)
    expect(info.bpm).toBeLessThanOrEqual(140)
    expect(info.beats.length).toBeGreaterThanOrEqual(20)
    // The grid is regular.
    expect(info.beats[1] - info.beats[0]).toBeCloseTo(60 / info.bpm, 1)
  })

  it('finds a slow 80 BPM track', () => {
    const info = detectBeats(clickTrack(80, 14), 8000)
    expect(info.bpm).toBeGreaterThanOrEqual(70)
    expect(info.bpm).toBeLessThanOrEqual(90)
  })

  it('returns nothing for silence or noise too short to analyse', () => {
    expect(detectBeats(new Float32Array(4000), 8000)).toEqual({ bpm: 0, beats: [] })
    expect(detectBeats(new Float32Array(8000), 8000).beats).toHaveLength(0)
  })
})

describe('nearestBeat / snapTime', () => {
  const beats = [0.5, 1.0, 1.5, 2.0]

  it('returns the closest beat within tolerance', () => {
    expect(nearestBeat(1.08, beats)).toBe(1.0)
    expect(nearestBeat(0.6, beats)).toBe(0.5)
  })

  it('returns null (or the input) when nothing is close enough', () => {
    expect(nearestBeat(1.3, beats, 0.1)).toBeNull()
    expect(snapTime(1.3, beats, 0.1)).toBe(1.3)
    expect(snapTime(1.08, beats)).toBe(1.0)
  })
})
