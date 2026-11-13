import { defaultAdjustments, isNeutral, type AdjustKey, type AdjustValues } from './registry'
import {
  defaultHslMixer,
  defaultToneCurve,
  isIdentityCurve,
  isNeutralHsl,
  sanitizeHslMixer,
  sanitizeToneCurve,
  type HslMixer,
  type ToneCurve,
} from './color'

/**
 * The serializable edit document — one per photo. Stored inside
 * ProjectDoc.photoEdits keyed by asset id, persisted by autosave, and applied
 * by the render pipeline nothing here mutates the original file.
 */

export interface CropRect {
  /** Normalized (0..1) rect within the oriented (rotated + straightened) frame. */
  x: number
  y: number
  w: number
  h: number
}

export interface GeometryValues {
  /** 90° clockwise quarter-turns applied before the straighten angle. */
  rotateQuarter: 0 | 1 | 2 | 3
  /** Degrees, −45..45. Applied with an auto zoom so corners stay covered. */
  straighten: number
  flipH: boolean
  flipV: boolean
  crop: CropRect
}

export interface EditDoc {
  adjustments: AdjustValues
  geometry: GeometryValues
  /** Master + parametric tone curve. Omitted on older docs = identity. */
  curves?: ToneCurve
  /** Per-hue HSL mixer. Omitted on older docs = no-op. */
  hsl?: HslMixer
  /** Chroma key (green screen) — video only; null = off. */
  chromaKey?: ChromaKey | null
  /** Shape mask revealing part of the frame — null = off. */
  mask?: Mask | null
  /** Decorative text layers (photo only), bottom→top in array order. */
  textOverlays?: PhotoTextOverlay[]
  /** Which one-click look is active and its dialled strength (photo only). */
  look?: LookRef | null
  schemaVersion: number
}

/** Active preset look reference — values live in `adjustments`. */
export interface LookRef {
  id: string
  /** 0..1 mix from neutral defaults to the full preset. */
  strength: number
}

/** One draggable text layer on a photo. Position in output UV (0..1, y-down). */
export interface PhotoTextOverlay {
  id: string
  text: string
  x: number
  y: number
  /** 1 = default headline size relative to output height. */
  scale: number
  opacity: number
  /** Degrees, −180..180. */
  rotation: number
  /** CSS colour of the text fill. */
  color: string
}

export const TEXT_OVERLAY_DEFAULTS = { x: 0.5, y: 0.8, scale: 1, opacity: 1, rotation: 0, color: '#ffffff' }

/** Sane bounds per field — sanitizer clamps, UI never offers beyond these. */
export const TEXT_OVERLAY_LIMITS = {
  scale: { min: 0.4, max: 3 },
  opacity: { min: 0.05, max: 1 },
  rotation: { min: -180, max: 180 },
}

export type MaskShape = 'none' | 'linear' | 'circle' | 'rect' | 'mirror' | 'heart' | 'star'

export interface Mask {
  shape: MaskShape
  /** Center in output UV (0..1, y-down). */
  x: number
  y: number
  /** Full width / height of the shape in output UV. */
  w: number
  h: number
  /** Degrees, −180..180. */
  rotation: number
  /** Soft edge width in UV; 0 = hard edge. */
  feather: number
  /** Show everything OUTSIDE the shape instead. */
  invert: boolean
}

export const MASK_SHAPES: MaskShape[] = ['none', 'linear', 'circle', 'rect', 'mirror', 'heart', 'star']

export const MASK_SHAPE_LABELS: Record<MaskShape, string> = {
  none: 'None',
  linear: 'Linear',
  circle: 'Circle',
  rect: 'Rectangle',
  mirror: 'Mirror',
  heart: 'Heart',
  star: 'Star',
}

/** Shader ids — must match maskAlpha() in shader.ts. */
export const MASK_SHAPE_IDS: Record<MaskShape, number> = {
  none: 0,
  linear: 1,
  circle: 2,
  rect: 3,
  mirror: 4,
  heart: 5,
  star: 6,
}

export function defaultMask(): Mask {
  return {
    shape: 'none',
    x: 0.5,
    y: 0.5,
    w: 0.6,
    h: 0.6,
    rotation: 0,
    feather: 0.08,
    invert: false,
  }
}

const MASK_SHAPE_SET = new Set<string>(MASK_SHAPES)

/** Repairs a mask from storage. Never throws. */
export function sanitizeMask(raw: unknown): Mask {
  const safe = defaultMask()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  if (typeof rec.shape === 'string' && MASK_SHAPE_SET.has(rec.shape)) safe.shape = rec.shape as MaskShape
  safe.x = clampNumber(rec.x, 0, 1, safe.x)
  safe.y = clampNumber(rec.y, 0, 1, safe.y)
  safe.w = clampNumber(rec.w, 0.02, 1.5, safe.w)
  safe.h = clampNumber(rec.h, 0.02, 1.5, safe.h)
  safe.rotation = clampNumber(rec.rotation, -180, 180, safe.rotation)
  safe.feather = clampNumber(rec.feather, 0, 0.5, safe.feather)
  safe.invert = rec.invert === true
  return safe
}

export interface ChromaKey {
  enabled: boolean
  /** Key source color, 0..1 rgb. */
  color: [number, number, number]
  /** Chroma-plane radius that drops to transparent, 0..0.5. */
  similarity: number
  /** Edge softness ramp width beyond the similarity radius, 0..0.5. */
  smoothness: number
  /** Color fringe suppression on kept pixels near the edge, 0..1. */
  spill: number
}

/** Classic chroma green — the most common screen backdrop. */
export const DEFAULT_CHROMA_COLOR: [number, number, number] = [0.0, 0.69, 0.25]

export function defaultChromaKey(): ChromaKey {
  return {
    enabled: false,
    color: [...DEFAULT_CHROMA_COLOR],
    similarity: 0.12,
    smoothness: 0.04,
    spill: 0.25,
  }
}

/** Repairs a chroma-key object from storage. Never throws. */
export function sanitizeChromaKey(raw: unknown): ChromaKey {
  const safe = defaultChromaKey()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  if (Array.isArray(rec.color) && rec.color.length === 3) {
    safe.color = rec.color.map((v) => clampNumber(v, 0, 1, 0.5)) as [number, number, number]
  }
  safe.enabled = rec.enabled === true
  safe.similarity = clampNumber(rec.similarity, 0, 0.5, safe.similarity)
  safe.smoothness = clampNumber(rec.smoothness, 0, 0.5, safe.smoothness)
  safe.spill = clampNumber(rec.spill, 0, 1, safe.spill)
  return safe
}

export const EDIT_DOC_VERSION = 3

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

export function defaultGeometry(): GeometryValues {
  return {
    rotateQuarter: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    crop: { ...FULL_CROP },
  }
}

/** The no-op document: rendering it reproduces the untouched source. */
export function createDefaultEditDoc(): EditDoc {
  return {
    adjustments: defaultAdjustments(),
    geometry: defaultGeometry(),
    curves: defaultToneCurve(),
    hsl: defaultHslMixer(),
    schemaVersion: EDIT_DOC_VERSION,
  }
}

/** True when the doc would reproduce the original pixels (ignoring schema). */
export function isDocNeutral(doc: EditDoc): boolean {
  const g = doc.geometry
  const crop = g.crop
  const geometryNeutral =
    g.rotateQuarter === 0 &&
    g.straighten === 0 &&
    !g.flipH &&
    !g.flipV &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.w === 1 &&
    crop.h === 1
  const curve = doc.curves ?? defaultToneCurve()
  const hsl = doc.hsl ?? defaultHslMixer()
  const chromaOff = !doc.chromaKey?.enabled
  const maskOff = !doc.mask || doc.mask.shape === 'none'
  const overlaysOff = (doc.textOverlays?.length ?? 0) === 0
  return (
    isNeutral(doc.adjustments) &&
    geometryNeutral &&
    isIdentityCurve(curve) &&
    isNeutralHsl(hsl) &&
    chromaOff &&
    maskOff &&
    overlaysOff
  )
}

export function docEquals(a: EditDoc, b: EditDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

/** Applies a partial single-parameter change to a doc (pure). */
export function withAdjustment(doc: EditDoc, key: AdjustKey, value: number): EditDoc {
  const next: EditDoc = {
    ...doc,
    adjustments: { ...doc.adjustments, [key]: value },
  }
  return next
}

/** Merges a whole adjustment set (presets & Auto) over a doc (pure). */
export function withAdjustments(doc: EditDoc, values: Partial<AdjustValues>): EditDoc {
  return { ...doc, adjustments: { ...doc.adjustments, ...values } }
}

/** Applies a partial geometry change (pure). */
export function withGeometry(doc: EditDoc, patch: Partial<GeometryValues>): EditDoc {
  return { ...doc, geometry: { ...doc.geometry, ...patch } }
}

/** Replaces the tone curve (pure). */
export function withCurves(doc: EditDoc, curves: ToneCurve): EditDoc {
  return { ...doc, curves }
}

/** Replaces the HSL mixer (pure). */
export function withHsl(doc: EditDoc, hsl: HslMixer): EditDoc {
  return { ...doc, hsl }
}

/** Patches the shape mask (pure). `shape: 'none'` clears it. */
export function withMask(doc: EditDoc, patch: Partial<Mask>): EditDoc {
  const base = doc.mask ?? defaultMask()
  const next: Mask = { ...base, ...patch }
  return { ...doc, mask: next.shape === 'none' ? null : next }
}

/** Replaces the text overlay list (pure). */
export function withTextOverlays(doc: EditDoc, overlays: PhotoTextOverlay[]): EditDoc {
  return { ...doc, textOverlays: overlays.slice(0, 12) }
}

/** Clamps hex colors to a safe `#rrggbb` (or a fallback) form. */
function clampColor(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

/** Repairs one text overlay from storage (null for garbage). */
export function sanitizeTextOverlay(raw: unknown): PhotoTextOverlay | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const id = typeof rec.id === 'string' && rec.id ? rec.id.slice(0, 40) : ''
  const text = typeof rec.text === 'string' ? rec.text.slice(0, 140).trim() : ''
  if (!id || !text) return null
  const num = (v: unknown, def: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
  return {
    id,
    text,
    x: num(rec.x, TEXT_OVERLAY_DEFAULTS.x, -0.5, 1.5),
    y: num(rec.y, TEXT_OVERLAY_DEFAULTS.y, -0.5, 1.5),
    scale: num(rec.scale, TEXT_OVERLAY_DEFAULTS.scale, TEXT_OVERLAY_LIMITS.scale.min, TEXT_OVERLAY_LIMITS.scale.max),
    opacity: num(rec.opacity, TEXT_OVERLAY_DEFAULTS.opacity, TEXT_OVERLAY_LIMITS.opacity.min, TEXT_OVERLAY_LIMITS.opacity.max),
    rotation: num(rec.rotation, TEXT_OVERLAY_DEFAULTS.rotation, TEXT_OVERLAY_LIMITS.rotation.min, TEXT_OVERLAY_LIMITS.rotation.max),
    color: clampColor(rec.color, TEXT_OVERLAY_DEFAULTS.color),
  }
}

/** Repairs a stored look reference (null = none). */
export function sanitizeLook(raw: unknown): LookRef | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const id = typeof rec.id === 'string' && rec.id ? rec.id.slice(0, 40) : ''
  if (!id) return null
  const strength =
    typeof rec.strength === 'number' && Number.isFinite(rec.strength)
      ? Math.min(1, Math.max(0, rec.strength))
      : 1
  return { id, strength }
}

/** Repairs the whole overlay list. */
export function sanitizeTextOverlays(raw: unknown): PhotoTextOverlay[] {
  if (!Array.isArray(raw)) return []
  const out: PhotoTextOverlay[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, 24)) {
    const overlay = sanitizeTextOverlay(item)
    if (overlay && !seen.has(overlay.id)) {
      seen.add(overlay.id)
      out.push(overlay)
    }
  }
  return out.slice(0, 12)
}

/**
 * Copies the color grade (sliders + curve + HSL) onto another photo while
 * leaving that photo's crop/rotate alone — the batch-sync path.
 */
export function withCopiedGrade(target: EditDoc, source: EditDoc): EditDoc {
  return {
    ...target,
    adjustments: { ...source.adjustments },
    curves: source.curves ? { ...source.curves, master: [...source.curves.master] as ToneCurve['master'] } : defaultToneCurve(),
    hsl: source.hsl ? (JSON.parse(JSON.stringify(source.hsl)) as HslMixer) : defaultHslMixer(),
  }
}

/**
 * Recovery path for docs read from IndexedDB — clamps every field into
 * its valid range and repairs missing/invalid structure. Never throws.
 */
export function sanitizeEditDoc(raw: unknown): EditDoc {
  const safe = createDefaultEditDoc()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  const adj = typeof rec.adjustments === 'object' && rec.adjustments !== null
    ? (rec.adjustments as Record<string, unknown>)
    : {}
  for (const [key, value] of Object.entries(adj)) {
    if (key in safe.adjustments && typeof value === 'number') {
      ;(safe.adjustments as Record<string, number>)[key] = clampNumber(value, -100, 100, 0)
    }
  }
  const g = typeof rec.geometry === 'object' && rec.geometry !== null
    ? (rec.geometry as Record<string, unknown>)
    : {}
  if (typeof g.rotateQuarter === 'number' && g.rotateQuarter >= 0 && g.rotateQuarter <= 3) {
    safe.geometry.rotateQuarter = Math.round(g.rotateQuarter) as 0 | 1 | 2 | 3
  }
  safe.geometry.straighten = clampNumber(g.straighten, -45, 45, 0)
  safe.geometry.flipH = g.flipH === true
  safe.geometry.flipV = g.flipV === true
  const c = typeof g.crop === 'object' && g.crop !== null ? (g.crop as Record<string, unknown>) : {}
  const crop = {
    x: clampNumber(c.x, 0, 1, 0),
    y: clampNumber(c.y, 0, 1, 0),
    w: clampNumber(c.w, 0.01, 1, 1),
    h: clampNumber(c.h, 0.01, 1, 1),
  }
  if (crop.x + crop.w > 1) crop.x = Math.max(0, 1 - crop.w)
  if (crop.y + crop.h > 1) crop.y = Math.max(0, 1 - crop.h)
  safe.geometry.crop = crop
  safe.chromaKey = rec.chromaKey === undefined || rec.chromaKey === null ? null : sanitizeChromaKey(rec.chromaKey)
  safe.mask = rec.mask === undefined || rec.mask === null ? null : sanitizeMask(rec.mask)
  safe.textOverlays = sanitizeTextOverlays(rec.textOverlays)
  safe.look = sanitizeLook(rec.look)
  safe.curves = rec.curves === undefined ? defaultToneCurve() : sanitizeToneCurve(rec.curves)
  safe.hsl = rec.hsl === undefined ? defaultHslMixer() : sanitizeHslMixer(rec.hsl)
  return safe
}
