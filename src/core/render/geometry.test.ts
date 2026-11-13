import { describe, expect, it } from 'vitest'
import {
  apply,
  compose,
  coverScale,
  invert,
  planGeometry,
  planGeometryBase,
} from './geometry'
import { defaultGeometry as geomDefault, type GeometryValues } from '../adjustments/edits'

function geom(partial: Partial<GeometryValues>): GeometryValues {
  return { ...geomDefault(), ...partial }
}

describe('affine math', () => {
  it('composes in application order', () => {
    // translate then rotate 90°: (1,0) → (1,1) → R(x,y)=(-y,x) → (-1,1)
    const m = compose({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 1 })
    expect(apply(m, 1, 0)).toEqual([-1, 1])
  })

  it('inverts exactly', () => {
    const t = { a: 2, b: 0.5, c: -1, d: 3, e: 10, f: -4 }
    const i = invert(t)
    const [x, y] = apply(t, 3.25, -7.5)
    expect(apply(i, x, y)[0]).toBeCloseTo(3.25, 10)
    expect(apply(i, x, y)[1]).toBeCloseTo(-7.5, 10)
  })
})

describe('coverScale', () => {
  it('is 1 at zero angle', () => {
    expect(coverScale(1000, 800, 0)).toBe(1)
  })

  it('grows with angle', () => {
    expect(coverScale(2000, 1500, Math.PI / 6)).toBeGreaterThan(1)
  })
})

describe('planGeometry', () => {
  it('is identity for a default document', () => {
    const plan = planGeometry(4000, 3000, geomDefault())
    for (const [uvx, uvy] of [[0, 0], [1, 1], [0.3, 0.7], [1, 0], [0, 1]]) {
      const [sx, sy] = apply(plan.matrix, uvx, uvy)
      expect(sx).toBeCloseTo(uvx, 10)
      expect(sy).toBeCloseTo(uvy, 10)
    }
    expect(plan.outW).toBe(4000)
    expect(plan.outH).toBe(3000)
  })

  it('maps crop corners into the crop rect', () => {
    const plan = planGeometry(4000, 3000, geom({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }))
    expect(apply(plan.matrix, 0, 0)[0]).toBeCloseTo(0.25, 8)
    expect(apply(plan.matrix, 0, 0)[1]).toBeCloseTo(0.25, 8)
    const [ex, ey] = apply(plan.matrix, 1, 1)
    expect(ex).toBeCloseTo(0.75, 8)
    expect(ey).toBeCloseTo(0.75, 8)
    expect(plan.outW).toBeCloseTo(2000, 6)
    expect(plan.outH).toBeCloseTo(1500, 6)
  })

  it('swaps output dims for 90° quarter turns', () => {
    const plan = planGeometry(4000, 3000, geom({ rotateQuarter: 1 }))
    expect(plan.outW).toBe(3000)
    expect(plan.outH).toBe(4000)
  })

  it('quarter turn maps output uv corners to the right source corners', () => {
    // 90° clockwise in y-down space: the source's bottom-left corner swings
    // up into the output's top-left, so out(0,0) samples source (0,1).
    const plan = planGeometry(1000, 800, geom({ rotateQuarter: 1 }))
    const [x, y] = apply(plan.matrix, 0, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
  })

  it('crop rect stays inside bounds for clips', () => {
    const plan = planGeometryBase(1000, 800, geom({ straighten: 30, crop: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }))
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => apply(plan.matrix, u, v))
    for (const [x, y] of corners) {
      expect(x).toBeGreaterThan(-0.0001)
      expect(x).toBeLessThan(1.0001)
      expect(y).toBeGreaterThan(-0.0001)
      expect(y).toBeLessThan(1.0001)
    }
  })

  it('horizontal flip maps x=0 to x=1', () => {
    const plan = planGeometry(1000, 800, geom({ flipH: true }))
    const [x] = apply(plan.matrix, 0, 0.5)
    expect(x).toBeCloseTo(1, 8)
    const [, y2] = apply(plan.matrix, 0.5, 0)
    expect(y2).toBeCloseTo(0, 8)
  })
})
