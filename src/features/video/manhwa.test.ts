import { describe, expect, it } from 'vitest'
import { buildVoiceSyncKeyframes } from './manhwa'
import { ANIM_RANGES, valueAt } from './sequenceAnim'

describe('buildVoiceSyncKeyframes', () => {
  it('fades the panel in as the voice speaks and out at the end', () => {
    const k = buildVoiceSyncKeyframes([], 5)
    expect(k.opacity[0]).toMatchObject({ t: 0, v: 0 })
    expect(valueAt(k.opacity, 0.5, 0)).toBeCloseTo(1, 6)
    expect(valueAt(k.opacity, 4.9, 0)).toBeLessThan(0.2)
  })

  it('swells mid-voice and settles near 1.0 at the end', () => {
    const k = buildVoiceSyncKeyframes([], 5)
    expect(k.scale[0]).toMatchObject({ t: 0, v: 0.8 })
    let peak = 0
    for (let t = 0; t <= 5; t += 0.25) peak = Math.max(peak, valueAt(k.scale, t, 1))
    expect(peak).toBeGreaterThan(1.2)
    expect(valueAt(k.scale, 5, 1)).toBeCloseTo(1, 6)
  })

  it('adds an emphasis peak at each segment start', () => {
    const k = buildVoiceSyncKeyframes([{ start: 1, end: 2.5, text: 'hello there' }], 5)
    expect(valueAt(k.scale, 1, 1)).toBeGreaterThan(1.2)
  })

  it('keeps tracks sorted and values inside the animation ranges', () => {
    const k = buildVoiceSyncKeyframes([{ start: 0.5, end: 1.2, text: 'a' }], 4)
    for (const key of ['scale', 'opacity'] as const) {
      const ts = k[key].map((x) => x.t)
      expect(ts).toEqual([...ts].sort((a, b) => a - b))
      for (const kf of k[key]) {
        expect(kf.v).toBeGreaterThanOrEqual(ANIM_RANGES[key].min - 1e-9)
        expect(kf.v).toBeLessThanOrEqual(ANIM_RANGES[key].max + 1e-9)
      }
    }
    expect(k.x).toEqual([])
    expect(k.y).toEqual([])
  })
})
