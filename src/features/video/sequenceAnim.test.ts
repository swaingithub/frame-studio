import { describe, expect, it } from 'vitest'
import {
  animAt,
  moveKeyframeTime,
  ANIM_DEFAULTS,
  ANIM_RANGES,
  outFractionAt,
  shapeAt,
  shapeMean,
  smoothstep,
  srcFractionAt,
  valueAt,
  type Keyframe,
} from './sequenceAnim'

function key(t: number, v: number, ease: Keyframe['ease'] = 'smooth'): Keyframe {
  return { id: `kf_${t}`, t, v, ease }
}

describe('smoothstep', () => {
  it('pins the endpoints and eases the middle', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6)
    // Ease-in-out: slower than linear near the ends, faster in the middle.
    expect(smoothstep(0.25)).toBeLessThan(0.25)
    expect(smoothstep(0.75)).toBeGreaterThan(0.75)
  })
})

describe('valueAt', () => {
  it('returns the base when there are no keyframes', () => {
    expect(valueAt(undefined, 1.5, 0.75)).toBe(0.75)
    expect(valueAt([], 1.5, 0.75)).toBe(0.75)
  })

  it('holds the first/last key outside the range', () => {
    const track = [key(1, 0.4), key(3, 0.8)]
    expect(valueAt(track, 0, 0.5)).toBe(0.4)
    expect(valueAt(track, 5, 0.5)).toBe(0.8)
  })

  it('interpolates linearly when ease is linear', () => {
    const track = [key(0, 1, 'linear'), key(2, 3, 'linear')]
    expect(valueAt(track, 1, 0)).toBe(2)
  })

  it('eases with the smooth auto-curve', () => {
    const track = [key(0, 0, 'smooth'), key(1, 1, 'smooth')]
    expect(valueAt(track, 0.25, 0)).toBeLessThan(0.25)
    expect(valueAt(track, 0.5, 0)).toBeCloseTo(0.5, 6)
  })
})

describe('shapeMean', () => {
  it('every ramp shape averages exactly 1 so durations never shift', () => {
    for (const curve of ['in', 'out', 'inOut', 'outIn', 'dramatic', 'gentle'] as const) {
      expect(shapeMean(curve)).toBeCloseTo(1, 6)
    }
  })
})

describe('shapeAt / srcFractionAt', () => {
  it('shapes span their endpoints', () => {
    expect(shapeAt('in', 0)).toBeCloseTo(0.3, 6)
    expect(shapeAt('in', 1)).toBeCloseTo(1.7, 6)
    expect(shapeAt('inOut', 0.5)).toBeCloseTo(1.65, 6)
  })

  it('none is identity', () => {
    expect(shapeAt('none', 0.37)).toBe(1)
    expect(srcFractionAt('none', 0.37)).toBeCloseTo(0.37, 6)
  })

  it('srcFractionAt is monotonic 0→1 for every curve', () => {
    for (const curve of ['in', 'out', 'inOut', 'outIn', 'dramatic', 'gentle', 'none'] as const) {
      let prev = -1
      for (let i = 0; i <= 20; i++) {
        const f = srcFractionAt(curve, i / 20)
        expect(f).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = f
      }
      expect(srcFractionAt(curve, 0)).toBeCloseTo(0, 6)
      expect(srcFractionAt(curve, 1)).toBeCloseTo(1, 6)
    }
  })

  it('dramatic and gentle span their endpoints', () => {
    expect(shapeAt('dramatic', 0)).toBeCloseTo(0.1, 6)
    expect(shapeAt('dramatic', 1)).toBeCloseTo(1.9, 6)
    expect(shapeAt('gentle', 0.5)).toBeCloseTo(1, 6)
  })

  it('srcFractionAt integrates the shape exactly (closed-form check)', () => {
    // 'in' is linear 0.3→1.7, so the first half consumes ∫(0.3+1.4u)du = 0.325.
    expect(srcFractionAt('in', 0.5)).toBeCloseTo(0.325, 6)
    // 'inOut' is symmetric, so the first half consumes exactly half.
    expect(srcFractionAt('inOut', 0.5)).toBeCloseTo(0.5, 6)
  })
})

describe('outFractionAt', () => {
  it('inverts srcFractionAt exactly across every curve', () => {
    for (const curve of ['in', 'out', 'inOut', 'outIn', 'dramatic', 'gentle', 'none'] as const) {
      for (let i = 0; i <= 10; i++) {
        const u = i / 10
        expect(outFractionAt(curve, srcFractionAt(curve, u))).toBeCloseTo(u, 6)
      }
      expect(outFractionAt(curve, 0)).toBeCloseTo(0, 6)
      expect(outFractionAt(curve, 1)).toBeCloseTo(1, 6)
      expect(outFractionAt(curve, -1)).toBe(0)
      expect(outFractionAt(curve, 2)).toBe(1)
    }
  })
})

describe('animAt', () => {
  it('falls back to base per property', () => {
    const anim = { scale: [key(0, 2)], x: [], y: [], opacity: [] }
    const out = animAt(anim, 0, ANIM_DEFAULTS)
    expect(out.scale).toBe(2)
    expect(out.x).toBe(ANIM_DEFAULTS.x)
    expect(out.opacity).toBe(1)
  })

  it('ranges cover the sanitizing bounds', () => {
    expect(ANIM_RANGES.scale.min).toBe(0.1)
    expect(ANIM_RANGES.opacity.max).toBe(1)
  })
})

describe('moveKeyframeTime', () => {
  it('moves every key at the instant across all tracks', () => {
    const keys = { scale: [key(1, 2)], x: [key(0.98, 0.5), key(2, 0)], y: [], opacity: [] }
    const next = moveKeyframeTime(keys, 1, 1.5, 10)
    expect(next.scale[0].t).toBe(1.5)
    expect(next.x.find((k) => k.id === 'kf_0.98')?.t).toBe(1.5)
    expect(next.x.find((k) => k.id === 'kf_2')?.t).toBe(2)
    expect(next.scale[0].v).toBe(2)
  })

  it('clamps the target into [0, maxT] and keeps tracks sorted', () => {
    const keys = { scale: [key(2, 3)], x: [], y: [], opacity: [] }
    const next = moveKeyframeTime(keys, 2, 99, 4)
    expect(next.scale[0].t).toBe(4)
  })

  it('never crosses a neighbouring key — the drag clamps before it', () => {
    const keys = { scale: [key(1, 1), key(3, 9)], x: [], y: [], opacity: [] }
    const next = moveKeyframeTime(keys, 3, 1, 10)
    // Stops just short of the key at 1 instead of swallowing it.
    expect(next.scale).toHaveLength(2)
    expect(next.scale.find((k) => k.v === 9)?.t).toBeCloseTo(1.06, 6)
    expect(next.scale.find((k) => k.v === 1)?.t).toBe(1)
  })

  it('returns the same set when nothing sits at `from`', () => {
    const keys = { scale: [key(1, 1)], x: [], y: [], opacity: [] }
    expect(moveKeyframeTime(keys, 5, 2, 10)).toBe(keys)
  })
})
