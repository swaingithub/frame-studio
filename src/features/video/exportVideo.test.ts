import { describe, expect, it } from 'vitest'
import { clampToRange, exportClipName, pickRecorderFormat, trimBounds } from './exportVideo'
import { defaultVideoEdit } from './model'

describe('trim bounds', () => {
  it('uses the full clip when untrimmed', () => {
    const doc = defaultVideoEdit()
    expect(trimBounds(doc, 25)).toEqual({ start: 0, end: 25 })
  })

  it('uses trimEnd when set, guarding inversion', () => {
    const doc = { ...defaultVideoEdit(), trimStart: 3, trimEnd: 12 }
    expect(trimBounds(doc, 30)).toEqual({ start: 3, end: 12 })
    const inverted = { ...defaultVideoEdit(), trimStart: 12, trimEnd: 3 }
    expect(trimBounds(inverted, 30).start).toBe(3)
    expect(trimBounds(inverted, 30).end).toBe(12)
  })

  it('falls back to duration 0 when unknown', () => {
    expect(trimBounds(defaultVideoEdit(), 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('clampToRange', () => {
  it('clamps into the playable region', () => {
    const bounds = { start: 2, end: 5 }
    expect(clampToRange(0, bounds)).toBe(2)
    expect(clampToRange(3.5, bounds)).toBe(3.5)
    expect(clampToRange(9, bounds)).toBe(5)
  })
})

describe('exportClipName', () => {
  it('keeps the base and drops dangerous characters', () => {
    expect(exportClipName('My Clip <1>.mp4', 'webm').startsWith('My Clip _1_-clip-')).toBe(true)
    expect(exportClipName('My Clip <1>.mp4', 'webm').endsWith('.webm')).toBe(true)
  })
})

describe('recorder format fallback', () => {
  it('prefers WebM when it is available', () => {
    const picked = pickRecorderFormat((type) => type.startsWith('video/webm'))
    expect(picked?.ext).toBe('webm')
    expect(picked?.mimeType).toContain('webm')
  })

  it('falls back to MP4 on browsers without WebM (Safari/iOS)', () => {
    const picked = pickRecorderFormat((type) => type.startsWith('video/mp4'))
    expect(picked?.ext).toBe('mp4')
    expect(picked?.mimeType).toContain('mp4')
  })

  it('returns null when nothing is supported', () => {
    expect(pickRecorderFormat(() => false)).toBeNull()
  })
})
