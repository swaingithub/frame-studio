import { describe, expect, it } from 'vitest'
import { defaultVideoEdit, sanitizeVideoEdit } from './model'
import {
  canvasOutputSize,
  clipOutDuration,
  clipSrcAt,
  defaultCanvasSettings,
  isOverlapTransition,
  layoutSequence,
  locateTime,
  migrateLegacySequence,
  overlaysAt,
  overlayVisual,
  OVERLAP_TRANSITIONS,
  sanitizeCanvas,
  sanitizeSequence,
  sanitizeTitle,
  splitClipAt,
  syncCutsToBeats,
  TRANSITION_LABELS,
  TRANSITION_TYPES,
  type OverlayClip,
  type VideoClip,
  type VideoTransition,
} from './sequenceModel'

function clip(id: string, over: Partial<Pick<VideoClip, 'assetId' | 'transition' | 'transitionDuration'>> = {}, editOver: Partial<VideoClip['edit']> = {}): VideoClip {
  return {
    id,
    assetId: over.assetId ?? `asset_${id}`,
    edit: { ...defaultVideoEdit(), ...editOver },
    transition: over.transition ?? 'cut',
    transitionDuration: over.transitionDuration ?? 0.5,
    title: null,
  }
}

describe('clip output duration', () => {
  it('is the trim window divided by speed', () => {
    const c = clip('a', {}, { trimStart: 2, trimEnd: 10, speed: 2 })
    expect(clipOutDuration(c, 30)).toBe(4)
  })

  it('falls back to the asset duration when untrimmed', () => {
    const c = clip('a', {}, { trimEnd: null })
    expect(clipOutDuration(c, 7)).toBe(7)
    // Unknown duration can never collapse the timeline below the minimum.
    expect(clipOutDuration(c, 0)).toBeGreaterThanOrEqual(0.2)
  })
})

describe('sequence layout', () => {
  it('cuts play back to back', () => {
    const layout = layoutSequence([clip('a'), clip('b')], (id) => (id === 'asset_a' ? 10 : 8))
    expect(layout.entries[0]).toMatchObject({ globalStart: 0, out: 10 })
    expect(layout.entries[1]).toMatchObject({ globalStart: 10, out: 8 })
    expect(layout.total).toBe(18)
  })

  it('dissolves overlap both neighbours and shrink the total', () => {
    const layout = layoutSequence([clip('a'), clip('b', { transition: 'dissolve', transitionDuration: 2 })], () => 10)
    // Overlap = min(d, out/2, nextOut/2) = 2 → the second clip starts early.
    expect(layout.entries[1].globalStart).toBe(8)
    expect(layout.total).toBe(18)
  })

  it('fades do not shrink the timeline', () => {
    const layout = layoutSequence([clip('a'), clip('b', { transition: 'fadeBlack', transitionDuration: 2 })], () => 10)
    expect(layout.entries[1].globalStart).toBe(10)
    expect(layout.total).toBe(20)
  })

  it('dissolve caps at half of either neighbour', () => {
    const layout = layoutSequence(
      [clip('a', {}, { trimStart: 0, trimEnd: 1 }), clip('b', { transition: 'dissolve', transitionDuration: 2 }, { trimStart: 0, trimEnd: 10 })],
      (id) => (id === 'asset_a' ? 1 : 10),
    )
    expect(layout.entries[1].globalStart).toBe(0.5)
    expect(layout.total).toBe(10.5)
  })
})

describe('locateTime', () => {
  const layout = layoutSequence([clip('a'), clip('b', { transition: 'dissolve', transitionDuration: 2 })], () => 10)

  it('lands inside the first clip', () => {
    const at = locateTime(layout, 4)
    expect(at.index).toBe(0)
    expect(at.localOut).toBe(4)
    expect(at.overlapWith).toBeNull()
  })

  it('reports the overlap partner inside the overlap', () => {
    const at = locateTime(layout, 9.5)
    expect(at.index).toBe(0)
    expect(at.localOut).toBeCloseTo(9.5)
    expect(at.overlapWith).toBe(1)
    expect(at.overlapLocalOut).toBeCloseTo(1.5)
  })

  it('moves fully into the next clip after the overlap', () => {
    const at = locateTime(layout, 12)
    expect(at.index).toBe(1)
    expect(at.localOut).toBeCloseTo(4)
    expect(at.overlapWith).toBeNull()
  })

  it('clamps to the end', () => {
    const at = locateTime(layout, 999)
    expect(at.localOut).toBeLessThanOrEqual(layout.entries[at.index].out)
  })
})

describe('transition library', () => {
  it('has a label and picker entry for every type', () => {
    expect(new Set(TRANSITION_TYPES).size).toBe(TRANSITION_TYPES.length)
    for (const type of TRANSITION_TYPES) expect(TRANSITION_LABELS[type]).toBeTruthy()
    expect(TRANSITION_TYPES[0]).toBe('cut')
  })

  it('classifies overlap transitions and colour dips', () => {
    for (const type of OVERLAP_TRANSITIONS) expect(isOverlapTransition(type)).toBe(true)
    for (const type of ['cut', 'fadeBlack', 'fadeWhite'] as const) expect(isOverlapTransition(type)).toBe(false)
    // Every motion type added to the library must overlap.
    for (const type of ['slideLeft', 'slideRight', 'slideUp', 'slideDown', 'wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown', 'circle', 'zoom', 'blur', 'spin', 'zoomBlur', 'barnDoor', 'flash'] as const) {
      expect(isOverlapTransition(type)).toBe(true)
    }
  })

  it.each(OVERLAP_TRANSITIONS)('%s overlaps both neighbours and shrinks the total', (transition) => {
    const layout = layoutSequence([clip('a'), clip('b', { transition, transitionDuration: 2 })], () => 10)
    expect(layout.entries[1].globalStart).toBe(8)
    expect(layout.entries[0].overlapAfter).toBe(2)
    expect(layout.total).toBe(18)
  })

  it.each(['cut', 'fadeBlack', 'fadeWhite'] as VideoTransition[])('%s keeps clips sequential', (transition) => {
    const layout = layoutSequence([clip('a'), clip('b', { transition, transitionDuration: 2 })], () => 10)
    expect(layout.entries[1].globalStart).toBe(10)
    expect(layout.entries[0].overlapAfter).toBe(0)
    expect(layout.total).toBe(20)
  })

  it('locates the partner for a wipe just like a dissolve', () => {
    const layout = layoutSequence([clip('a'), clip('b', { transition: 'wipeRight', transitionDuration: 2 })], () => 10)
    const at = locateTime(layout, 9.5)
    expect(at.index).toBe(0)
    expect(at.overlapWith).toBe(1)
    expect(at.overlapLocalOut).toBeCloseTo(1.5)
  })

  it('sanitize keeps new types and falls back to cut for unknown ones', () => {
    const durationOf = (): number => 10
    const hasAsset = (): boolean => true
    const kept = sanitizeSequence({ clips: [{ assetId: 'a', transition: 'circle' }] }, durationOf, hasAsset)
    expect(kept.clips[0].transition).toBe('circle')
    const unknown = sanitizeSequence({ clips: [{ assetId: 'a', transition: 'zigzag' }] }, durationOf, hasAsset)
    expect(unknown.clips[0].transition).toBe('cut')
  })
})

describe('splitClipAt', () => {
  it('splits the trim window into two halves', () => {
    const clips = [clip('a', {}, { trimStart: 0, trimEnd: 10 })]
    const next = splitClipAt(clips, 0, 4)
    expect(next).not.toBeNull()
    expect(next?.[0].edit).toMatchObject({ trimStart: 0, trimEnd: 4 })
    expect(next?.[1].edit).toMatchObject({ trimStart: 4, trimEnd: 10 })
    expect(next?.[1].id).not.toBe(next?.[0].id)
    expect(next?.length).toBe(2)
  })

  it('splits an untrimmed clip into [start..cut] and [cut..null]', () => {
    const next = splitClipAt([clip('a')], 0, 5)
    expect(next?.[0].edit.trimEnd).toBe(5)
    expect(next?.[1].edit.trimStart).toBe(5)
    expect(next?.[1].edit.trimEnd).toBeNull()
  })

  it('refuses splits too close to an edge', () => {
    const clips = [clip('a', {}, { trimStart: 2, trimEnd: 3.05 })]
    expect(splitClipAt(clips, 0, 1)).toBeNull()
    expect(splitClipAt(clips, 0, 0.05)).toBeNull()
    expect(splitClipAt(clips, 0, 0.5)).not.toBeNull()
  })

  it('keeps the grade and transition, drops the title to the second half', () => {
    const withTitle = { ...clip('a', {}, { speed: 2 }), title: sanitizeTitle({ text: 'Hello', position: 'lower', show: 3 }) }
    const next = splitClipAt([withTitle], 0, 1)
    expect(next?.[0].edit.speed).toBe(2)
    expect(next?.[0].title?.text).toBe('Hello')
    expect(next?.[1].title).toBeNull()
  })

  it('keeps keyframes on half A and drops them on half B', () => {
    const keys = { scale: [{ id: 'k1', t: 0.5, v: 2, ease: 'smooth' as const }], x: [], y: [], opacity: [] }
    const withKeys = { ...clip('a'), keyframes: keys }
    const next = splitClipAt([withKeys], 0, 1)
    expect(next?.[0].keyframes?.scale.length).toBe(1)
    expect(next?.[1].keyframes).toBeUndefined()
  })
})

describe('clipSrcAt', () => {
  it('maps 0→trimStart and maps out-end→trimEnd (roundtrip with clipOutDuration)', () => {
    const c = clip('a', {}, { trimStart: 2, trimEnd: 10, speed: 2 })
    const assetDuration = 30
    expect(clipSrcAt(c, 0, assetDuration)).toBeCloseTo(2, 6)
    const out = clipOutDuration(c, assetDuration)
    expect(clipSrcAt(c, out, assetDuration)).toBeCloseTo(10, 6)
  })

  it('ramp curves keep the endpoints and reshuffle the middle', () => {
    const flat = clip('a', {}, { speedCurve: 'none' })
    const ramped = clip('b', {}, { speedCurve: 'inOut' })
    const out = clipOutDuration(flat, 10)
    // Halfway through the OUTPUT of a symmetric ramp → half the trim span.
    expect(clipSrcAt(ramped, out / 2, 10)).toBeCloseTo(clipSrcAt(flat, out / 2, 10), 6)
    // Quarter point: 'inOut' ramps slowly at first → less source consumed.
    expect(clipSrcAt(ramped, out / 4, 10)).toBeLessThan(clipSrcAt(flat, out / 4, 10))
  })
})

describe('sanitizeSequence', () => {
  const durationOf = (id: string): number => (id === 'asset_a' ? 10 : id === 'asset_b' ? 6 : 0)
  const hasAsset = (id: string): boolean => id === 'asset_a' || id === 'asset_b'

  it('returns an empty sequence for garbage', () => {
    expect(sanitizeSequence(null, durationOf, hasAsset)).toEqual({ clips: [], overlays: [], music: null, canvas: defaultCanvasSettings() })
  })

  it('sanitizes canvas settings and computes fixed output sizes', () => {
    expect(sanitizeCanvas(null)).toEqual(defaultCanvasSettings())
    expect(sanitizeCanvas({ aspect: '9:16', background: 'blur', color: '#ABCDEF' })).toEqual({
      aspect: '9:16',
      background: 'blur',
      color: '#abcdef',
      quality: 720,
    })
    expect(sanitizeCanvas({ aspect: '9:16', quality: 1080 }).quality).toBe(1080)
    expect(sanitizeCanvas({ aspect: '9:16', quality: 9999 }).quality).toBe(720)
    expect(sanitizeCanvas({ aspect: 'nope', background: 'nope', color: 'red' })).toEqual(defaultCanvasSettings())
    expect(canvasOutputSize(defaultCanvasSettings())).toBeNull()
    expect(canvasOutputSize({ aspect: '16:9', background: 'color', color: '#000000' })).toEqual({ w: 1280, h: 720 })
    expect(canvasOutputSize({ aspect: '9:16', background: 'color', color: '#000000' })).toEqual({ w: 720, h: 1280 })
    expect(canvasOutputSize({ aspect: '1:1', background: 'color', color: '#000000' })).toEqual({ w: 720, h: 720 })
    expect(canvasOutputSize({ aspect: '4:5', background: 'color', color: '#000000' })).toEqual({ w: 720, h: 900 })
    expect(canvasOutputSize({ aspect: '16:9', background: 'color', color: '#000000', quality: 1080 })).toEqual({ w: 1920, h: 1080 })
    expect(canvasOutputSize({ aspect: '9:16', background: 'color', color: '#000000', quality: 1440 })).toEqual({ w: 1080, h: 1920 })
  })

  it('drops clips referencing unknown assets and clamps fields', () => {
    const result = sanitizeSequence(
      {
        clips: [
          { id: 'c1', assetId: 'asset_a', edit: { trimStart: 1, trimEnd: 20 }, transition: 'dissolve', transitionDuration: 99, title: { text: 'Hi', show: 999 } },
          { assetId: 'asset_zzz' },
          null,
        ],
        music: { assetId: 'asset_zzz', volume: 500 },
      },
      durationOf,
      hasAsset,
    )
    expect(result.clips.length).toBe(1)
    expect(result.clips[0].edit.trimEnd).toBe(10)
    expect(result.clips[0].transitionDuration).toBe(2)
    expect(result.clips[0].title).toEqual({ text: 'Hi', position: 'lower', show: 60 })
    expect(result.music).toBeNull()
  })

  it('keeps a valid music track', () => {
    const result = sanitizeSequence({ clips: [], music: { assetId: 'asset_b', volume: -5 } }, durationOf, hasAsset)
    expect(result.music).toEqual({ assetId: 'asset_b', volume: 0 })
  })

  it('sanitizes overlays: keeps valid media, drops garbage and unknown assets', () => {
    const result = sanitizeSequence(
      {
        clips: [],
        overlays: [
          {
            id: 'o1',
            kind: 'image',
            assetId: 'asset_a',
            start: 1,
            duration: 0.01,
            base: { scale: 9, x: 2, y: -1, opacity: 3 },
            keyframes: { scale: [{ id: 'k', t: 0, v: 12, ease: 'zigzag' }], x: 'nope', y: [], opacity: [] },
          },
          { id: 'o2', kind: 'text', text: '   ', start: 0, duration: 3, base: {}, keyframes: {} },
          { id: 'o3', kind: 'video', assetId: 'asset_zzz', start: 0, duration: 3, base: {}, keyframes: {} },
          'garbage',
          null,
        ],
      },
      durationOf,
      hasAsset,
    )
    expect(result.overlays.length).toBe(1)
    const o = result.overlays[0]
    expect(o.id).toBe('o1')
    expect(o.duration).toBeGreaterThanOrEqual(0.3)
    expect(o.base).toEqual({ scale: 4, x: 1, y: 0, opacity: 1 })
    expect(o.keyframes.scale[0]).toMatchObject({ t: 0, v: 4, ease: 'smooth' })
    expect(o.keyframes.x).toEqual([])
  })

  it('keeps a valid text overlay with clamped timing', () => {
    const result = sanitizeSequence(
      {
        clips: [],
        overlays: [{ id: 't1', kind: 'text', text: 'Hello', start: -5, duration: 2, base: { scale: 1, x: 0.5, y: 0.5, opacity: 1 }, keyframes: {} }],
      },
      durationOf,
      hasAsset,
    )
    expect(result.overlays.length).toBe(1)
    expect(result.overlays[0]).toMatchObject({ kind: 'text', text: 'Hello', start: 0, duration: 2 })
  })

  it('overlaysAt selects only layers active at t', () => {
    const a = { id: 'a', kind: 'text' as const, text: 'A', start: 0, duration: 2, base: { scale: 1, x: 0.5, y: 0.5, opacity: 1 }, keyframes: { scale: [], x: [], y: [], opacity: [] } }
    const b = { ...a, id: 'b', start: 3, duration: 1 }
    expect(overlaysAt([a, b], 1).map((o) => o.id)).toEqual(['a'])
    expect(overlaysAt([a, b], 2.5)).toEqual([])
    expect(overlaysAt([a, b], 3.5).map((o) => o.id)).toEqual(['b'])
  })

  it('sanitizes animation presets and drops unknown ones', () => {
    const result = sanitizeSequence(
      {
        clips: [],
        overlays: [
          { id: 't1', kind: 'text', text: 'Hi', start: 0, duration: 2, base: {}, keyframes: {}, animIn: 'pop', animOut: 'nope' },
        ],
      },
      durationOf,
      hasAsset,
    )
    expect(result.overlays[0].animIn).toBe('pop')
    expect(result.overlays[0].animOut).toBe('none')
  })
})

describe('overlay visual (text animations)', () => {
  const base = { scale: 1, x: 0.5, y: 0.5, opacity: 1 }
  const overlay = (over: Partial<OverlayClip> = {}): OverlayClip => ({
    id: 'o',
    kind: 'text',
    text: 'Hello world',
    start: 1,
    duration: 4,
    base,
    keyframes: { scale: [], x: [], y: [], opacity: [] },
    ...over,
  })

  it('is an identity when no preset is set', () => {
    expect(overlayVisual(overlay(), 2, 1000, 500)).toEqual({ alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, reveal: 1 })
  })

  it('fades in over the first half second and out over the last', () => {
    const o = overlay({ animIn: 'fade', animOut: 'fade' })
    expect(overlayVisual(o, 1, 1000, 500).alpha).toBeCloseTo(0)
    expect(overlayVisual(o, 1.25, 1000, 500).alpha).toBeCloseTo(0.5)
    expect(overlayVisual(o, 2, 1000, 500).alpha).toBeCloseTo(1)
    expect(overlayVisual(o, 4.9, 1000, 500).alpha).toBeLessThan(0.3)
  })

  it('pops with an overshoot and settles back to normal scale', () => {
    const o = overlay({ animIn: 'pop' })
    const mid = overlayVisual(o, 1.3, 1000, 500)
    expect(mid.scale).toBeGreaterThan(1)
    expect(overlayVisual(o, 3, 1000, 500).scale).toBeCloseTo(1)
  })

  it('slides in from below and exits upward', () => {
    const o = overlay({ animIn: 'slideUp', animOut: 'slideUp' })
    expect(overlayVisual(o, 1, 1000, 500).dy).toBeCloseTo(500 * 0.18)
    expect(overlayVisual(o, 2, 1000, 500).dy).toBeCloseTo(0)
    expect(overlayVisual(o, 5, 1000, 500).dy).toBeCloseTo(-500 * 0.18)
  })

  it('typewriter reveals characters progressively', () => {
    const o = overlay({ animIn: 'typewriter' })
    expect(overlayVisual(o, 1, 1000, 500).reveal).toBeCloseTo(0)
    const mid = overlayVisual(o, 1.5, 1000, 500).reveal
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.8)
    expect(overlayVisual(o, 3, 1000, 500).reveal).toBeCloseTo(1)
  })

  it('keeps presets short relative to very brief overlays', () => {
    const o = overlay({ duration: 0.4, animIn: 'fade', animOut: 'fade' })
    expect(overlayVisual(o, 1.2, 1000, 500).alpha).toBeCloseTo(1)
  })

  it('drop falls in from above and settles level', () => {
    const o = overlay({ animIn: 'drop', animOut: 'drop' })
    expect(overlayVisual(o, 1, 1000, 500).dy).toBeGreaterThan(100)
    expect(overlayVisual(o, 2, 1000, 500).dy).toBeCloseTo(0)
    // Exits upward (mirrored), and never below settle.
    expect(overlayVisual(o, 5, 1000, 500).dy).toBeLessThan(-50)
  })

  it('bounce scales in with a landing wobble and settles at 1', () => {
    const o = overlay({ animIn: 'bounce' })
    const early = overlayVisual(o, 1.1, 1000, 500)
    expect(early.scale).toBeLessThan(0.9)
    expect(overlayVisual(o, 2.4, 1000, 500).scale).toBeCloseTo(1)
  })

  it('swing rocks in with rotation and levels out', () => {
    const o = overlay({ animIn: 'swing', animOut: 'swing' })
    const early = overlayVisual(o, 1.15, 1000, 500)
    expect(early.rot).not.toBe(0)
    expect(Math.abs(early.rot)).toBeLessThan(0.35)
    expect(overlayVisual(o, 2, 1000, 500).rot).toBeCloseTo(0)
  })
})

describe('migrateLegacySequence', () => {
  it('builds one clip per asset in order, adopting stored edits', () => {
    const result = migrateLegacySequence(
      ['asset_a', 'asset_a', 'asset_b'],
      { asset_a: { trimStart: 2, trimEnd: 8 }, asset_b: sanitizeVideoEdit(null, 6) },
      () => 10,
      () => true,
    )
    expect(result.clips.map((c) => c.assetId)).toEqual(['asset_a', 'asset_a', 'asset_b'])
    expect(result.clips[0].edit.trimStart).toBe(2)
    expect(result.clips[0].edit.trimEnd).toBe(8)
    expect(result.clips[1].id).not.toBe(result.clips[0].id)
    expect(result.music).toBeNull()
  })
})

describe('syncCutsToBeats', () => {
  it('snaps every internal boundary onto the nearest beat', () => {
    // Two 2s clips: boundary at 2.0 → nearest beat 1.9 (delta -0.1)
    const a = clip('a', {}, { trimStart: 0, trimEnd: 2 })
    const b = clip('b', {}, { trimStart: 0, trimEnd: 2 })
    const out = syncCutsToBeats([a, b], { asset_a: 30, asset_b: 30 }, [1.9, 4.0])
    expect(out).not.toBeNull()
    const layout = layoutSequence(out!, (id) => (id === 'asset_a' ? 30 : 30))
    expect(layout.entries[1].globalStart).toBeCloseTo(1.9, 5)
    expect(out![0].edit.trimEnd).toBeCloseTo(1.9, 5)
  })

  it('falls back to widening the earlier clip when its trim end hits the asset end', () => {
    const a = clip('a', {}, { trimStart: 1, trimEnd: 3 })
    const b = clip('b', {}, { trimStart: 2, trimEnd: 5 })
    // asset_a is exactly 3s: no room to extend the end; beat at 2.2 → widen
    // clip a's window by starting it earlier instead.
    const out = syncCutsToBeats([a, b], { asset_a: 3, asset_b: 30 }, [2.2])
    expect(out).not.toBeNull()
    expect(out![0].edit.trimStart).toBeCloseTo(0.8, 5)
    const layout = layoutSequence(out!, (id) => (id === 'asset_a' ? 3 : 30))
    expect(layout.entries[1].globalStart).toBeCloseTo(2.2, 5)
  })

  it('leaves an impossible boundary untouched', () => {
    const a = clip('a', {}, { trimStart: 0, trimEnd: 3 })
    const b = clip('b', {}, { trimStart: 0, trimEnd: 5 })
    // asset fully used from 0, beat 0.2s later — nothing can move.
    expect(syncCutsToBeats([a, b], { asset_a: 3, asset_b: 30 }, [3.2])).toBeNull()
  })

  it('leaves boundaries that are already on a beat and returns null when nothing moves', () => {
    const a = clip('a', {}, { trimStart: 0, trimEnd: 2 })
    const b = clip('b', {}, { trimStart: 0, trimEnd: 2 })
    expect(syncCutsToBeats([a, b], { asset_a: 30, asset_b: 30 }, [2.0, 4.0])).toBeNull()
  })

  it('needs at least two clips and a beat grid', () => {
    expect(syncCutsToBeats([clip('a')], { asset_a: 30 }, [1])).toBeNull()
    expect(syncCutsToBeats([clip('a'), clip('b')], { asset_a: 30, asset_b: 30 }, [])).toBeNull()
  })
})
