/**
 * Pure keyframe animation math for the video editor — no IO, no React.
 * Keyframes live on `t` (seconds into the owning timeline scope) with a
 * numeric `v`; evaluation interpolates between neighbours. `smooth` easing
 * gives the classic auto-curve (cosine — C1-continuous, ease-in-out by
 * construction); `linear` is straight lerp. Outside the keyframe range the
 * first/last value holds.
 */

export type EaseName = 'linear' | 'smooth'

export interface Keyframe {
  id: string
  /** Seconds, relative to the owning scope (clip in / overlay start). */
  t: number
  v: number
  ease: EaseName
}

/** One animatable property's keys, sorted by time on write. */
export type KeyframeTrack = Keyframe[]

/** All animatable properties of a clip or overlay. */
export interface KeyframeSet {
  /** Zoom: 1 = fit, >1 = zoomed in (base clip) / enlarged (overlay). */
  scale: KeyframeTrack
  /** Pan origin: 0..1 of the valid pan range (0.5 = centered). */
  x: KeyframeTrack
  y: KeyframeTrack
  /** Overlay-only: 0..1 blend over the base track. */
  opacity: KeyframeTrack
}

/** Static values before the first / after the last keyframe. */
export interface AnimBase {
  scale: number
  x: number
  y: number
  opacity: number
}

export const ANIM_DEFAULTS: AnimBase = { scale: 1, x: 0.5, y: 0.5, opacity: 1 }

/** Bounds per property — the inspector and sanitizer clamp these. */
export const ANIM_RANGES: Record<keyof AnimBase, { min: number; max: number }> = {
  scale: { min: 0.1, max: 4 },
  x: { min: 0, max: 1 },
  y: { min: 0, max: 1 },
  opacity: { min: 0, max: 1 },
}

/** Cosine auto-curve between a..b at u∈[0..1]. */
export function smoothstep(u: number): number {
  const c = Math.max(0, Math.min(1, u))
  return 0.5 - 0.5 * Math.cos(Math.PI * c)
}

/**
 * Evaluates one keyframe track at `t`. Keys may be unsorted — a defensive
 * binary search would over-claim; tracks here are short, so a linear scan
 * over the sorted array (kept sorted on every write) is exact.
 */
export function valueAt(track: KeyframeTrack | undefined, t: number, base: number): number {
  if (!track || track.length === 0) return base
  const keys = track
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = Math.max(1e-6, b.t - a.t)
      const u = (t - a.t) / span
      const eased = b.ease === 'smooth' ? smoothstep(u) : u
      return a.v + (b.v - a.v) * eased
    }
  }
  return keys[keys.length - 1].v
}

/** Evaluates the whole set at `t`. */
export function animAt(anim: KeyframeSet | undefined, t: number, base: AnimBase): AnimBase {
  if (!anim) return base
  return {
    scale: valueAt(anim.scale, t, base.scale),
    x: valueAt(anim.x, t, base.x),
    y: valueAt(anim.y, t, base.y),
    opacity: valueAt(anim.opacity, t, base.opacity),
  }
}

export function hasKeys(anim: KeyframeSet | undefined): boolean {
  return (
    !!anim &&
    (anim.scale.length > 0 || anim.x.length > 0 || anim.y.length > 0 || anim.opacity.length > 0)
  )
}

// ---------------------------------------------------------------------------
// Speed ramping — an eased speed curve INSIDE one clip. Shapes are normalized
// to mean 1.0 so the clip's output duration (and the whole layout!) stays
// identical to its average speed; only the pace over time changes.
// ---------------------------------------------------------------------------

export type SpeedCurve = 'none' | 'in' | 'out' | 'inOut' | 'outIn' | 'dramatic' | 'gentle'

/** Normalized ramp shapes (piecewise linear, ×avg). `f(0..1)`, mean = 1. */
const SHAPE_POINTS: Record<Exclude<SpeedCurve, 'none'>, [number, number][]> = {
  // slow start → fast end
  in: [
    [0, 0.3],
    [1, 1.7],
  ],
  // fast start → slow end
  out: [
    [0, 1.7],
    [1, 0.3],
  ],
  // slow → fast → slow (diamond)
  inOut: [
    [0, 0.35],
    [0.5, 1.65],
    [1, 0.35],
  ],
  // fast → slow → fast (valley)
  outIn: [
    [0, 1.65],
    [0.5, 0.35],
    [1, 1.65],
  ],
  // deep ramp: near-still start → very fast end (speed-ramp punch)
  dramatic: [
    [0, 0.1],
    [1, 1.9],
  ],
  // subtle ramp for a natural pace shift
  gentle: [
    [0, 0.7],
    [1, 1.3],
  ],
}

/** Instantaneous speed multiplier at normalized position u∈[0..1] × avg. */
export function shapeAt(curve: SpeedCurve, u: number): number {
  if (curve === 'none' || SHAPE_POINTS[curve as 'in'] === undefined) return 1
  const points = SHAPE_POINTS[curve as 'in']
  const p = Math.max(0, Math.min(1, u))
  for (let i = 0; i < points.length - 1; i++) {
    const [u0, m0] = points[i]
    const [u1, m1] = points[i + 1]
    if (p >= u0 && p <= u1) {
      const span = Math.max(1e-6, u1 - u0)
      return m0 + (m1 - m0) * ((p - u0) / span)
    }
  }
  return 1
}

/**
 * Source fraction consumed by the time the clip has played up to u (the
 * normalized integral of `shapeAt`, which sums to exactly 1 over [0..1]).
 * Closed-form because the shapes are piecewise linear.
 */
export function srcFractionAt(curve: SpeedCurve, u: number): number {
  if (curve === 'none' || SHAPE_POINTS[curve as 'in'] === undefined) return Math.max(0, Math.min(1, u))
  const points = SHAPE_POINTS[curve as 'in']
  const p = Math.max(0, Math.min(1, u))
  let consumed = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [u0, m0] = points[i]
    const [u1, m1] = points[i + 1]
    if (p <= u1) {
      const t = (p - u0) / Math.max(1e-6, u1 - u0)
      consumed += t * (m0 + (m1 - m0) * t / 2) * (u1 - u0)
      return consumed
    }
    consumed += (m0 + m1) / 2 * (u1 - u0)
  }
  return consumed
}

/** Averages each shape — a cheap self-check the tests use. */
export function shapeMean(curve: Exclude<SpeedCurve, 'none'>, samples = 200): number {
  let total = 0
  for (let i = 0; i < samples; i++) {
    total += shapeAt(curve, (i + 0.5) / samples) / samples
  }
  return total
}

/**
 * Exact inverse of `srcFractionAt`: the output-time fraction u at which the
 * clip has consumed source fraction `f`. Piecewise quadratic segments solved
 * in closed form — used to clock playback and seeks against a ramping speed.
 */
export function outFractionAt(curve: SpeedCurve, f: number): number {
  const p = Math.max(0, Math.min(1, f))
  if (curve === 'none' || SHAPE_POINTS[curve as 'in'] === undefined) return p
  const points = SHAPE_POINTS[curve as 'in']
  let consumed = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [u0, m0] = points[i]
    const [u1, m1] = points[i + 1]
    const w = u1 - u0
    const segment = consumed + ((m0 + m1) / 2) * w
    if (p <= segment) {
      const target = p - consumed
      const a = (m1 - m0) / (2 * w)
      let s: number
      if (Math.abs(a) < 1e-12) {
        s = target / m0
      } else {
        const disc = Math.max(0, m0 * m0 + 4 * a * target)
        s = (-m0 + Math.sqrt(disc)) / (2 * a)
      }
      return Math.max(u0, Math.min(u1, u0 + Math.max(0, s)))
    }
    consumed = segment
  }
  return 1
}
