/**
 * The single adjustment registry shared by the photo editor and (in Phase 4)
 * the per-clip video color engine. One source of truth for parameter names,
 * ranges, defaults, groupings and GLSL.
 */

export type AdjustKey =
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'sharpness'
  | 'clarity'
  | 'noiseReduction'
  | 'vignette'
  | 'grain'

export interface AdjustmentParam {
  key: AdjustKey
  label: string
  section: 'light' | 'color' | 'detail' | 'effects'
  min: number
  max: number
  def: number
}

export const ADJUSTMENT_SECTIONS = ['light', 'color', 'detail', 'effects'] as const

export const ADJUSTMENTS: readonly AdjustmentParam[] = [
  // Light
  { key: 'exposure', label: 'Exposure', section: 'light', min: -100, max: 100, def: 0 },
  { key: 'contrast', label: 'Contrast', section: 'light', min: -100, max: 100, def: 0 },
  { key: 'highlights', label: 'Highlights', section: 'light', min: -100, max: 100, def: 0 },
  { key: 'shadows', label: 'Shadows', section: 'light', min: -100, max: 100, def: 0 },
  { key: 'whites', label: 'Whites', section: 'light', min: -100, max: 100, def: 0 },
  { key: 'blacks', label: 'Blacks', section: 'light', min: -100, max: 100, def: 0 },
  // Color
  { key: 'temperature', label: 'Temperature', section: 'color', min: -100, max: 100, def: 0 },
  { key: 'tint', label: 'Tint', section: 'color', min: -100, max: 100, def: 0 },
  { key: 'saturation', label: 'Saturation', section: 'color', min: -100, max: 100, def: 0 },
  { key: 'vibrance', label: 'Vibrance', section: 'color', min: -100, max: 100, def: 0 },
  // Detail
  { key: 'sharpness', label: 'Sharpness', section: 'detail', min: 0, max: 100, def: 0 },
  { key: 'clarity', label: 'Clarity', section: 'detail', min: -100, max: 100, def: 0 },
  { key: 'noiseReduction', label: 'Noise Red.', section: 'detail', min: 0, max: 100, def: 0 },
  // Effects
  { key: 'vignette', label: 'Vignette', section: 'effects', min: -100, max: 100, def: 0 },
  { key: 'grain', label: 'Grain', section: 'effects', min: 0, max: 100, def: 0 },
]

export const ADJUSTMENTS_BY_KEY: Readonly<Record<AdjustKey, AdjustmentParam>> = Object.fromEntries(
  ADJUSTMENTS.map((p) => [p.key, p]),
) as Record<AdjustKey, AdjustmentParam>

export type AdjustValues = Record<AdjustKey, number>

export function defaultAdjustments(): AdjustValues {
  return Object.fromEntries(ADJUSTMENTS.map((p) => [p.key, p.def])) as AdjustValues
}

/** True when every value equals its default (photo is "unedited"). */
export function isNeutral(values: AdjustValues): boolean {
  return ADJUSTMENTS.every((p) => values[p.key] === p.def)
}
