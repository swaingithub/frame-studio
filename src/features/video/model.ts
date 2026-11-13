import { ADJUSTMENTS_BY_KEY, defaultAdjustments, type AdjustValues } from '../../core/adjustments/registry'
import { defaultChromaKey, defaultGeometry, defaultMask, sanitizeChromaKey, sanitizeLook, sanitizeMask, type ChromaKey, type EditDoc, type LookRef, type Mask } from '../../core/adjustments/edits'
import { sanitizeToneCurve, type ToneCurve } from '../../core/adjustments/color'
import type { SpeedCurve } from './sequenceAnim'

/**
 * The per-clip video edit document: color grade adjustments, trim range and
 * audio volume. Snapshots of this object feed the shared history engine;
 * sanitize repairs anything read back from IndexedDB.
 */

export const VIDEO_EDIT_VERSION = 1

export type VideoSpeed = 0.25 | 0.5 | 1 | 1.5 | 2 | 4

export const SPEED_STEPS: number[] = [0.25, 0.5, 1, 1.5, 2, 4]

export interface VideoEditDoc {
  schemaVersion: number
  adjustments: AdjustValues
  /** Trim range in seconds, clamped to [0, duration]. */
  trimStart: number
  /** null = play to the natural end of the clip. */
  trimEnd: number | null
  /** Output loudness 0..150 (%) with 100 = unchanged. */
  volume: number
  muted: boolean
  /** Playback speed 0.25–4 (1 = normal). */
  speed: number
  /**
   * Ease curve over the clip: 'in' ramps slow→fast etc. Mean-normalized, so
   * the clip's output duration (and the layout) stays exactly unchanged.
   */
  speedCurve: SpeedCurve
  /** Green screen removal (per clip). null = off. */
  chromaKey?: ChromaKey | null
  /** Shape mask (per clip). null = full frame. */
  mask?: Mask | null
  /** AI background removal (people only, per clip). Default false. */
  bgRemove?: boolean
  /** Which one-click look is active and its dialled strength. */
  look?: LookRef | null
  /** Look-owned filmic tone curve (null/absent = identity). */
  curves?: ToneCurve | null
}

export function defaultVideoEdit(): VideoEditDoc {
  return {
    schemaVersion: VIDEO_EDIT_VERSION,
    adjustments: defaultAdjustments(),
    trimStart: 0,
    trimEnd: null,
    volume: 100,
    muted: false,
    speed: 1,
    speedCurve: 'none',
    chromaKey: null,
    mask: null,
    bgRemove: false,
  }
}

export const SPEED_CURVES: SpeedCurve[] = ['none', 'in', 'out', 'inOut', 'outIn']

export const SPEED_CURVE_LABELS: Record<SpeedCurve, string> = {
  none: 'Constant',
  in: 'Ramp in',
  out: 'Ramp out',
  inOut: 'Slow-fast-slow',
  outIn: 'Fast-slow-fast',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

function clampVolume(v: unknown): number {
  return clampNumber(v, 0, 150, 100)
}

function clampSeconds(v: unknown, duration: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  // Unknown length (duration 0) → only guard negatives; clamping into a
  // zero-length range would silently wipe stored trim values.
  if (duration <= 0) return Math.max(0, n)
  const max = Math.max(0, duration)
  return Math.min(max, Math.max(0, Math.min(n, max)))
}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

function clampSpeed(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n))
}

function clampCurve(v: unknown): SpeedCurve {
  return SPEED_CURVES.includes(v as SpeedCurve) ? (v as SpeedCurve) : 'none'
}

function clampAdjustments(raw: Record<string, unknown>): AdjustValues {
  const safe = defaultAdjustments()
  for (const [key, value] of Object.entries(raw)) {
    const param = ADJUSTMENTS_BY_KEY[key as keyof typeof ADJUSTMENTS_BY_KEY]
    if (param && typeof value === 'number' && Number.isFinite(value)) {
      safe[param.key] = Math.min(param.max, Math.max(param.min, value))
    }
  }
  return safe
}

/**
 * Repairs a doc from storage into a fully valid one. `duration` (seconds)
 * bounds the trim; pass 0 when the clip length is still unknown.
 */
export function sanitizeVideoEdit(raw: unknown, duration = 0): VideoEditDoc {
  if (!isRecord(raw)) return defaultVideoEdit()
  const adjustments = clampAdjustments(isRecord(raw.adjustments) ? raw.adjustments : {})
  const trimStart = clampSeconds(raw.trimStart, duration, 0)
  const rawTrimEnd = raw.trimEnd === undefined || raw.trimEnd === null ? null : clampSeconds(raw.trimEnd, duration, trimStart)
  // A non-null end must strictly extend the start — an inverted or clamped
  // colliding range is dropped entirely (both fields reset).
  const trimEnd = rawTrimEnd !== null && rawTrimEnd > trimStart ? rawTrimEnd : null
  const finalStart = trimEnd === null && rawTrimEnd !== null ? 0 : trimStart
  return {
    schemaVersion: VIDEO_EDIT_VERSION,
    adjustments,
    trimStart: finalStart,
    trimEnd,
    volume: clampVolume(raw.volume),
    muted: raw.muted === true,
    speed: clampSpeed(raw.speed),
    speedCurve: clampCurve(raw.speedCurve),
    chromaKey: raw.chromaKey === undefined || raw.chromaKey === null ? null : sanitizeChromaKey(raw.chromaKey),
    mask: raw.mask === undefined || raw.mask === null ? null : sanitizeMask(raw.mask),
    look: raw.look === undefined || raw.look === null ? null : sanitizeLook(raw.look),
    curves: raw.curves === undefined || raw.curves === null ? null : sanitizeToneCurve(raw.curves),
    bgRemove: raw.bgRemove === true,
  }
}

/** Applies one adjustment change (pure). */
export function withVideoAdjustment(doc: VideoEditDoc, key: keyof AdjustValues, value: number): VideoEditDoc {
  const param = ADJUSTMENTS_BY_KEY[key]
  if (!param) return doc
  return {
    ...doc,
    adjustments: { ...doc.adjustments, [key]: Math.min(param.max, Math.max(param.min, value)) },
  }
}

/** Merges a whole adjustment set (one-click looks) over the doc (pure). */
export function withVideoAdjustments(doc: VideoEditDoc, values: Partial<AdjustValues>): VideoEditDoc {
  const merged = { ...doc.adjustments, ...values }
  return { ...doc, adjustments: clampAdjustments(merged as Record<string, unknown>) }
}

/** Sets volume (pure). */
export function withVolume(doc: VideoEditDoc, volume: number): VideoEditDoc {
  return { ...doc, volume: clampVolume(volume) }
}

/** Sets playback speed (pure). */
export function withSpeed(doc: VideoEditDoc, speed: number): VideoEditDoc {
  return { ...doc, speed: clampSpeed(speed) }
}

/** Sets the speed ramp curve (pure). */
export function withSpeedCurve(doc: VideoEditDoc, curve: SpeedCurve): VideoEditDoc {
  return { ...doc, speedCurve: clampCurve(curve) }
}

/** Applies a chroma key patch (pure). Turning off clears it to neutral null. */
export function withChromaKey(doc: VideoEditDoc, patch: Partial<ChromaKey>): VideoEditDoc {
  if (patch.enabled === false) return { ...doc, chromaKey: null }
  const current = doc.chromaKey ?? defaultChromaKey()
  const next: ChromaKey = {
    enabled: true,
    color: patch.color ? ([...patch.color] as [number, number, number]) : [...current.color] as [number, number, number],
    similarity: clampNumber(patch.similarity ?? current.similarity, 0, 0.5, current.similarity),
    smoothness: clampNumber(patch.smoothness ?? current.smoothness, 0, 0.5, current.smoothness),
    spill: clampNumber(patch.spill ?? current.spill, 0, 1, current.spill),
  }
  return { ...doc, chromaKey: next }
}

/** Applies a mask patch (pure). Setting shape 'none' clears it to null. */
export function withMask(doc: VideoEditDoc, patch: Partial<Mask>): VideoEditDoc {
  if (patch.shape === 'none') return { ...doc, mask: null }
  const current = doc.mask ?? defaultMask()
  const shape = patch.shape ?? (current.shape === 'none' ? 'circle' : current.shape)
  return { ...doc, mask: sanitizeMask({ ...current, ...patch, shape }) }
}

/** Toggles AI background removal (pure). */
export function withBgRemove(doc: VideoEditDoc, enabled: boolean): VideoEditDoc {
  return { ...doc, bgRemove: enabled === true }
}

/** Sets the trim range (pure); skips degenerate zero-length ranges. */
export function withTrim(doc: VideoEditDoc, trimStart: number, trimEnd: number | null, duration: number): VideoEditDoc {
  const next = sanitizeVideoEdit({ ...doc, trimStart, trimEnd }, duration)
  return next
}

/** True when nothing was changed vs a fresh doc. */
export function isVideoEditNeutral(doc: VideoEditDoc, neutral: VideoEditDoc): boolean {
  return JSON.stringify(doc) === JSON.stringify(neutral)
}

/** Adapter: the video grade feeds the shared render pipeline (no geometry edits). */
export function videoDocToEditDoc(doc: VideoEditDoc, geometry: EditDoc['geometry'] = defaultGeometry()): EditDoc {
  return {
    schemaVersion: doc.schemaVersion,
    adjustments: doc.adjustments,
    geometry,
    chromaKey: doc.chromaKey ?? null,
    mask: doc.mask ?? null,
    curves: doc.curves ?? undefined,
  }
}
