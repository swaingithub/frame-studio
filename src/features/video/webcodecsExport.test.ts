import { describe, expect, it } from 'vitest'
import { evenDimensions, micros, WC_CANDIDATES } from './webcodecsExport'

describe('evenDimensions', () => {
  it('rounds down to even and never below 2', () => {
    expect(evenDimensions(640, 360)).toEqual({ w: 640, h: 360 })
    expect(evenDimensions(641, 361)).toEqual({ w: 640, h: 360 })
    expect(evenDimensions(3, 2)).toEqual({ w: 2, h: 2 })
    expect(evenDimensions(1, 1)).toEqual({ w: 2, h: 2 })
  })
})

describe('micros', () => {
  it('converts elapsed ms to non-negative microseconds', () => {
    expect(micros(1000, 1033.5)).toBe(33500)
    expect(micros(1000, 999)).toBe(0)
  })
})

describe('WC_CANDIDATES', () => {
  it('prefers MP4/H.264+AAC and ends with a WebM fallback', () => {
    expect(WC_CANDIDATES[0]).toMatchObject({ video: 'avc', audio: 'aac', ext: 'mp4' })
    expect(WC_CANDIDATES.at(-1)).toMatchObject({ video: 'vp9', audio: 'opus', ext: 'webm' })
  })
})
