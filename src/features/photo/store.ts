import { create } from 'zustand'
import { useProjectsStore } from '../projects/store'
import { PRESETS, mixValues } from '../../core/adjustments/presets'
import {
  createDefaultEditDoc,
  sanitizeEditDoc,
  withAdjustment,
  withAdjustments,
  withCopiedGrade,
  withCurves,
  withGeometry,
  withHsl,
  withMask,
  withTextOverlays,
  TEXT_OVERLAY_DEFAULTS,
  type EditDoc,
  type CropRect,
  type GeometryValues,
  type Mask,
  type PhotoTextOverlay,
} from '../../core/adjustments/edits'
import { defaultHslMixer, defaultToneCurve, type HslBand, type HslChannel, type ToneCurve } from '../../core/adjustments/color'
import { ADJUSTMENTS_BY_KEY, type AdjustKey, type AdjustValues } from '../../core/adjustments/registry'
import { EditHistory } from './history'
import { toast } from '../../ui/toastStore'
import type { Histogram } from '../../core/render/histogram'

/**
 * Photo editor store: the funnel for every edit. Reads/writes EditDocs inside
 * the active ProjectDoc (autosave handled there), and keeps gesture state +
 * the global EditHistory. Pure storage logic stays in core/adjustments.
 */

interface CropSession {
  draft: CropRect
  /** Aspect ratio (w/h); null = free. */
  aspect: number | null
}

interface PhotoEditorState {
  /** Mirrors the active photo's doc for renderers. */
  doc: EditDoc | null
  bypass: boolean
  crop: CropSession | null
  history: EditHistory
  /** Gesture capture: doc before the in-flight change (no history spam). */
  pendingBefore: EditDoc | null
  /** Historically queried by panels for undo/redo availability. */
  revision: number
  /** Latest throttled preview histogram; rendered by the inspector. */
  histogram: Histogram | null

  setActivePhoto: (photoId: string | null) => void
  setHistogram: (h: Histogram | null) => void
  /** Slider dragging: live value, no history entry yet. */
  setAdjustment: (key: AdjustKey, value: number) => void
  setStraightenLive: (value: number) => void
  setGeometryRel: (quarterDelta: number, flipH?: boolean, flipV?: boolean) => void
  /** Ends a gesture: one history entry for the whole drag. */
  commit: (label: string) => void
  setGeometry: (patch: Partial<GeometryValues>, label: string) => void
  resetEdits: () => void
  undo: () => void
  redo: () => void
  jumpTo: (entryId: string) => void
  setBypass: (v: boolean) => void
  startCrop: (aspect?: number | null) => void
  cancelCrop: () => void
  setCropDraft: (rect: CropRect) => void
  setCropAspect: (aspect: number | null) => void
  applyCrop: () => void
  /** One-click looks & Auto: apply a whole adjustment set as one entry. */
  applyAdjustments: (values: Partial<AdjustValues>, label: string, lookId?: string) => void
  /** Dials the active look's strength (0..1). */
  setLookStrength: (strength: number) => void
  /** Live tone-curve knot / parametric drag. */
  setCurveLive: (patch: Partial<ToneCurve>) => void
  /** Live HSL band drag. */
  setHslLive: (channel: HslChannel, patch: Partial<HslBand>) => void
  /** Live mask control drag (history entry on the following commit). */
  setMask: (patch: Partial<Mask>) => void
  /** Adds a text layer at the default spot (one history entry). */
  addTextOverlay: (text: string) => void
  /** Live overlay drag (position/scale/…) — commit records the gesture. */
  setOverlayLive: (id: string, patch: Partial<PhotoTextOverlay>) => void
  /** Removes one text overlay (one history entry). */
  removeTextOverlay: (id: string) => void
  /** Copy this photo's grade (not crop) onto every other photo in the project. */
  applyGradeToAll: () => number
}

const MAX_STRAIGHTEN = 45

function clampStraighten(v: number): number {
  return Math.min(MAX_STRAIGHTEN, Math.max(-MAX_STRAIGHTEN, v))
}

/** Reads the doc for a photo from the project doc (repairs old data).
 *  Imperative (store-level, not a hook): zustand state is read via getState. */
export function docForProject(photoId: string | null): EditDoc | null {
  if (!photoId) return null
  const s = useProjectsStore.getState()
  const project = s.projects.find((p) => p.id === s.currentId) ?? null
  if (!project) return null
  const stored = project.photoEdits[photoId]
  return stored ? sanitizeEditDoc(stored) : createDefaultEditDoc()
}

function writeDocToProject(photoId: string, doc: EditDoc): void {
  useProjectsStore.getState().updateCurrent((p) => ({
    ...p,
    photoEdits: { ...p.photoEdits, [photoId]: doc },
  }))
}

export const usePhotoEditor = create<PhotoEditorState>()((set, get) => ({
  doc: null,
  bypass: false,
  crop: null,
  history: new EditHistory(),
  pendingBefore: null,
  revision: 0,
  histogram: null,

  setActivePhoto: (photoId) => {
    set({ doc: docForProject(photoId), bypass: false, crop: null, pendingBefore: null, histogram: null })
  },

  setHistogram: (h) => set({ histogram: h }),

  setAdjustment: (key, value) => {
    const doc = get().doc
    if (!doc) return
    const param = ADJUSTMENTS_BY_KEY[key]
    const clamped = Math.min(param.max, Math.max(param.min, Math.round(value)))
    // Accumulate onto the gesture base so the final doc = base + last value.
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const next = withAdjustment(current, key, clamped)
    set({ doc: { ...next, look: null } })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, { ...next, look: null })
  },

  commit: (label) => {
    const { pendingBefore, doc } = get()
    if (!doc || !pendingBefore) return
    const photoId = currentPhotoId()
    if (photoId) get().history.record(photoId, label, pendingBefore, doc)
    set({ pendingBefore: null, revision: get().revision + 1 })
  },

  setGeometry: (patch, label) => {
    const doc = get().doc
    if (!doc) return
    const photoId = currentPhotoId()
    if (!photoId) return
    let next = withGeometry(doc, patch)
    if (patch.straighten !== undefined) {
      next = withGeometry(next, { straighten: clampStraighten(patch.straighten) })
    }
    get().history.record(photoId, label, doc, next)
    writeDocToProject(photoId, next)
    set({ doc: next, revision: get().revision + 1 })
  },

  /** 90° rotations and flips: one-shot commits. */
  setGeometryRel: (quarterDelta, flipH, flipV) => {
    const doc = get().doc
    if (!doc) return
    const patch: Partial<GeometryValues> = {}
    if (quarterDelta !== 0) {
      patch.rotateQuarter = (((doc.geometry.rotateQuarter + quarterDelta) % 4) + 4) % 4 as 0 | 1 | 2 | 3
    }
    if (flipH === true) patch.flipH = !doc.geometry.flipH
    if (flipV === true) patch.flipV = !doc.geometry.flipV
    if (Object.keys(patch).length === 0) return
    const label =
      quarterDelta === -1 ? 'Rotate left' : quarterDelta === 1 ? 'Rotate right' : flipH ? 'Flip horizontal' : 'Flip vertical'
    get().setGeometry(patch, label)
  },

  /** Straighten slider live drag — mirrors setAdjustment for geometry. */
  setStraightenLive: (value) => {
    const doc = get().doc
    if (!doc) return
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const next = withGeometry(current, { straighten: clampStraighten(Math.round(value)) })
    set({ doc: next })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, next)
  },

  resetEdits: () => {
    const doc = get().doc
    const photoId = currentPhotoId()
    if (!doc || !photoId) return
    const blank = createDefaultEditDoc()
    get().history.record(photoId, 'Reset all edits', doc, blank)
    writeDocToProject(photoId, blank)
    set({ doc: blank, revision: get().revision + 1 })
    toast('Edits reset', 'The photo is back to its original state', 'success')
  },

  setCurveLive: (patch) => {
    const doc = get().doc
    if (!doc) return
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const base = current.curves ?? defaultToneCurve()
    const next = withCurves(current, {
      ...base,
      ...patch,
      master: patch.master ?? base.master,
    })
    set({ doc: next })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, next)
  },

  setHslLive: (channel, patch) => {
    const doc = get().doc
    if (!doc) return
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const mixer = current.hsl ?? defaultHslMixer()
    const next = withHsl(current, {
      ...mixer,
      [channel]: { ...mixer[channel], ...patch },
    })
    set({ doc: next })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, next)
  },

  setMask: (patch) => {
    const doc = get().doc
    if (!doc) return
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const next = withMask(current, patch)
    set({ doc: next })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, next)
  },

  addTextOverlay: (text) => {
    const doc = get().doc
    const photoId = currentPhotoId()
    if (!doc || !photoId) return
    const overlay: PhotoTextOverlay = {
      id: `pov_${Math.random().toString(36).slice(2, 10)}`,
      text: text.slice(0, 140),
      ...TEXT_OVERLAY_DEFAULTS,
    }
    const next = withTextOverlays(doc, [...(doc.textOverlays ?? []), overlay])
    get().history.record(photoId, 'Add text', doc, next)
    writeDocToProject(photoId, next)
    set({ doc: next, revision: get().revision + 1 })
  },

  setOverlayLive: (id, patch) => {
    const doc = get().doc
    if (!doc) return
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const list = current.textOverlays ?? []
    const next = withTextOverlays(
      current,
      list.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    )
    set({ doc: next })
    const photoId = currentPhotoId()
    if (photoId) writeDocToProject(photoId, next)
  },

  removeTextOverlay: (id) => {
    const doc = get().doc
    const photoId = currentPhotoId()
    if (!doc || !photoId) return
    const list = doc.textOverlays ?? []
    if (!list.some((o) => o.id === id)) return
    const next = withTextOverlays(doc, list.filter((o) => o.id !== id))
    get().history.record(photoId, 'Remove text', doc, next)
    writeDocToProject(photoId, next)
    set({ doc: next, revision: get().revision + 1 })
  },

  applyGradeToAll: () => {
    const doc = get().doc
    const s = useProjectsStore.getState()
    const project = s.projects.find((p) => p.id === s.currentId) ?? null
    if (!doc || !project) return 0
    const ids = project.photoAssets.filter((id) => id !== project.activePhotoId)
    if (ids.length === 0) return 0
    s.updateCurrent((p) => {
      const photoEdits = { ...p.photoEdits }
      for (const id of ids) {
        const existing = photoEdits[id] ? sanitizeEditDoc(photoEdits[id]) : createDefaultEditDoc()
        photoEdits[id] = withCopiedGrade(existing, doc)
      }
      return { ...p, photoEdits }
    })
    toast('Grade applied', `Copied this look to ${ids.length} other photo${ids.length === 1 ? '' : 's'}`, 'success')
    return ids.length
  },

  /** One-click looks & Auto: apply a whole adjustment set as one entry. */
  applyAdjustments: (values, label, lookId) => {
    const doc = get().doc
    const photoId = currentPhotoId()
    if (!doc || !photoId) return
    const next = { ...withAdjustments(doc, values), look: lookId ? { id: lookId, strength: 1 } : null }
    get().history.record(photoId, label, doc, next)
    writeDocToProject(photoId, next)
    set({ doc: next, revision: get().revision + 1 })
  },

  /** Dials the active look's strength; recomputes adjustments from the preset. */
  setLookStrength: (strength) => {
    const doc = get().doc
    const photoId = currentPhotoId()
    if (!doc || !photoId || !doc.look) return
    const preset = PRESETS.find((p) => p.id === doc.look?.id)
    if (!preset) return
    const clamped = Math.min(1, Math.max(0, strength))
    // Gesture pattern: first live call remembers the base for one history entry.
    const current = get().pendingBefore ?? doc
    if (!get().pendingBefore) set({ pendingBefore: doc })
    const next = {
      ...withAdjustments(current, mixValues(preset, clamped)),
      look: { id: doc.look.id, strength: clamped },
    }
    set({ doc: next })
    writeDocToProject(photoId, next)
  },

  undo: () => {
    const entry = get().history.undo()
    if (!entry) return
    writeDocToProject(entry.photoId, entry.before)
    if (entry.photoId === currentPhotoId()) {
      set({ doc: entry.before, crop: null, bypass: false, revision: get().revision + 1 })
    } else {
      set({ revision: get().revision + 1 })
    }
  },

  redo: () => {
    const entry = get().history.redo()
    if (!entry) return
    writeDocToProject(entry.photoId, entry.after)
    if (entry.photoId === currentPhotoId()) {
      set({ doc: entry.after, crop: null, bypass: false, revision: get().revision + 1 })
    } else {
      set({ revision: get().revision + 1 })
    }
  },

  jumpTo: (entryId) => {
    const entry = get().history.jumpTo(entryId)
    if (!entry) return
    writeDocToProject(entry.photoId, entry.after)
    if (entry.photoId === currentPhotoId()) set({ doc: entry.after, crop: null, bypass: false })
    set({ revision: get().revision + 1 })
  },

  setBypass: (v) => set({ bypass: v }),

  startCrop: (aspect) => {
    const doc = get().doc
    if (!doc) return
    set({ crop: { draft: { ...doc.geometry.crop }, aspect: aspect ?? null } })
  },

  cancelCrop: () => set({ crop: null }),

  setCropDraft: (rect) => {
    const crop = get().crop
    if (!crop) return
    const clamped: CropRect = {
      x: Math.max(0, Math.min(1, rect.x)),
      y: Math.max(0, Math.min(1, rect.y)),
      w: Math.max(0.02, Math.min(1, rect.w)),
      h: Math.max(0.02, Math.min(1, rect.h)),
    }
    if (clamped.x + clamped.w > 1) clamped.w = 1 - clamped.x
    if (clamped.y + clamped.h > 1) clamped.h = 1 - clamped.y
    set({ crop: { ...crop, draft: clamped } })
  },

  setCropAspect: (aspect) => {
    const crop = get().crop
    if (!crop) return
    if (aspect === null) {
      set({ crop: { ...crop, aspect: null } })
      return
    }
    // Fit the aspect into the bounds, anchored at the top-left of the draft.
    let w = crop.draft.w
    let h = w / aspect
    if (h > 1 - crop.draft.y) {
      h = 1 - crop.draft.y
      w = h * aspect
    }
    if (w > 1 - crop.draft.x) {
      w = 1 - crop.draft.x
      h = w / aspect
      if (h > 1 - crop.draft.y) {
        h = 1 - crop.draft.y
        w = h * aspect
      }
    }
    set({ crop: { aspect, draft: { ...crop.draft, w, h } } })
  },

  applyCrop: () => {
    const { crop, doc } = get()
    if (!crop || !doc) return
    const photoId = currentPhotoId()
    if (!photoId) return
    const next = withGeometry(doc, { crop: { ...crop.draft } })
    get().history.record(photoId, 'Crop', doc, next)
    writeDocToProject(photoId, next)
    set({ doc: next, crop: null, revision: get().revision + 1 })
  },
}))

/** The active photo id comes from the project doc. */
function currentPhotoId(): string | null {
  const project = useProjectsStore.getState().projects.find(
    (p) => p.id === useProjectsStore.getState().currentId,
  )
  return project?.activePhotoId ?? null
}
