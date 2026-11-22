import { ANIM_DEFAULTS, animAt, type AnimBase } from '../sequenceAnim'
import type { VideoActions } from '../store'
import { clampAnimValue, MIN_OVERLAY_OUT, type OverlayClip } from '../sequenceModel'
import { CAPTION_BASE } from '../captions'
import { STICKER_DEFAULT_SCALE } from '../stickers'
import { newClipId, persist, recordHistory, snap, upsertKeyframe, type EditorGet, type EditorSet } from '../storeHelpers'

/** Overlay layers above the base track: text, stickers, media, captions. */
export function overlayActions(
  set: EditorSet,
  get: EditorGet,
): Pick<
  VideoActions,
  | 'setActiveOverlay'
  | 'addTextOverlay'
  | 'addSticker'
  | 'addCaptions'
  | 'clearCaptions'
  | 'addMediaOverlay'
  | 'moveOverlay'
  | 'removeOverlay'
  | 'setOverlayProps'
  | 'commitOverlayProps'
  | 'toggleOverlayKeyframe'
  | 'setOverlayTiming'
  | 'setOverlayAnim'
  | 'setOverlayMuted'
  | 'setOverlayText'
> {
  return {
    setActiveOverlay: (id) => {
      set({ activeOverlayId: id, activeClipId: id ? null : get().activeClipId, pendingOverlayBefore: null })
      if (id) persist(get, get().sequence, get().music, null)
    },

    addTextOverlay: (text) => {
      const before = snap(get)
      const defaults = animAt(undefined, 0, ANIM_DEFAULTS)
      const overlay: OverlayClip = {
        id: newClipId('text'),
        kind: 'text',
        text: (text ?? 'Your text').slice(0, 140),
        start: Math.round(get().currentTime * 20) / 20,
        duration: 3,
        base: { ...defaults },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
      }
      const next = [...get().overlays, overlay]
      recordHistory(get, 'Add text', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    addSticker: (emoji) => {
      const before = snap(get)
      const defaults = animAt(undefined, 0, ANIM_DEFAULTS)
      const overlay: OverlayClip = {
        id: newClipId('sticker'),
        kind: 'text',
        text: emoji.slice(0, 8),
        start: Math.round(get().currentTime * 20) / 20,
        duration: 3,
        // Stickers read at ~2.4× text size; everything else is plain overlay.
        base: { ...defaults, scale: STICKER_DEFAULT_SCALE },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
      }
      const next = [...get().overlays, overlay]
      recordHistory(get, 'Add sticker', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    addCaptions: (segments) => {
      if (segments.length === 0) return
      const before = snap(get)
      const defaults = { ...ANIM_DEFAULTS, ...CAPTION_BASE }
      const kept = get().overlays.filter((o) => !o.caption)
      const captions: OverlayClip[] = segments.slice(0, 400).map((segment) => ({
        id: newClipId('caption'),
        kind: 'text',
        text: segment.text.slice(0, 140),
        start: Math.round(segment.start * 20) / 20,
        duration: Math.max(MIN_OVERLAY_OUT, Math.round((segment.end - segment.start) * 20) / 20),
        base: { ...defaults },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
        caption: true,
      }))
      const next = [...kept, ...captions]
      recordHistory(get, 'Captions', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: null, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    clearCaptions: () => {
      const kept = get().overlays.filter((o) => !o.caption)
      if (kept.length === get().overlays.length) return
      const before = snap(get)
      recordHistory(get, 'Remove captions', before, snap(get, { overlays: kept }))
      set({ overlays: kept, activeOverlayId: null, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, kept)
    },

    addMediaOverlay: (assetId, kind) => {
      const before = snap(get)
      const defaults = animAt(undefined, 0, ANIM_DEFAULTS)
      const overlay: OverlayClip = {
        id: newClipId(assetId),
        kind,
        assetId,
        start: Math.round(get().currentTime * 20) / 20,
        duration: 3,
        base: { ...defaults, scale: 0.55 },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
      }
      const next = [...get().overlays, overlay]
      recordHistory(get, 'Add overlay', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    moveOverlay: (id, dir) => {
      const overlays = get().overlays
      const index = overlays.findIndex((o) => o.id === id)
      const target = index + dir
      if (index < 0 || target < 0 || target >= overlays.length) return
      const before = snap(get)
      const next = [...overlays]
      ;[next[index], next[target]] = [next[target], next[index]]
      recordHistory(get, 'Layer order', before, snap(get, { overlays: next }))
      set({ overlays: next, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    removeOverlay: (id) => {
      const before = snap(get)
      const next = get().overlays.filter((o) => o.id !== id)
      const fallback = get().activeOverlayId === id ? null : get().activeOverlayId
      recordHistory(get, 'Remove overlay', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: fallback, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    setOverlayProps: (values) => {
      const id = get().activeOverlayId
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      if (!get().pendingOverlayBefore) set({ pendingOverlayBefore: overlay })
      const at = get().currentTime - overlay.start
      const hasAnyKeys = (Object.keys(values) as (keyof AnimBase)[]).some((p) => overlay.keyframes[p].length > 0)
      let next: OverlayClip
      if (hasAnyKeys) {
        // Animated property: the slider drags the keyframe at the playhead.
        const keyframes = { ...overlay.keyframes }
        for (const [prop, value] of Object.entries(values) as [keyof AnimBase, number][]) {
          if (keyframes[prop].length === 0) keyframes[prop] = [...keyframes[prop]]
          keyframes[prop] = upsertKeyframe(keyframes[prop], at, clampAnimValue(prop, value))
        }
        next = { ...overlay, keyframes }
      } else {
        next = { ...overlay, base: { ...overlay.base, ...values } }
      }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    commitOverlayProps: () => {
      const { pendingOverlayBefore } = get()
      if (pendingOverlayBefore) {
        const after = get().overlays.find((o) => o.id === pendingOverlayBefore.id)
        if (after && JSON.stringify(after) !== JSON.stringify(pendingOverlayBefore)) {
          recordHistory(get, 'Overlay', snap(get, { overlays: get().overlays.map((o) => (o.id === after.id ? pendingOverlayBefore : o)) }), snap(get))
        }
      }
      set({ pendingOverlayBefore: null, revision: get().revision + 1 })
    },

    toggleOverlayKeyframe: (prop) => {
      const id = get().activeOverlayId
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const before = snap(get)
      const at = Math.max(0, get().currentTime - overlay.start)
      const current = animAt(overlay.keyframes, at, overlay.base)[prop]
      const has = overlay.keyframes[prop].some((k) => Math.abs(k.t - at) < 0.05)
      const keyframes = { ...overlay.keyframes }
      keyframes[prop] = has
        ? overlay.keyframes[prop].filter((k) => Math.abs(k.t - at) >= 0.05)
        : upsertKeyframe(overlay.keyframes[prop], at, clampAnimValue(prop, current))
      const next = { ...overlay, keyframes }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(get, has ? 'Remove keyframe' : 'Add keyframe', before, snap(get, { overlays: overlaysNext }))
      set({ overlays: overlaysNext, pendingOverlayBefore: null, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayTiming: (id, start, duration) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const next: OverlayClip = { ...overlay, start: Math.max(0, start), duration: Math.max(MIN_OVERLAY_OUT, duration) }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      // Dragging fires this continuously — coalesce so a gesture is one undo step.
      get().history.recordCoalesced(get().activeClipId ?? 'sequence', 'Overlay timing', snap(get, { overlays: get().overlays }), snap(get, { overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayAnim: (id, which, preset) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const before = snap(get)
      const next: OverlayClip = which === 'in'
        ? { ...overlay, animIn: preset }
        : { ...overlay, animOut: preset }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(get, which === 'in' ? 'In animation' : 'Out animation', before, snap(get, { overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayMuted: (id, muted) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay || overlay.kind !== 'video') return
      const before = snap(get)
      const next: OverlayClip = { ...overlay, muted }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(get, muted ? 'Mute layer audio' : 'Unmute layer audio', before, snap(get, { overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayText: (id, text) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay || overlay.kind !== 'text') return
      if (!get().pendingOverlayBefore) set({ pendingOverlayBefore: overlay })
      const next = { ...overlay, text: text.slice(0, 140) }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, overlaysNext)
    },
  }
}
