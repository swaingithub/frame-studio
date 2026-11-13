import { describe, expect, it } from 'vitest'
import { computeHistogram } from './histogram'

function flatImage(count: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return data
}

describe('computeHistogram', () => {
  it('puts all samples of a flat gray image in one luma bin', () => {
    const h = computeHistogram(flatImage(500, [50, 50, 50]))
    expect(h.samples).toBe(500)
    const expectedLuma = Math.round(50 * (0.2126 + 0.7152 + 0.0722))
    expect(h.l[expectedLuma]).toBe(500)
    let lumaTotal = 0
    for (const v of h.l) lumaTotal += v
    expect(lumaTotal).toBe(500)
  })

  it('separates channels for a pure red image', () => {
    const h = computeHistogram(flatImage(100, [255, 0, 0]))
    expect(h.r[255]).toBe(100)
    expect(h.g[0]).toBe(100)
    expect(h.b[0]).toBe(100)
    const lumaBin = Math.round(255 * 0.2126)
    expect(h.l[lumaBin]).toBe(100)
  })

  it('respects the sample cap', () => {
    const h = computeHistogram(flatImage(100_000, [10, 20, 30]), 1000)
    expect(h.samples).toBeLessThanOrEqual(1000)
    expect(h.samples).toBeGreaterThan(0)
  })

  it('handles empty input', () => {
    const h = computeHistogram(new Uint8ClampedArray(0))
    expect(h.samples).toBe(0)
  })
})
