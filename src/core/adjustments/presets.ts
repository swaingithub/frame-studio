import { ADJUSTMENTS, ADJUSTMENTS_BY_KEY, defaultAdjustments, type AdjustValues } from './registry'

/**
 * One-click looks shared by the photo and video editors, plus the Auto
 * enhance heuristic. Pure functions only — UI just applies the values.
 */

export interface AdjustPreset {
  id: string
  label: string
  /** Short human description shown as a tooltip. */
  description: string
  values: Partial<AdjustValues>
}

export const PRESETS: readonly AdjustPreset[] = [
  {
    id: 'natural',
    label: 'Natural',
    description: 'Gentle pop and lift — good default',
    values: { contrast: 8, clarity: 5, vibrance: 8, shadows: 6 },
  },
  {
    id: 'vivid',
    label: 'Vivid',
    description: 'Punchy colors and strong contrast',
    values: { contrast: 25, saturation: 12, vibrance: 28, clarity: 14, shadows: -8, blacks: -6 },
  },
  {
    id: 'mono',
    label: 'B&W',
    description: 'Classic black-and-white with texture',
    values: { saturation: -100, vibrance: -100, contrast: 18, clarity: 12, grain: 15, vignette: 16 },
  },
  {
    id: 'warm',
    label: 'Warm',
    description: 'Golden-hour glow',
    values: { temperature: 20, exposure: 5, vibrance: 10, highlights: -6, vignette: 8 },
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Cool teal grade with crushed blacks',
    values: { temperature: -16, contrast: 12, shadows: 14, highlights: -12, saturation: -6, vignette: 14 },
  },
  {
    id: 'fade',
    label: 'Fade',
    description: 'Matte film look with lifted blacks',
    values: { contrast: -16, blacks: 22, whites: -12, saturation: -10, grain: 8 },
  },
  {
    id: 'crisp',
    label: 'Crisp',
    description: 'Sharp and clean for details and text',
    values: { clarity: 16, sharpness: 22, contrast: 10, noiseReduction: 12 },
  },
  {
    id: 'dream',
    label: 'Dream',
    description: 'Soft, hazy, low-contrast glow',
    values: { exposure: 6, contrast: -12, blacks: 10, highlights: 12, saturation: 5, grain: 10 },
  },
]

function clampKey(key: keyof AdjustValues, value: number): number {
  const param = ADJUSTMENTS_BY_KEY[key as keyof typeof ADJUSTMENTS_BY_KEY]
  if (!param) return value
  return Math.min(param.max, Math.max(param.min, value))
}

/** Merges a preset over the defaults, clamping every value into range. */
export function presetValues(preset: AdjustPreset): AdjustValues {
  const base = defaultAdjustments()
  for (const [key, value] of Object.entries(preset.values)) {
    base[key as keyof AdjustValues] = clampKey(key as keyof AdjustValues, value as number)
  }
  return base
}

/**
 * A preset dialled back to `strength` (0..1): every preset key lerps between
 * the neutral default and the full preset value. Lets users dial a look
 * up/down after applying it.
 */
export function mixValues(preset: AdjustPreset, strength: number): AdjustValues {
  const base = defaultAdjustments()
  const t = Math.min(1, Math.max(0, strength))
  for (const [key, value] of Object.entries(preset.values)) {
    const k = key as keyof AdjustValues
    const full = clampKey(k, value as number)
    base[k] = clampKey(k, base[k] + (full - base[k]) * t)
  }
  return base
}

/** Mean luma, 0..1. */
export interface HistogramStats {
  mean: number
  median: number
  blackPoint: number
  whitePoint: number
}

/** Pixel-count histogram, 256 bins covering 0..255. */
export type LumaBins = { l: Int32Array; samples: number }

/** Computes luma-bin statistics for the Auto heuristic (pure). */
export function statsFromHistogram(bins: Int32Array, samples: number): HistogramStats {
  const stats: HistogramStats = { mean: 0.45, median: 0.45, blackPoint: 0, whitePoint: 1 }
  if (bins.length < 256 || samples <= 0) return stats

  const total = Array.from(bins).reduce((a, b) => a + b, 0)
  if (total <= 0) return stats

  let running = 0
  let mean = 0
  let median = -1
  let blackPoint = 0
  let whitePoint = 1
  const lowerCut = total * 0.0005
  const upperCut = total * 0.9995
  let lowerReached = false
  let upperReached = false
  for (let bin = 0; bin < 256; bin++) {
    const value = (bin / 255) as number
    const count = bins[bin] as number
    running += count
    mean += value * count
    if (median < 0 && running >= total / 2) median = value
    if (!lowerReached && running >= lowerCut) {
      blackPoint = value
      lowerReached = true
    }
    if (!upperReached && running >= upperCut) {
      whitePoint = Math.max(blackPoint, value)
      upperReached = true
    }
  }
  return { mean: mean / total, median: median < 0 ? 0.5 : median, blackPoint, whitePoint }
}

/**
 * One-click Auto enhance: analyzes achromatic luma statistics and balances
 * tonality. At perfect stats (p05→p30 etc.) the result is neutral.
 * Values are clamped conservatively so Auto never overshoots.
 */
export function autoValues(stats: HistogramStats): Partial<AdjustValues> {
  const clamp = (v: number): number => Math.round(Math.min(60, Math.max(-60, v)))
  const values: Partial<AdjustValues> = {}

  // Push the median toward ~45%.
  const exposure = clamp((0.45 - stats.median) * 160)
  if (Math.abs(exposure) > 2) values.exposure = exposure

  // Stretch the black/white points toward the frame edges.
  const blackLift = clamp((0.04 - stats.blackPoint) * 220) // + lifts crushed blacks
  if (Math.abs(blackLift) > 3) values.blacks = blackLift
  const whiteRecovery = clamp((stats.whitePoint - 0.94) * -260) // − recovers blown whites
  if (Math.abs(whiteRecovery) > 3) values.whites = whiteRecovery

  // Contrast from tonal spread; tiny spread → flat → add punch.
  // (Threshold >6: a nearly-normal spread shouldn't add a contrast nudge.)
  const spread = stats.whitePoint - stats.blackPoint
  const contrast = clamp((0.85 - spread) * 120)
  if (Math.abs(contrast) > 6) values.contrast = contrast

  // Protect highlights and shadows away from clipping.
  const shadows = clamp((0.38 - stats.median) * 40)
  if (Math.abs(shadows) > 4) values.shadows = shadows

  values.vibrance = 12 // gentle, near-free win on real footage
  return values
}

/** All registered adjustment keys, for tests/UI to validate coverage. */
export const ADJUSTMENT_KEYS = ADJUSTMENTS.map((p) => p.key)
