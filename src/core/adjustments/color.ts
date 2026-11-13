/**
 * Tone curves and HSL mixer — the photo-lab controls that sit on top of
 * the slider grade. Pure data + evaluation so sanitizing, tests, and the
 * shader stay in lockstep.
 */

export const CURVE_INPUTS = [0, 0.25, 0.5, 0.75, 1] as const

export type CurveKnots = [number, number, number, number, number]

export interface ToneCurve {
  /** Master output Y for five evenly spaced inputs. Identity = CURVE_INPUTS. */
  master: CurveKnots
  /** Parametric lifts, −100..100. */
  shadows: number
  darks: number
  lights: number
  highlights: number
}

export const HSL_CHANNELS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const

export type HslChannel = (typeof HSL_CHANNELS)[number]

export interface HslBand {
  hue: number
  sat: number
  lum: number
}

export type HslMixer = Record<HslChannel, HslBand>

export const HSL_CHANNEL_LABELS: Record<HslChannel, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
}

export const HSL_CHANNEL_SWATCH: Record<HslChannel, string> = {
  red: '#e24b4b',
  orange: '#e8892c',
  yellow: '#e6c84a',
  green: '#3caf5c',
  aqua: '#2eb8c7',
  blue: '#3d6ef7',
  purple: '#8b5cf6',
  magenta: '#d946a6',
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function identityKnots(): CurveKnots {
  return [0, 0.25, 0.5, 0.75, 1]
}

export function defaultToneCurve(): ToneCurve {
  return {
    master: identityKnots(),
    shadows: 0,
    darks: 0,
    lights: 0,
    highlights: 0,
  }
}

export function defaultHslBand(): HslBand {
  return { hue: 0, sat: 0, lum: 0 }
}

export function defaultHslMixer(): HslMixer {
  return {
    red: defaultHslBand(),
    orange: defaultHslBand(),
    yellow: defaultHslBand(),
    green: defaultHslBand(),
    aqua: defaultHslBand(),
    blue: defaultHslBand(),
    purple: defaultHslBand(),
    magenta: defaultHslBand(),
  }
}

export function isIdentityCurve(curve: ToneCurve): boolean {
  const id = identityKnots()
  return (
    curve.master.every((y, i) => Math.abs(y - id[i]) < 1e-4) &&
    curve.shadows === 0 &&
    curve.darks === 0 &&
    curve.lights === 0 &&
    curve.highlights === 0
  )
}

export function isNeutralHsl(mixer: HslMixer): boolean {
  return HSL_CHANNELS.every((ch) => mixer[ch].hue === 0 && mixer[ch].sat === 0 && mixer[ch].lum === 0)
}

/**
 * Smoothstep interpolation matching the fragment shader's applyCurve().
 * Used by tests so host and GPU stay honest.
 */
export function evaluateCurve(knots: CurveKnots, x: number): number {
  const t = clamp(x, 0, 1) * 4
  const i = Math.min(3, Math.floor(t))
  const f = t - i
  const s = f * f * (3 - 2 * f)
  return knots[i] * (1 - s) + knots[i + 1] * s
}

/** Repairs a tone curve from storage. Never throws. */
export function sanitizeToneCurve(raw: unknown): ToneCurve {
  const safe = defaultToneCurve()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  if (Array.isArray(rec.master) && rec.master.length === 5) {
    safe.master = rec.master.map((v, i) => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : CURVE_INPUTS[i]
      return clamp(n, 0, 1)
    }) as CurveKnots
    safe.master[0] = clamp(safe.master[0], 0, 0.5)
    safe.master[4] = clamp(safe.master[4], 0.5, 1)
  }
  safe.shadows = clampNum(rec.shadows, -100, 100, 0)
  safe.darks = clampNum(rec.darks, -100, 100, 0)
  safe.lights = clampNum(rec.lights, -100, 100, 0)
  safe.highlights = clampNum(rec.highlights, -100, 100, 0)
  return safe
}

/** Repairs an HSL mixer from storage. Never throws. */
export function sanitizeHslMixer(raw: unknown): HslMixer {
  const safe = defaultHslMixer()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  for (const ch of HSL_CHANNELS) {
    const band = rec[ch]
    if (typeof band !== 'object' || band === null) continue
    const b = band as Record<string, unknown>
    safe[ch] = {
      hue: clampNum(b.hue, -100, 100, 0),
      sat: clampNum(b.sat, -100, 100, 0),
      lum: clampNum(b.lum, -100, 100, 0),
    }
  }
  return safe
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return clamp(n, min, max)
}
