import { describe, expect, it } from 'vitest'
import { audioGainAt, defaultVideoEdit, sanitizeVideoEdit, withAudioFades, withBgRemove, withChromaKey, withMask, withTrim, withVideoAdjustments, withVolume } from './model'
import { defaultAdjustments } from '../../core/adjustments/registry'

describe('video edit model', () => {
  it('defaults are a complete no-op', () => {
    const doc = defaultVideoEdit()
    expect(doc.adjustments).toEqual(defaultAdjustments())
    expect(doc.trimStart).toBe(0)
    expect(doc.trimEnd).toBeNull()
    expect(doc.volume).toBe(100)
    expect(doc.muted).toBe(false)
    expect(doc.chromaKey).toBeNull()
  })

  it('sanitizes garbage into a valid doc', () => {
    const doc = sanitizeVideoEdit({
      adjustments: { exposure: 999, contrast: 'x', saturation: -50 },
      trimStart: 5,
      trimEnd: 2, // inverted → rejected
      volume: 500,
      muted: 'yes',
    }, 30)
    expect(doc.adjustments.exposure).toBe(100)
    expect(doc.adjustments.contrast).toBe(0)
    expect(doc.adjustments.saturation).toBe(-50)
    expect(doc.trimStart).toBe(0)
    expect(doc.trimEnd).toBeNull()
    expect(doc.volume).toBe(150)
    expect(doc.muted).toBe(false)
  })

  it('keeps inverted trims out and clamps to duration', () => {
    const ok = sanitizeVideoEdit({ trimStart: 2, trimEnd: 8 }, 30)
    expect(ok.trimStart).toBe(2)
    expect(ok.trimEnd).toBe(8)
    const beyond = sanitizeVideoEdit({ trimStart: 29, trimEnd: 99 }, 30)
    // trimEnd clamps to 30 which is > 29 → valid single-frame trim
    expect(beyond.trimEnd).toBe(30)
    const inverted = sanitizeVideoEdit({ trimStart: 10, trimEnd: 3 }, 0)
    expect(inverted.trimEnd).toBeNull()
  })

  it('returns a default doc for non-objects', () => {
    expect(sanitizeVideoEdit(null)).toEqual(defaultVideoEdit())
    expect(sanitizeVideoEdit('nope')).toEqual(defaultVideoEdit())
  })

  it('preserves trims when the clip length is still unknown (duration 0)', () => {
    const doc = sanitizeVideoEdit({ trimStart: 1.48, trimEnd: 2.2, volume: 100 }, 0)
    expect(doc.trimStart).toBe(1.48)
    expect(doc.trimEnd).toBe(2.2)
    // Once the length arrives, values clamp into the real range.
    const known = sanitizeVideoEdit({ ...doc, trimEnd: 9 }, 2.466)
    expect(known.trimEnd).toBe(2.466)
    const untouched = sanitizeVideoEdit(doc, 2.466)
    expect(untouched.trimEnd).toBe(2.2)
  })

  it('merges whole adjustment sets and clamps volume', () => {
    const doc = withVideoAdjustments(defaultVideoEdit(), { contrast: 25, exposure: 1000 })
    expect(doc.adjustments.contrast).toBe(25)
    expect(doc.adjustments.exposure).toBe(100)
    expect(doc.adjustments.saturation).toBe(0) // untouched stays default
    expect(withVolume(doc, -5).volume).toBe(0)
    expect(withVolume(doc, 90).volume).toBe(90)
  })

  it('chroma key: enabling applies defaults, off clears to null', () => {
    const on = withChromaKey(defaultVideoEdit(), { enabled: true })
    expect(on.chromaKey?.enabled).toBe(true)
    expect(on.chromaKey?.color).toEqual([0.0, 0.69, 0.25])
    expect(on.chromaKey?.similarity).toBeCloseTo(0.12)
    // Off wipes the whole key back to neutral
    expect(withChromaKey(on, { enabled: false }).chromaKey).toBeNull()
    // A patch on an existing key keeps the rest of its parameters
    const tweaked = withChromaKey(on, { similarity: 0.4, color: [1, 1, 1] })
    expect(tweaked.chromaKey?.similarity).toBe(0.4)
    expect(tweaked.chromaKey?.color).toEqual([1, 1, 1])
    expect(tweaked.chromaKey?.smoothness).toBeCloseTo(0.04)
  })

  it('chroma key sanitizes storage garbage into a valid key', () => {
    const doc = sanitizeVideoEdit({
      chromaKey: { enabled: true, color: [0.5, 9, 'x'], similarity: 3, smoothness: -1, spill: 0.7 },
    })
    expect(doc.chromaKey?.enabled).toBe(true)
    expect(doc.chromaKey?.color).toEqual([0.5, 1, 0.5])
    expect(doc.chromaKey?.similarity).toBe(0.5)
    expect(doc.chromaKey?.smoothness).toBe(0)
    expect(doc.chromaKey?.spill).toBe(0.7)
    expect(sanitizeVideoEdit({ chromaKey: 'garbage' }).chromaKey).not.toBeNull()
    expect(sanitizeVideoEdit({}).chromaKey).toBeNull()
  })

  it('mask: enabling a shape applies defaults, none clears it', () => {
    const on = withMask(defaultVideoEdit(), { shape: 'circle' })
    expect(on.mask?.shape).toBe('circle')
    expect(on.mask?.x).toBeCloseTo(0.5)
    expect(on.mask?.w).toBeCloseTo(0.6)
    expect(on.mask?.feather).toBeCloseTo(0.08)
    // Patching keeps the rest of the mask
    const tweaked = withMask(on, { w: 0.9, rotation: 30 })
    expect(tweaked.mask?.shape).toBe('circle')
    expect(tweaked.mask?.w).toBeCloseTo(0.9)
    expect(tweaked.mask?.rotation).toBe(30)
    // Choosing None removes the mask entirely
    expect(withMask(tweaked, { shape: 'none' }).mask).toBeNull()
  })

  it('mask sanitizes storage garbage into a valid mask', () => {
    const doc = sanitizeVideoEdit({
      mask: { shape: 'star', x: -4, y: 9, w: 0, h: 99, rotation: 900, feather: -1, invert: 'yes' },
    })
    expect(doc.mask?.shape).toBe('star')
    expect(doc.mask?.x).toBe(0)
    expect(doc.mask?.y).toBe(1)
    expect(doc.mask?.w).toBe(0.02)
    expect(doc.mask?.h).toBe(1.5)
    expect(doc.mask?.rotation).toBe(180)
    expect(doc.mask?.feather).toBe(0)
    expect(doc.mask?.invert).toBe(false)
    expect(sanitizeVideoEdit({ mask: { shape: 'blob' } }).mask?.shape).toBe('none')
    expect(sanitizeVideoEdit({}).mask).toBeNull()
  })

  it('bgRemove defaults off, round-trips and toggles', () => {
    expect(defaultVideoEdit().bgRemove).toBe(false)
    expect(sanitizeVideoEdit({}).bgRemove).toBe(false)
    expect(sanitizeVideoEdit({ bgRemove: true }).bgRemove).toBe(true)
    expect(sanitizeVideoEdit({ bgRemove: 'yes' }).bgRemove).toBe(false)
    expect(withBgRemove(defaultVideoEdit(), true).bgRemove).toBe(true)
    expect(withBgRemove(withBgRemove(defaultVideoEdit(), true), false).bgRemove).toBe(false)
  })

  it('withTrim redelegates to sanitize inside duration', () => {    const doc = withTrim(defaultVideoEdit(), 1, 4, 10)
    expect(doc.trimEnd).toBe(4)
    expect(withTrim(defaultVideoEdit(), 4, 1, 10).trimEnd).toBeNull()
  })

  it('audio fades sanitize to [0,5] and default to none', () => {
    expect(defaultVideoEdit().audioFadeIn).toBe(0)
    expect(defaultVideoEdit().audioFadeOut).toBe(0)
    expect(sanitizeVideoEdit({ audioFadeIn: 2.5, audioFadeOut: 99 }).audioFadeOut).toBe(5)
    expect(sanitizeVideoEdit({ audioFadeIn: -3 }).audioFadeIn).toBe(0)
    expect(withAudioFades(defaultVideoEdit(), 1.2, 3.4).audioFadeOut).toBe(3.4)
  })

  it('audioGainAt ramps in and out and holds 1 in the middle', () => {
    const doc = withAudioFades(defaultVideoEdit(), 1, 2)
    expect(audioGainAt(doc, 0, 10)).toBe(0)
    expect(audioGainAt(doc, 0.5, 10)).toBeCloseTo(0.5)
    expect(audioGainAt(doc, 5, 10)).toBe(1)
    expect(audioGainAt(doc, 9, 10)).toBeCloseTo(0.5)
    expect(audioGainAt(doc, 10, 10)).toBe(0)
    expect(audioGainAt(defaultVideoEdit(), 0, 10)).toBe(1)
    // Fades longer than half the clip cap at the midpoint so they never cross.
    const long = withAudioFades(defaultVideoEdit(), 5, 5)
    expect(audioGainAt(long, 2, 4)).toBe(1)
    expect(audioGainAt(long, 2.5, 4)).toBeCloseTo(0.75)
    expect(audioGainAt(long, 3, 6)).toBe(1)
  })
})
