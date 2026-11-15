import { sanitizeVideoEdit, type VideoEditDoc } from './model'
import { MAX_SNAP_OFFSET } from './beatDetect'
import {
  animAt,
  ANIM_DEFAULTS,
  ANIM_RANGES,
  srcFractionAt,
  type AnimBase,
  type EaseName,
  type Keyframe,
  type KeyframeSet,
  type KeyframeTrack,
} from './sequenceAnim'

/**
 * The video sequence: an ordered list of clip *instances* (each references an
 * asset and owns its own edit doc), plus overlay layers (text / media above
 * the base track) and an optional music track. All core math here is pure —
 * layout, locate-at-playhead, splitting, sanitizing — so the timeline and the
 * export validation can never disagree.
 */

export type VideoTransition =
  | 'cut'
  | 'dissolve'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'circle'
  | 'zoom'
  | 'blur'
  | 'fadeBlack'
  | 'fadeWhite'
export type TitlePosition = 'lower' | 'center'
export type { Keyframe, KeyframeSet, EaseName, AnimBase }

export const TRANSITION_LABELS: Record<VideoTransition, string> = {
  cut: 'Cut',
  dissolve: 'Dissolve',
  slideLeft: 'Slide left',
  slideRight: 'Slide right',
  slideUp: 'Slide up',
  slideDown: 'Slide down',
  wipeLeft: 'Wipe left',
  wipeRight: 'Wipe right',
  wipeUp: 'Wipe up',
  wipeDown: 'Wipe down',
  circle: 'Circle',
  zoom: 'Zoom',
  blur: 'Blur',
  fadeBlack: 'Fade to black',
  fadeWhite: 'Fade to white',
}

/** Picker order: common crossfades first, then motion, then colour dips. */
export const TRANSITION_TYPES: readonly VideoTransition[] = [
  'cut',
  'dissolve',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'circle',
  'zoom',
  'blur',
  'fadeBlack',
  'fadeWhite',
]

/**
 * Transitions that play both clips at once. The layout overlaps the neighbours
 * by `transitionDuration` so preview and export share the exact same timing.
 * Colour dips (fadeBlack/fadeWhite) stay sequential.
 */
export const OVERLAP_TRANSITIONS: readonly VideoTransition[] = [
  'dissolve',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'circle',
  'zoom',
  'blur',
]

const OVERLAP_SET = new Set<VideoTransition>(OVERLAP_TRANSITIONS)

export function isOverlapTransition(type: VideoTransition): boolean {
  return OVERLAP_SET.has(type)
}

/** Display duration of one clip's title overlay, in seconds. */
export interface VideoTitle {
  text: string
  position: TitlePosition
  /** How long the title shows from the start of the clip (output seconds). */
  show: number
}

/** One instance of an asset on the timeline. */
export interface VideoClip {
  /** Unique instance id (an asset may appear more than once). */
  id: string
  assetId: string
  edit: VideoEditDoc
  /** Transition **into** this clip (from the previous one). */
  transition: VideoTransition
  /** Requested transition length in seconds (effective value is capped). */
  transitionDuration: number
  title: VideoTitle | null
  /** Keyframed zoom/pan on the clip itself (base-track camera moves). */
  keyframes?: KeyframeSet
}

export type OverlayKind = 'text' | 'image' | 'video'

/** Intro / outro motion presets for an overlay layer (CapCut-style). */
export type OverlayAnimPreset =
  | 'none'
  | 'fade'
  | 'pop'
  | 'zoom'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'typewriter'
  | 'drop'
  | 'bounce'
  | 'swing'

export const OVERLAY_ANIM_PRESETS: OverlayAnimPreset[] = [
  'none', 'fade', 'pop', 'zoom', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'typewriter', 'drop', 'bounce', 'swing',
]

export const OVERLAY_ANIM_LABELS: Record<OverlayAnimPreset, string> = {
  none: 'None',
  fade: 'Fade',
  pop: 'Pop',
  zoom: 'Zoom',
  slideUp: 'Slide up',
  slideDown: 'Slide down',
  slideLeft: 'Slide left',
  slideRight: 'Slide right',
  typewriter: 'Typewriter',
  drop: 'Drop in',
  bounce: 'Bounce',
  swing: 'Swing',
}

/** Intro/outro presets stored on an overlay. Missing fields mean 'none'. */
function isOverlayAnimPreset(v: unknown): v is OverlayAnimPreset {
  return typeof v === 'string' && (OVERLAY_ANIM_PRESETS as string[]).includes(v)
}

function sanitizeOverlayAnim(raw: unknown): OverlayAnimPreset {
  return isOverlayAnimPreset(raw) ? raw : 'none'
}

/**
 * A layer ABOVE the base track: animated text or a media asset (image/video,
 * e.g. a green-screen clip) shown in a movable rect. Doesn't affect the
 * sequence's total duration — it floats over the base edit.
 */
export interface OverlayClip {
  id: string
  kind: OverlayKind
  /** Media overlays only. */
  assetId?: string
  /** Text overlays only. */
  text?: string
  /** Global sequence time (seconds) when the layer appears. */
  start: number
  /** Layer length in seconds. */
  duration: number
  /** Static values when no keyframes animate a property. */
  base: AnimBase
  keyframes: KeyframeSet
  /** CapCut-style intro/outro motion. Absent = none on both ends. */
  animIn?: OverlayAnimPreset
  animOut?: OverlayAnimPreset
  /** Generated by auto-captions (lets "replace/remove captions" find them). */
  caption?: boolean
  /** Media layers with sound: true = silent (video overlays only). */
  muted?: boolean
}

export interface MusicTrack {
  assetId: string
  /** 0..100 output level. */
  volume: number
  /** Detected beat grid in music seconds (music always starts at sequence 0). */
  beats?: number[]
  /** Detected tempo (0 = unknown). */
  bpm?: number
  /** Auto-duck under unmuted clip audio (default true; stored only when false). */
  duck?: boolean
}

/** Fixed output frame shapes (CapCut-style ratio presets). */
export type CanvasAspect = 'original' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '2.35:1'
export type CanvasBackground = 'color' | 'blur'

export const CANVAS_ASPECTS: CanvasAspect[] = ['original', '16:9', '9:16', '1:1', '4:5', '4:3', '2.35:1']

export const CANVAS_ASPECT_LABELS: Record<CanvasAspect, string> = {
  original: 'Original',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
  '2.35:1': '2.35:1',
}

/** Numeric ratios for the fixed presets (original is handled separately). */
export const CANVAS_RATIOS: Record<Exclude<CanvasAspect, 'original'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '2.35:1': 2.35,
}

/** Swatches shown in the canvas panel (first = default black). */
export const CANVAS_COLORS = ['#000000', '#ffffff', '#111827', '#1f2937', '#7c2d12', '#0f766e', '#1e3a8a', '#4c1d95']

export interface CanvasSettings {
  /** 'original' keeps the legacy per-clip frame; presets fix the frame. */
  aspect: CanvasAspect
  /** How the letterbox area is filled. */
  background: CanvasBackground
  /** Fill colour used when background === 'color'. */
  color: string
  /** Export/preview short edge: 720 | 1080 | 1440 (default 720). */
  quality?: number
}

export function defaultCanvasSettings(): CanvasSettings {
  return { aspect: 'original', background: 'color', color: '#000000', quality: 720 }
}

const ASPECT_SET = new Set<string>(CANVAS_ASPECTS)

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback
}

/** Repairs canvas settings read from storage. Never throws. */
export function sanitizeCanvas(raw: unknown): CanvasSettings {
  const safe = defaultCanvasSettings()
  if (typeof raw !== 'object' || raw === null) return safe
  const rec = raw as Record<string, unknown>
  if (typeof rec.aspect === 'string' && ASPECT_SET.has(rec.aspect)) safe.aspect = rec.aspect as CanvasAspect
  safe.background = rec.background === 'blur' ? 'blur' : 'color'
  safe.color = sanitizeHexColor(rec.color, safe.color)
  safe.quality = rec.quality === 1080 || rec.quality === 1440 ? rec.quality : 720
  return safe
}

/**
 * Output pixel size for a fixed aspect preset. Keeps a 720 px short edge and
 * caps the long edge at 1280 px, rounded to even numbers for video encoders.
 * `null` means "use the clip's own frame" (the original behavior).
 */
export function canvasOutputSize(canvas: CanvasSettings): { w: number; h: number } | null {
  if (canvas.aspect === 'original') return null
  const ratio = CANVAS_RATIOS[canvas.aspect]
  const short = canvas.quality ?? 720
  let w = Math.round(ratio >= 1 ? short * ratio : short)
  let h = Math.round(ratio >= 1 ? short : short / ratio)
  if (w > 1920) {
    w = 1920
    h = Math.round(w / ratio)
  }
  if (h > 1920) {
    h = 1920
    w = Math.round(h * ratio)
  }
  const even = (n: number): number => Math.max(2, n - (n % 2))
  return { w: even(w), h: even(h) }
}

export interface VideoSequence {
  clips: VideoClip[]
  /** Overlay layers (top of the stack = last in the array). */
  overlays: OverlayClip[]
  music: MusicTrack | null
  /** Output frame + letterbox fill for the whole project. */
  canvas: CanvasSettings
  /** Marks a sequence that came from the legacy per-asset model. A legacy
   *  sequence that lost all its clips is re-migrated on the next load. */
  fromLegacy?: boolean
}

export const MIN_CLIP_OUT = 0.2
export const MIN_TRIM_SPAN = 0.1
export const MIN_OVERLAY_OUT = 0.3
export const DEFAULT_TRANSITION = 0.5
export const MAX_TRANSITION = 2

export type DurationLookup = (assetId: string) => number

function transitionOf(value: unknown): VideoTransition {
  return typeof value === 'string' && value in TRANSITION_LABELS ? (value as VideoTransition) : 'cut'
}

/** Clamps an animatable value into its property range. */
export function clampAnimValue(prop: keyof AnimBase, v: number): number {
  const range = ANIM_RANGES[prop]
  return Math.max(range.min, Math.min(range.max, v))
}

/**
 * Reduces a raw keyframe list to a valid sorted track: finite times ≥ 0,
 * clamped values, unique-ish ids, sorted by time. Empty result → [].
 */
export function sanitizeKeyframeTrack(raw: unknown, prop: keyof AnimBase): KeyframeTrack {
  if (!Array.isArray(raw)) return []
  const range = ANIM_RANGES[prop]
  const keys: Keyframe[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const k = item as Record<string, unknown>
    const t = typeof k.t === 'number' && Number.isFinite(k.t) ? Math.max(0, k.t) : null
    const v = typeof k.v === 'number' && Number.isFinite(k.v) ? Math.max(range.min, Math.min(range.max, k.v)) : null
    if (t === null || v === null) continue
    keys.push({
      id: typeof k.id === 'string' && k.id ? k.id : `kf_${keys.length}_${Math.floor(Math.abs(t * 1000))}`,
      t,
      v,
      ease: k.ease === 'linear' ? 'linear' : 'smooth',
    })
  }
  keys.sort((a, b) => a.t - b.t)
  return keys
}

export function sanitizeKeyframes(raw: unknown): KeyframeSet {
  const empty: KeyframeSet = { scale: [], x: [], y: [], opacity: [] }
  if (typeof raw !== 'object' || raw === null) return empty
  const rec = raw as Record<string, unknown>
  return {
    scale: sanitizeKeyframeTrack(rec.scale, 'scale'),
    x: sanitizeKeyframeTrack(rec.x, 'x'),
    y: sanitizeKeyframeTrack(rec.y, 'y'),
    opacity: sanitizeKeyframeTrack(rec.opacity, 'opacity'),
  }
}

/**
 * Output length of a clip in sequence time (trim window at its speed).
 * `assetDuration` 0 → treat trim window as the (unknown) natural length.
 */
export function clipOutDuration(clip: VideoClip, assetDuration: number): number {
  const edit = clip.edit
  const end = edit.trimEnd ?? Math.max(0, assetDuration)
  const src = Math.max(0, end - edit.trimStart)
  const speed = edit.speed > 0 ? edit.speed : 1
  return Math.max(MIN_CLIP_OUT, src / speed)
}

/**
 * Why the layout is needed by both the timeline and the stage.
 * Overlap transitions (dissolve, slides, wipes, circle, zoom, blur) share the
 * tail/head of both clips, so the total shrinks by that overlap; colour dips
 * run back-to-back (no overlap, no shrink).
 */
export interface LayoutEntry {
  clip: VideoClip
  /** Global (sequence) time of the clip's first output second. */
  globalStart: number
  out: number
  /** Effective overlap with the NEXT clip (0 when none). */
  overlapAfter: number
}

export interface SequenceLayout {
  entries: LayoutEntry[]
  total: number
}

export function layoutSequence(clips: readonly VideoClip[], durationOf: DurationLookup): SequenceLayout {
  const rawOuts = clips.map((clip) => clipOutDuration(clip, durationOf(clip.assetId)))
  const entries: LayoutEntry[] = []
  let cursor = 0
  for (let i = 0; i < clips.length; i++) {
    const out = rawOuts[i]
    // Transitions are carried by the LATER clip ("transition in"), so the
    // overlap that follows clip i is requested by clips[i+1].
    const next = clips[i + 1]
    let overlapAfter = 0
    if (next !== undefined && isOverlapTransition(next.transition)) {
      overlapAfter = Math.min(next.transitionDuration, out / 2, rawOuts[i + 1] / 2)
    }
    entries.push({ clip: clips[i], globalStart: cursor, out, overlapAfter })
    cursor += Math.max(MIN_CLIP_OUT, out - overlapAfter)
  }
  return { entries, total: cursor }
}

/** Where a global time lands in the layout. */
export interface LocatedTime {
  /** Index of the clip owning the playhead (the later clip inside an overlap). */
  index: number
  /** Output seconds into that clip. */
  localOut: number
  /** When inside a transition overlap: index of the partner clip, else null. */
  overlapWith: number | null
  /** Output seconds into the partner clip (0 when overlapWith is null). */
  overlapLocalOut: number
}

export function locateTime(layout: SequenceLayout, t: number): LocatedTime {
  const entries = layout.entries
  if (entries.length === 0) return { index: -1, localOut: 0, overlapWith: null, overlapLocalOut: 0 }
  const time = Math.max(0, Math.min(layout.total, t))
  // The later clip inside an overlap owns the playhead (top of the stack).
  let index = entries.length - 1
  for (let i = 0; i < entries.length; i++) {
    if (time < entries[i].globalStart + entries[i].out) {
      index = i
      break
    }
  }
  const entry = entries[index]
  const localOut = Math.max(0, Math.min(entry.out, time - entry.globalStart))
  // Overlap with the NEXT clip?
  if (index < entries.length - 1 && entry.overlapAfter > 0) {
    const next = entries[index + 1]
    if (time >= next.globalStart) {
      return {
        index,
        localOut,
        overlapWith: index + 1,
        overlapLocalOut: Math.max(0, Math.min(next.out, time - next.globalStart)),
      }
    }
  }
  return { index, localOut, overlapWith: null, overlapLocalOut: 0 }
}

/**
 * Splits the clip at `index` exactly `localOut` seconds (output time) into
 * it. Returns a NEW clips array with both halves (same ids, half A keeps the
 * in-transition and the title, half B inherits grade/speed/trim tail), or
 * null when the split would create a degenerate piece.
 */
export function splitClipAt(clips: readonly VideoClip[], index: number, localOut: number): VideoClip[] | null {
  const clip = clips[index]
  if (!clip) return null
  const edit = clip.edit
  const srcLen = edit.trimEnd ?? Infinity
  const localSrcEnd = Number.isFinite(srcLen) ? srcLen : edit.trimStart + localOut * edit.speed + 1
  const cutSrc = edit.trimStart + Math.max(0, localOut) * edit.speed
  const minSpan = MIN_TRIM_SPAN
  if (cutSrc < edit.trimStart + minSpan || cutSrc > edit.trimStart + (localSrcEnd - edit.trimStart) - minSpan) {
    return null
  }
  const before: VideoClip = { ...clip, edit: { ...edit, trimStart: edit.trimStart, trimEnd: cutSrc } }
  const after: VideoClip = {
    ...clip,
    id: `${clip.id}-b${Math.floor(Math.random() * 1e6).toString(36)}`,
    edit: { ...edit, trimStart: cutSrc, trimEnd: Number.isFinite(srcLen) ? srcLen : null },
    title: null,
  }
  // Keyframed camera moves are trim-relative; keep them on half A only.
  delete after.keyframes
  const next = [...clips]
  next.splice(index, 1, before, after)
  return next
}

export function sanitizeTitle(raw: unknown): VideoTitle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const text = typeof rec.text === 'string' ? rec.text.slice(0, 140) : ''
  if (!text.trim()) return null
  const show = typeof rec.show === 'number' && Number.isFinite(rec.show) ? Math.max(0.2, Math.min(60, rec.show)) : 3
  return { text, position: rec.position === 'center' ? 'center' : 'lower', show }
}

function sanitizeMusic(raw: unknown, hasAsset: (id: string) => boolean): MusicTrack | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const assetId = typeof rec.assetId === 'string' ? rec.assetId : ''
  if (!assetId || !hasAsset(assetId)) return null
  const volume = typeof rec.volume === 'number' && Number.isFinite(rec.volume) ? Math.max(0, Math.min(100, rec.volume)) : 40
  // Beats survive storage only as a sane, bounded, sorted grid.
  let beats: number[] | undefined
  if (Array.isArray(rec.beats)) {
    const cleaned = [...rec.beats]
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0)
      .sort((a, b) => a - b)
      .slice(0, 2000)
    beats = cleaned.length > 0 ? cleaned : undefined
  }
  const bpm = typeof rec.bpm === 'number' && Number.isFinite(rec.bpm) && rec.bpm > 0 ? Math.min(300, rec.bpm) : undefined
  return {
    assetId,
    volume,
    ...(beats ? { beats } : {}),
    ...(bpm ? { bpm } : {}),
    ...(rec.duck === false ? { duck: false } : {}),
  }
}

/**
 * Beat-sync: retrims clip boundaries so every cut lands on the nearest beat.
 * Pure — returns a new clips array, or null when nothing could move.
 */
export function syncCutsToBeats(
  clips: readonly VideoClip[],
  durations: Record<string, number>,
  beats: readonly number[],
): VideoClip[] | null {
  if (clips.length < 2 || beats.length === 0) return null
  const next = clips.map((c) => c)
  let changed = false
  for (let k = 1; k < next.length; k++) {
    const layout = layoutSequence(next, (id) => durations[id] ?? 0)
    const entry = layout.entries[k]
    if (!entry) break
    const boundary = entry.globalStart
    // Try beats nearest-first; the first FEASIBLE snap wins (an open-ended
    // clip can only shrink, so the closest beat may be impossible).
    const candidates = beats
      .map((b) => ({ beat: b, dist: Math.abs(b - boundary) }))
      .filter((c) => c.dist < MAX_SNAP_OFFSET && c.dist >= 0.02)
      .sort((a, b) => a.dist - b.dist)
    for (const candidate of candidates) {
      const delta = candidate.beat - boundary
      const previous = next[k - 1]
      // Preferred: shift the earlier clip's trim end (moves the boundary by
      // extending/shortening its source window at its speed).
      const previousDur = durations[previous.assetId] ?? 0
      const previousEnd = previous.edit.trimEnd ?? previousDur
      const newPreviousEnd = previousEnd + delta * previous.edit.speed
      const canShiftPrevious =
        newPreviousEnd > previous.edit.trimStart + MIN_TRIM_SPAN &&
        (previous.edit.trimEnd !== null
          ? newPreviousEnd <= previousDur + 0.001
          : delta < 0) // an open end can only shrink
      if (canShiftPrevious) {
        next[k - 1] = {
          ...previous,
          edit: { ...previous.edit, trimEnd: Math.max(previous.edit.trimStart + MIN_TRIM_SPAN, newPreviousEnd) },
        }
        changed = true
        break
      }
      // Fallback: widen the earlier clip's source window by moving its trim
      // start earlier (only possible when the boundary must move later).
      if (delta > 0 && previous.edit.trimStart > 0) {
        const newStart = Math.max(0, previous.edit.trimStart - delta * previous.edit.speed)
        if (previousEnd - newStart > MIN_TRIM_SPAN) {
          next[k - 1] = { ...previous, edit: { ...previous.edit, trimStart: newStart } }
          changed = true
          break
        }
      }
    }
  }
  return changed ? next : null
}

/** Repairs one overlay from storage (or returns null for garbage). */
export function sanitizeOverlayClip(raw: unknown, hasAsset: (id: string) => boolean): OverlayClip | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  const kind = rec.kind === 'text' || rec.kind === 'image' || rec.kind === 'video' ? rec.kind : null
  if (!kind) return null
  const assetId = typeof rec.assetId === 'string' ? rec.assetId : undefined
  if (kind !== 'text' && (!assetId || !hasAsset(assetId))) return null
  const text = typeof rec.text === 'string' ? rec.text.slice(0, 140) : undefined
  if (kind === 'text' && (!text || !text.trim())) return null
  const baseRaw = typeof rec.base === 'object' && rec.base !== null ? (rec.base as Record<string, unknown>) : {}
  const num = (v: unknown, def: number, prop: keyof AnimBase): number =>
    typeof v === 'number' && Number.isFinite(v) ? clampAnimValue(prop, v) : def
  return {
    id: typeof rec.id === 'string' && rec.id ? rec.id : `ov_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    ...(kind !== 'text' ? { assetId } : { text }),
    start: typeof rec.start === 'number' && Number.isFinite(rec.start) ? Math.max(0, rec.start) : 0,
    duration: Math.max(MIN_OVERLAY_OUT, typeof rec.duration === 'number' && Number.isFinite(rec.duration) ? rec.duration : 3),
    base: {
      scale: num(baseRaw.scale, ANIM_DEFAULTS.scale, 'scale'),
      x: num(baseRaw.x, ANIM_DEFAULTS.x, 'x'),
      y: num(baseRaw.y, ANIM_DEFAULTS.y, 'y'),
      opacity: num(baseRaw.opacity, ANIM_DEFAULTS.opacity, 'opacity'),
    },
    keyframes: sanitizeKeyframes(rec.keyframes),
    animIn: sanitizeOverlayAnim(rec.animIn),
    animOut: sanitizeOverlayAnim(rec.animOut),
    ...(rec.muted === true ? { muted: true } : {}),
    ...(rec.caption === true ? { caption: true } : {}),
  }
}

/** Overlays active at global time `t`, bottom→top (array order kept). */
export function overlaysAt(overlays: readonly OverlayClip[], t: number): OverlayClip[] {
  return overlays.filter((o) => t >= o.start && t < o.start + o.duration)
}

/** Visual state produced by intro/outro presets for one overlay frame. */
export interface OverlayVisual {
  /** Multiplies the layer's own opacity. */
  alpha: number
  /** Multiplies the layer's scale. */
  scale: number
  /** Pixel offsets from the layer's base position. */
  dx: number
  dy: number
  /** Rotation in radians around the layer's center (0 = none). */
  rot: number
  /** 0..1 text reveal (typewriter); 1 = fully shown. */
  reveal: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

function easeOutBack(p: number): number {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}

/** Standard bounce-out easing (1 at p=1, wobbles below 1 before that). */
function easeOutBounce(p: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (p < 1 / d1) return n1 * p * p
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375
  return n1 * (p -= 2.625 / d1) * p + 0.984375
}

/** Preset length in seconds — typewriter gets longer for long lines. */
function presetSeconds(preset: OverlayAnimPreset, duration: number): number {
  const base = preset === 'typewriter' ? 1.1 : preset === 'bounce' ? 0.7 : 0.5
  return Math.max(0.08, Math.min(base, duration * 0.45))
}

/** Applies one preset at progress `p` (1 = fully arrived / still present). */
function applyPreset(
  vis: OverlayVisual,
  preset: OverlayAnimPreset,
  p: number,
  w: number,
  h: number,
  entering: boolean,
): void {
  const eased = easeOutCubic(p)
  switch (preset) {
    case 'none':
      return
    case 'fade':
      vis.alpha *= p
      return
    case 'pop':
      vis.alpha *= Math.min(1, p * 2.5)
      vis.scale *= 0.4 + 0.6 * easeOutBack(p)
      return
    case 'zoom':
      vis.alpha *= Math.min(1, p * 2)
      vis.scale *= 0.7 + 0.3 * eased
      return
    case 'slideUp':
      vis.alpha *= Math.min(1, p * 1.8)
      vis.dy += (entering ? 1 : -1) * (1 - eased) * h * 0.18
      return
    case 'slideDown':
      vis.alpha *= Math.min(1, p * 1.8)
      vis.dy -= (entering ? 1 : -1) * (1 - eased) * h * 0.18
      return
    case 'slideLeft':
      vis.alpha *= Math.min(1, p * 1.8)
      vis.dx += (entering ? 1 : -1) * (1 - eased) * w * 0.2
      return
    case 'slideRight':
      vis.alpha *= Math.min(1, p * 1.8)
      vis.dx -= (entering ? 1 : -1) * (1 - eased) * w * 0.2
      return
    case 'typewriter':
      vis.reveal *= p
      return
    case 'drop': {
      // Falls from above and settles with a bounce.
      vis.alpha *= Math.min(1, p * 3)
      vis.dy += (entering ? 1 : -1) * (1 - easeOutBounce(p)) * h * 0.35
      return
    }
    case 'bounce': {
      // Squash-and-stretch scale-in with a landing bounce.
      vis.alpha *= Math.min(1, p * 2.5)
      vis.scale *= 0.55 + 0.45 * easeOutBounce(p)
      return
    }
    case 'swing': {
      // Rocking entrance that decays to level.
      vis.alpha *= Math.min(1, p * 2.5)
      vis.rot += (entering ? 1 : -1) * (1 - p) * Math.sin(p * Math.PI * 3) * 0.3
      return
    }
  }
}

/**
 * Resolves an overlay's intro/outro motion at global sequence time `t`.
 * Pure: the preview, export and tests all share this exact math.
 */
export function overlayVisual(o: OverlayClip, t: number, w: number, h: number): OverlayVisual {
  const vis: OverlayVisual = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, reveal: 1 }
  const local = t - o.start
  const duration = Math.max(0.05, o.duration)

  if (o.animIn && o.animIn !== 'none') {
    applyPreset(vis, o.animIn, clamp01(local / presetSeconds(o.animIn, duration)), w, h, true)
  }
  if (o.animOut && o.animOut !== 'none') {
    applyPreset(vis, o.animOut, clamp01((duration - local) / presetSeconds(o.animOut, duration)), w, h, false)
  }
  return vis
}

/** Repairs a sequence read from storage. Clips referencing unknown assets are dropped. */
export function sanitizeSequence(raw: unknown, durationOf: DurationLookup, hasAsset: (id: string) => boolean): VideoSequence {
  const empty: VideoSequence = { clips: [], overlays: [], music: null, canvas: defaultCanvasSettings() }
  if (typeof raw !== 'object' || raw === null) return empty
  const rec = raw as Record<string, unknown>
  const list = Array.isArray(rec.clips) ? rec.clips : []
  const clips: VideoClip[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    const assetId = typeof c.assetId === 'string' ? c.assetId : ''
    if (!assetId || !hasAsset(assetId)) continue
    const duration = durationOf(assetId)
    const keyframes = sanitizeKeyframes(c.keyframes)
    clips.push({
      id: typeof c.id === 'string' && c.id ? c.id : `clip_${Math.random().toString(36).slice(2, 10)}`,
      assetId,
      edit: sanitizeVideoEdit(c.edit, duration),
      transition: transitionOf(c.transition),
      transitionDuration:
        typeof c.transitionDuration === 'number' && Number.isFinite(c.transitionDuration)
          ? Math.max(0, Math.min(MAX_TRANSITION, c.transitionDuration))
          : DEFAULT_TRANSITION,
      title: sanitizeTitle(c.title),
      keyframes,
    })
  }
  // An emptied legacy sequence re-migrates on the next load; an emptied
  // user-edited one stays empty.
  const fromLegacy = clips.length === 0 && rec.fromLegacy === true
  const overlays = (Array.isArray(rec.overlays) ? rec.overlays : [])
    .map((o) => sanitizeOverlayClip(o, hasAsset))
    .filter((o): o is OverlayClip => o !== null)
  return {
    clips,
    overlays,
    music: sanitizeMusic(rec.music, hasAsset),
    canvas: sanitizeCanvas(rec.canvas),
    ...(fromLegacy ? { fromLegacy: true } : {}),
  }
}

/** Builds the sequence from the legacy per-asset model (one clip per asset). */
export function migrateLegacySequence(
  videoAssets: readonly string[],
  videoEdits: Record<string, unknown>,
  durationOf: DurationLookup,
  hasAsset: (id: string) => boolean,
): VideoSequence {
  const clips = videoAssets
    .filter((assetId0) => hasAsset(assetId0))
    .map((assetId, index) => ({
      // Unique even when one asset appears multiple times:
      id: index === 0 ? `clip_${assetId}` : `clip_${assetId}_${index}`,
      assetId,
      edit: sanitizeVideoEdit(videoEdits[assetId], durationOf(assetId)),
      transition: 'cut' as const,
      transitionDuration: DEFAULT_TRANSITION,
      title: null,
    }))
  return { clips, overlays: [], music: null, canvas: defaultCanvasSettings(), fromLegacy: true }
}

/**
 * Local anim state of a base clip at `localOut` seconds into it: keyframed
 * (trim-relative) zoom/pan values, clamped into range. No keyframes → base.
 */
export function baseAnimAt(clip: VideoClip, localOut: number): AnimBase {
  return animAt(clip.keyframes, localOut, ANIM_DEFAULTS)
}

/**
 * Output time → source time inside one clip, honoring constant speed AND the
 * ramp curve. The ramp shape integrates to exactly 1, so this is consistent
 * with `clipOutDuration` (durations don't shift when ramps toggle).
 */
export function clipSrcAt(clip: VideoClip, localOut: number, assetDuration: number): number {
  const edit = clip.edit
  const end = edit.trimEnd ?? Math.max(0, assetDuration)
  const span = Math.max(0, end - edit.trimStart)
  const out = clipOutDuration(clip, assetDuration)
  const u = Math.max(0, Math.min(1, localOut / Math.max(0.0001, out)))
  const fraction = srcFractionAt(edit.speedCurve, u)
  return edit.trimStart + fraction * span
}
