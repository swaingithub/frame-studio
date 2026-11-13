import { describe, expect, it } from 'vitest'
import { ADJUSTMENTS_BY_KEY, defaultAdjustments } from './registry'
import { PRESETS, autoValues, filmicCurve, mixValues, presetValues, statsFromHistogram } from './presets'

describe('presets', () => {
  it('produces valid full adjustment sets within param ranges', () => {
    for (const preset of PRESETS) {
      const values = presetValues(preset)
      for (const param of Object.values(ADJUSTMENTS_BY_KEY)) {
        expect(values[param.key]).toBeGreaterThanOrEqual(param.min)
        expect(values[param.key]).toBeLessThanOrEqual(param.max)
      }
    }
  })

  it('changes at least one value from defaults', () => {
    const defaults = defaultAdjustments()
    for (const preset of PRESETS) {
      const values = presetValues(preset)
      const changed = Object.keys(preset.values).some(
        (k) => values[k as keyof typeof values] !== defaults[k as keyof typeof defaults],
      )
      expect(changed).toBe(true)
    }
  })

  it('clamps out-of-range values safely', () => {
    const values = presetValues({
      id: 'x',
      label: 'Saint',
      description: '',
      values: { exposure: 999, contrast: -999 },
    })
    expect(values.exposure).toBe(100)
    expect(values.contrast).toBe(-100)
  })
})

describe('statsFromHistogram', () => {
  it('computes mean, median and cut points', () => {
    const bins = new Int32Array(256)
    // Even ramp 0..255: mean = median = 0.5, spread full range.
    for (let i = 0; i < 256; i++) bins[i] = 1
    const stats = statsFromHistogram(bins, 256)
    expect(stats.mean).toBeCloseTo(0.5, 1)
    expect(stats.median).toBeCloseTo(0.5, 1)
    expect(stats.blackPoint).toBeCloseTo(0, 1)
    expect(stats.whitePoint).toBeCloseTo(1, 0)
  })

  it('falls back gracefully for empty input', () => {
    const stats = statsFromHistogram(new Int32Array(256), 0)
    expect(stats.median).toBe(0.45)
    expect(stats.whitePoint).toBe(1)
  })

  it('handles all-black images', () => {
    const bins = new Int32Array(256)
    bins[10] = 1000 // everything pinned near-black, but not bin 0
    const stats = statsFromHistogram(bins, 1000)
    expect(stats.mean).toBeLessThan(0.1)
    expect(stats.median).toBeLessThan(0.1)
    expect(stats.blackPoint).toBeLessThan(0.1)
    expect(stats.whitePoint).toBeCloseTo(stats.blackPoint, 2)
  })
})

describe('autoValues', () => {
  it('at balanced stats it clears to a gentle set', () => {
    const values = autoValues({
      mean: 0.45,
      median: 0.45,
      blackPoint: 0.04,
      whitePoint: 0.94,
    })
    // Only vibrance (a deliberate gentle win) and small/no tonal changes.
    expect(values.exposure).toBeUndefined()
    expect(values.blacks).toBeUndefined()
    expect(values.whites).toBeUndefined()
    expect(values.contrast).toBeUndefined()
  })

  it('fights a dark, flat, crushed image', () => {
    const values = autoValues({
      mean: 0.2,
      median: 0.18,
      blackPoint: 0,
      whitePoint: 0.7,
    })
    expect(values.exposure).toBeGreaterThan(0)
    expect(values.contrast).toBeGreaterThan(0)
    expect(values.blacks).toBeGreaterThan(0) // lift crushed blacks
    expect(values.whites).toBeGreaterThan(0) // stretch near-whites upward
  })

  it('recovers blown whites and caps all values', () => {
    const values = autoValues({ mean: 0.8, median: 0.85, blackPoint: 0.3, whitePoint: 1 })
    expect(values.whites).toBeLessThan(0)
    expect(values.exposure).toBeLessThanOrEqual(60)
    expect(values.exposure).toBeGreaterThanOrEqual(-60)
  })
})

describe('mixValues (look strength)', () => {
  it('strength 0 = neutral defaults, 1 = full preset', () => {
    const preset = PRESETS.find((p) => p.id === 'vivid')!
    expect(mixValues(preset, 0)).toEqual(defaultAdjustments())
    expect(mixValues(preset, 1)).toEqual(presetValues(preset))
  })

  it('strength 0.5 lands halfway for preset keys', () => {
    const preset = PRESETS.find((p) => p.id === 'vivid')!
    const mixed = mixValues(preset, 0.5)
    const full = presetValues(preset)
    const def = defaultAdjustments()
    for (const [key, value] of Object.entries(full)) {
      const k = key as keyof typeof full
      if (value !== def[k]) {
        expect(mixed[k]).toBeCloseTo((def[k] + value) / 2, 0)
      }
    }
  })
})

describe('premium restraint (look library)', () => {
  it('keeps every preset subtle — no channel pushed beyond ±20 except B&W desaturation', () => {
    for (const preset of PRESETS) {
      for (const [key, value] of Object.entries(preset.values)) {
        if (key === 'saturation' && value === -100) continue // B&W is total by definition
        if (key === 'vibrance' && value === -100) continue
        expect(Math.abs(value as number)).toBeLessThanOrEqual(20)
      }
    }
  })

  it('offers the filmic looks', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toContain('film')
    expect(ids).toContain('moody')
  })
})

describe('filmicCurve', () => {
  it('strength 0 is identity', () => {
    const curve = filmicCurve(0)
    expect(curve.master).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('strength 1 rolls off highlights and lifts the toe', () => {
    const curve = filmicCurve(1)
    expect(curve.master[4]).toBeLessThan(1) // highlight shoulder
    expect(curve.master[0]).toBeGreaterThan(0) // lifted black
    expect(curve.master.every((v) => v >= 0 && v <= 1)).toBe(true)
  })

  it('interpolates monotonically at mid strength', () => {
    const curve = filmicCurve(0.5)
    for (let i = 1; i < curve.master.length; i++) {
      expect(curve.master[i]).toBeGreaterThanOrEqual(curve.master[i - 1])
    }
  })
})
