/**
 * Pure channel-histogram computation on raw RGBA bytes.
 * Bins are returned as 256-bin counts sampled from an optional stride.
 */

export interface Histogram {
  r: Int32Array
  g: Int32Array
  b: Int32Array
  l: Int32Array
  /** Count of sampled pixels. */
  samples: number
}

const LUMA = [0.2126, 0.7152, 0.0722] as const

export function computeHistogram(data: Uint8ClampedArray, maxSamples = 25_000): Histogram {
  const r = new Int32Array(256)
  const g = new Int32Array(256)
  const b = new Int32Array(256)
  const l = new Int32Array(256)
  const pixels = data.length / 4
  if (pixels === 0) return { r, g, b, l, samples: 0 }

  const stride = Math.max(1, Math.ceil(pixels / maxSamples))
  let samples = 0
  for (let i = 0; i < pixels; i += stride) {
    const o = i * 4
    const rv = data[o]
    const gv = data[o + 1]
    const bv = data[o + 2]
    r[rv]++
    g[gv]++
    b[bv]++
    l[Math.min(255, Math.round(rv * LUMA[0] + gv * LUMA[1] + bv * LUMA[2]))]++
    samples++
  }
  return { r, g, b, l, samples }
}
