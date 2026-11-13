import { describe, expect, it } from 'vitest'
import {
  CAPTION_BASE,
  captionsForSequence,
  mapClipSegments,
  sanitizeSegments,
  sourceToSequenceTime,
  type ClipAudioWindow,
} from './captions'

const window = (over: Partial<ClipAudioWindow> = {}): ClipAudioWindow => ({
  clipId: 'c1',
  globalStart: 0,
  trimStart: 0,
  trimEnd: null,
  speed: 1,
  out: 10,
  ...over,
})

describe('sourceToSequenceTime', () => {
  it('offsets by trim and divides by speed', () => {
    const w = window({ globalStart: 5, trimStart: 2, speed: 2 })
    expect(sourceToSequenceTime(w, 4)).toBe(6)
  })

  it('treats broken speeds as 1', () => {
    expect(sourceToSequenceTime(window({ speed: 0 }), 3)).toBe(3)
  })
})

describe('mapClipSegments', () => {
  it('maps decoded-window time onto the sequence (with speed)', () => {
    // Segments are offsets into the decoded trim window: clip starts at
    // global 10, audio decoded from source second 1, played at 2×.
    const w = window({ globalStart: 10, trimStart: 1, speed: 2 })
    const out = mapClipSegments(w, [{ start: 1, end: 3, text: 'Hello world' }])
    expect(out).toEqual([{ start: 10.5, end: 11.5, text: 'Hello world' }])
  })

  it('clamps segments that run past the trim end', () => {
    const w = window({ trimStart: 0, trimEnd: 4, speed: 1 })
    const out = mapClipSegments(w, [{ start: 3, end: 9, text: 'Cut off' }])
    expect(out[0].start).toBe(3)
    expect(out[0].end).toBe(4)
  })

  it('drops segments that start after the trim end, empty text and garbage', () => {
    const w = window({ trimEnd: 4 })
    const out = mapClipSegments(w, [
      { start: 5, end: 6, text: 'too late' },
      { start: 1, end: 2, text: '   ' },
      { start: 1, end: 1.5, text: 'kept' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('kept')
  })

  it('merges whisper fragments that arrive almost back to back', () => {
    const out = mapClipSegments(window(), [
      { start: 0, end: 1, text: 'Hello' },
      { start: 1.02, end: 2, text: 'world' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Hello world')
  })

  it('pads ultra-short captions so they do not flash', () => {
    const out = mapClipSegments(window(), [{ start: 2, end: 2.05, text: 'Hi' }])
    expect(out[0].end - out[0].start).toBeCloseTo(0.4, 6)
  })

  it('collapses messy whitespace and caps the length', () => {
    const long = 'x'.repeat(300)
    const out = mapClipSegments(window(), [{ start: 0, end: 1, text: `a \n b\t c   ${long}` }])
    expect(out[0].text.startsWith('a b c x')).toBe(true)
    expect(out[0].text).not.toMatch(/\s{2,}/)
    expect(out[0].text.length).toBeLessThanOrEqual(200)
  })
})

describe('sanitizeSegments', () => {
  it('keeps valid segments and drops the rest', () => {
    expect(
      sanitizeSegments([
        { start: 0, end: 1.5, text: 'ok' },
        { start: 'x', end: 2, text: 'bad' },
        { start: 3, end: 3, text: 'zero' },
        { start: 4, end: 5, text: '' },
        'junk',
        null,
      ]),
    ).toEqual([{ start: 0, end: 1.5, text: 'ok' }])
  })

  it('returns an empty list for non-arrays', () => {
    expect(sanitizeSegments(undefined)).toEqual([])
  })
})

describe('captionsForSequence', () => {
  it('stitches clips together in sequence order', () => {
    const windows = [
      window({ clipId: 'a', globalStart: 0, out: 4 }),
      window({ clipId: 'b', globalStart: 4, trimStart: 1, out: 4 }),
    ]
    const captions = captionsForSequence(windows, [
      [{ start: 0, end: 2, text: 'First' }],
      [{ start: 0, end: 3, text: 'Second' }],
    ])
    expect(captions.map((c) => [c.start, c.text])).toEqual([
      [0, 'First'],
      [4, 'Second'],
    ])
  })

  it('survives a missing transcript for one clip', () => {
    const captions = captionsForSequence(
      [window(), window({ clipId: 'b', globalStart: 5 })],
      [[{ start: 0, end: 1, text: 'only first' }]],
    )
    expect(captions).toHaveLength(1)
  })
})

describe('caption styling', () => {
  it('uses a fixed readable position above the bottom edge', () => {
    expect(CAPTION_BASE).toEqual({ scale: 1.1, x: 0.5, y: 0.88, opacity: 1 })
  })
})
