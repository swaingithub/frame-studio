import { describe, expect, it } from 'vitest'
import { containRect, coverRect } from './fit'

describe('aspect fit', () => {
  it('letterboxes a wide clip inside a square frame', () => {
    expect(containRect(1920, 1080, 720, 720)).toEqual({ x: 0, y: 158, w: 720, h: 405 })
  })

  it('pillarboxes a tall clip inside a wide frame', () => {
    expect(containRect(1080, 1920, 1280, 720)).toEqual({ x: 438, y: 0, w: 405, h: 720 })
  })

  it('fills exactly when aspects match', () => {
    expect(containRect(960, 540, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
  })

  it('covers the frame, overflowing one axis', () => {
    expect(coverRect(1920, 1080, 720, 720)).toEqual({ x: -280, y: 0, w: 1280, h: 720 })
  })

  it('returns an empty rect for degenerate inputs', () => {
    expect(containRect(0, 100, 720, 720)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(coverRect(100, 100, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
