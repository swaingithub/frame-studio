import {
  withAudioFades,
  withBgRemove,
  withChromaKey,
  withMask,
  withSpeed,
  withSpeedCurve,
  withTrim,
  withVideoAdjustment,
  withVideoAdjustments,
  withVolume,
  type VideoEditDoc,
} from '../model'
import { filmicCurve, mixValues, PRESETS } from '../../../core/adjustments/presets'
import type { VideoActions } from '../store'
import { persist, recordHistory, snap, writeDoc, type EditorGet, type EditorSet } from '../storeHelpers'

/**
 * Grading/editing of the selected clip's edit doc: adjustments (light/color/
 * effects), look strength, speed + speed ramp, trim, chroma key, mask,
 * background removal, muted, audio fades, canvas settings. Live drag states
 * use a `pending*Before` snapshot and `commit` lands one history entry.
 */
export function gradeActions(
  set: EditorSet,
  get: EditorGet,
): Pick<
  VideoActions,
  | 'setAdjustment'
  | 'applyAdjustments'
  | 'setLookStrength'
  | 'setChromaKey'
  | 'setMask'
  | 'setBgRemove'
  | 'commit'
  | 'setTrimLive'
  | 'commitTrim'
  | 'setVolume'
  | 'commitVolume'
  | 'setAudioFades'
  | 'commitAudioFades'
  | 'setMuted'
  | 'setSpeedLive'
  | 'commitSpeed'
  | 'setRamp'
  | 'setCanvasLive'
  | 'commitCanvas'
> {
  return {
    setAdjustment: (key, value) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      // Manual tweaks detach the active one-click look (and its curve).
      writeDoc(get, set, { ...withVideoAdjustment(base, key, value), look: null, ...(base.look ? { curves: null } : {}) })
    },

    setChromaKey: (patch) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      writeDoc(get, set, withChromaKey(base, patch))
    },

    setMask: (patch) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      writeDoc(get, set, withMask(base, patch))
    },

    setBgRemove: (enabled) => {
      const doc = get().doc
      const clipId = get().activeClipId
      if (!doc || !clipId) return
      if (doc.bgRemove === enabled) return
      const before = snap(get)
      const next = withBgRemove(doc, enabled)
      const afterClips = get().sequence.map((c) => (c.id === clipId ? { ...c, edit: next } : c))
      recordHistory(get, enabled ? 'Remove background' : 'Restore background', before, snap(get, { clips: afterClips }))
      writeDoc(get, set, next)
      set({ revision: get().revision + 1 })
    },

    applyAdjustments: (values, label, lookId) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap(get)
      const next = {
        ...withVideoAdjustments(doc, values),
        look: lookId ? { id: lookId, strength: 1 } : null,
        curves: lookId ? filmicCurve(1) : null,
      }
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory(get, label, before, snap(get, { clips: afterClips }))
      writeDoc(get, set, next)
      set({ revision: get().revision + 1 })
    },

    /** Dials the active look's strength; recomputes adjustments from the preset. */
    setLookStrength: (strength) => {
      const doc = get().doc
      if (!doc || !doc.look || !get().activeClipId) return
      const preset = PRESETS.find((p) => p.id === doc.look?.id)
      if (!preset) return
      const clamped = Math.min(1, Math.max(0, strength))
      const current = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      const next = {
        ...withVideoAdjustments(current, mixValues(preset, clamped)),
        look: { id: doc.look.id, strength: clamped },
        curves: filmicCurve(clamped),
      }
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      writeDoc(get, set, next)
      set({ sequence: afterClips, doc: next, revision: get().revision + 1 })
    },

    commit: (label) => {
      const { pendingBefore, doc } = get()
      if (!doc || !pendingBefore || !get().activeClipId) return
      if (JSON.stringify(pendingBefore) !== JSON.stringify(doc)) {
        const afterClips = get().sequence // doc is already merged into sequence
        const beforeClips = afterClips.map((c) => (c.id === get().activeClipId ? { ...c, edit: pendingBefore } : c))
        recordHistory(get, label, snap(get, { clips: beforeClips }), snap(get))
      }
      set({ pendingBefore: null, revision: get().revision + 1 })
    },

    setTrimLive: (start, end) => {
      const doc = get().doc
      if (!doc) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      const duration = get().durations[get().clip?.assetId ?? ''] ?? 0
      writeDoc(get, set, withTrim(base, start, end, duration))
    },

    commitTrim: () => {
      get().commit('Trim')
    },

    setVolume: (v) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(get, set, withVolume(base, v))
    },

    commitVolume: () => {
      get().commit('Volume')
    },

    setAudioFades: (fadeIn, fadeOut) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(get, set, withAudioFades(base, fadeIn, fadeOut))
    },

    commitAudioFades: () => {
      get().commit('Audio fade')
    },

    setMuted: (v) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap(get)
      const next: VideoEditDoc = { ...doc, muted: v }
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory(get, v ? 'Mute' : 'Unmute', before, snap(get, { clips: afterClips }))
      writeDoc(get, set, next)
      set({ revision: get().revision + 1 })
    },

    setSpeedLive: (v) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(get, set, withSpeed(base, v))
    },

    commitSpeed: () => {
      get().commit('Speed')
    },

    setRamp: (curve) => {
      const doc = get().doc
      if (!doc || !get().activeClipId || doc.speedCurve === curve) return
      const next = withSpeedCurve(doc, curve)
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory(get, 'Speed ramp', snap(get), snap(get, { clips: afterClips }))
      writeDoc(get, set, next)
      set({ revision: get().revision + 1 })
    },

    setCanvasLive: (patch) => {
      const current = get().canvas
      if (!get().pendingCanvasBefore) set({ pendingCanvasBefore: current })
      const next = { ...current, ...patch }
      set({ canvas: next, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, get().overlays, next)
    },

    commitCanvas: (label) => {
      const before = get().pendingCanvasBefore
      const after = get().canvas
      set({ pendingCanvasBefore: null })
      if (!before || JSON.stringify(before) === JSON.stringify(after)) return
      recordHistory(get, label ?? 'Canvas', snap(get, { canvas: before }), snap(get, { canvas: after }))
    },
  }
}
