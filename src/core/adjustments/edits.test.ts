import { describe, expect, it } from 'vitest'
import {
  createDefaultEditDoc,
  docEquals,
  isDocNeutral,
  sanitizeEditDoc,
  sanitizeTextOverlay,
  sanitizeTextOverlays,
  withAdjustment,
  withBackgroundRemoval,
  withCopiedGrade,
  withGeometry,
  withMask,
  withTextOverlays,
  type PhotoTextOverlay,
} from './edits'

describe('edit doc model', () => {
  it('defaults are a complete no-op', () => {
    const doc = createDefaultEditDoc()
    expect(JSON.parse(JSON.stringify(doc)).geometry.rotateQuarter).toBe(0)
    expect(doc.geometry.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(docEquals(doc, createDefaultEditDoc())).toBe(true)
  })

  it('applies single adjustments immutably', () => {
    const base = createDefaultEditDoc()
    const next = withAdjustment(base, 'exposure', 42)
    expect(next.adjustments.exposure).toBe(42)
    expect(base.adjustments.exposure).toBe(0)
    expect(next.geometry).toEqual(base.geometry)
  })

  it('applies geometry immutably and keeps adjustments', () => {
    const base = withAdjustment(createDefaultEditDoc(), 'contrast', 10)
    const next = withGeometry(base, { rotateQuarter: 1, flipH: true })
    expect(next.geometry.rotateQuarter).toBe(1)
    expect(next.geometry.flipH).toBe(true)
    expect(next.adjustments.contrast).toBe(10)
    expect(base.geometry.rotateQuarter).toBe(0)
  })

  it('sanitizes garbage into a valid no-op-ish doc', () => {
    const doc = sanitizeEditDoc({
      adjustments: { exposure: 999, contrast: 'x', saturation: -3.5 },
      geometry: { rotateQuarter: 9, straighten: 120, flipH: 'yes', crop: { x: -0.5, y: 0.8, w: 2, h: 0.1 } },
    })
    expect(doc.adjustments.exposure).toBe(100)
    expect(doc.adjustments.contrast).toBe(0)
    expect(doc.adjustments.saturation).toBe(-3.5)
    expect(doc.geometry.rotateQuarter).toBe(0)
    expect(doc.geometry.straighten).toBe(45)
    expect(doc.geometry.flipH).toBe(false)
    expect(doc.geometry.crop.x).toBe(0)
    expect(doc.geometry.crop.x + doc.geometry.crop.w).toBeLessThanOrEqual(1)
  })

  it('returns a default doc for non-objects', () => {
    expect(sanitizeEditDoc(null)).toEqual(createDefaultEditDoc())
    expect(sanitizeEditDoc('nope')).toEqual(createDefaultEditDoc())
  })
})

describe('withCopiedGrade (batch apply)', () => {
  it('copies sliders, curve and HSL but keeps the target crop/rotate', () => {
    const source = withAdjustment(createDefaultEditDoc(), 'exposure', 42)
    source.curves!.master = [0, 0.1, 0.9, 1, 1]
    source.hsl!.red.sat = 30
    const target = withGeometry(createDefaultEditDoc(), { rotateQuarter: 1 })
    const merged = withCopiedGrade(target, source)
    expect(merged.adjustments.exposure).toBe(42)
    expect(merged.curves!.master).toEqual([0, 0.1, 0.9, 1, 1])
    expect(merged.hsl!.red.sat).toBe(30)
    expect(merged.geometry.rotateQuarter).toBe(1) // untouched
  })

  it('deep-copies: mutating the copy does not touch the source', () => {
    const source = withAdjustment(createDefaultEditDoc(), 'contrast', 10)
    source.hsl!.green.hue = -20
    const merged = withCopiedGrade(createDefaultEditDoc(), source)
    merged.hsl!.green.hue = 50
    merged.adjustments.contrast = -5
    expect(source.hsl!.green.hue).toBe(-20)
    expect(source.adjustments.contrast).toBe(10)
  })
})

describe('withMask (photo shape masks)', () => {
  it('patches the mask and keeps unrelated fields', () => {
    const doc = withMask(createDefaultEditDoc(), { shape: 'circle' })
    expect(doc.mask?.shape).toBe('circle')
    expect(doc.mask?.feather).toBe(0.08) // default kept
    const moved = withMask(doc, { x: 0.2, y: 0.7 })
    expect(moved.mask?.x).toBe(0.2)
    expect(moved.mask?.shape).toBe('circle')
  })

  it('clears the mask entirely when shape is none', () => {
    const doc = withMask(withMask(createDefaultEditDoc(), { shape: 'star' }), { shape: 'none' })
    expect(doc.mask).toBeNull()
  })

  it('starts from the default when the doc had no mask', () => {
    const doc = withMask(createDefaultEditDoc(), { shape: 'linear' })
    expect(doc.mask?.w).toBe(0.6)
    expect(doc.mask?.shape).toBe('linear')
  })
})

describe('text overlays', () => {
  it('adds, patches and clears via withTextOverlays (capped at 12)', () => {
    const mk = (id: string): PhotoTextOverlay => ({ id, text: id, x: 0.5, y: 0.8, scale: 1, opacity: 1, rotation: 0, color: '#ffffff' })
    const doc = withTextOverlays(createDefaultEditDoc(), Array.from({ length: 14 }, (_, i) => mk(`o${i}`)))
    expect(doc.textOverlays).toHaveLength(12)
    expect(withTextOverlays(createDefaultEditDoc(), [mk('a')]).textOverlays![0].text).toBe('a')
  })

  it('sanitizes garbage overlays and clamps fields', () => {
    expect(sanitizeTextOverlay(null)).toBeNull()
    expect(sanitizeTextOverlay({ id: '', text: 'hi' })).toBeNull()
    expect(sanitizeTextOverlay({ id: 'a', text: '   ' })).toBeNull()
    const o = sanitizeTextOverlay({ id: 'a', text: 'Hi', x: 9, scale: 99, opacity: 0, rotation: 999, color: 'red' })
    expect(o).toEqual({ id: 'a', text: 'Hi', x: 1.5, y: 0.8, scale: 3, opacity: 0.05, rotation: 180, color: '#ffffff' })
    // duplicate ids collapse
    const list = sanitizeTextOverlays([{ id: 'a', text: '1' }, { id: 'a', text: '2' }])
    expect(list).toHaveLength(1)
  })

  it('isDocNeutral ignores an empty overlay list but not a real one', () => {
    const base = createDefaultEditDoc()
    expect(isDocNeutral(base)).toBe(true)
    const withOverlay = withTextOverlays(base, [{ id: 'a', text: 'Hi', x: 0.5, y: 0.8, scale: 1, opacity: 1, rotation: 0, color: '#ffffff' }])
    expect(isDocNeutral(withOverlay)).toBe(false)
  })
})

describe('background removal', () => {
  it('toggles the flag on the edit doc', () => {
    const on = withBackgroundRemoval(createDefaultEditDoc(), true)
    expect(on.backgroundRemoval).toEqual({ enabled: true })
    expect(isDocNeutral(on)).toBe(false)
    const off = withBackgroundRemoval(on, false)
    expect(off.backgroundRemoval).toBeNull()
  })

  it('sanitizes from storage (defaults to off)', () => {
    expect(sanitizeEditDoc({ backgroundRemoval: { enabled: true } }).backgroundRemoval).toEqual({ enabled: true })
    expect(sanitizeEditDoc({ backgroundRemoval: { enabled: false } }).backgroundRemoval).toBeNull()
    expect(sanitizeEditDoc({ backgroundRemoval: 'yes' }).backgroundRemoval).toBeNull()
    expect(sanitizeEditDoc(createDefaultEditDoc()).backgroundRemoval).toBeNull()
  })
})
