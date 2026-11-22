import { DEFAULT_TRANSITION, MAX_TRANSITION } from '../sequenceModel'
import type { VideoActions } from '../store'
import { persist, recordHistory, snap, type EditorGet, type EditorSet } from '../storeHelpers'

/** Live transition-in on the selected clip, snapped on release. */
export function transitionActions(
  set: EditorSet,
  get: EditorGet,
): Pick<VideoActions, 'setTransition' | 'setTransitionDurationLive' | 'commitTransitionDuration'> {
  return {
    setTransition: (type) => {
      const { sequence, activeClipId } = get()
      if (!activeClipId) return
      const before = snap(get)
      const next = sequence.map((c) => (c.id === activeClipId ? { ...c, transition: type, transitionDuration: DEFAULT_TRANSITION } : c))
      recordHistory(get, 'Transition', before, snap(get, { clips: next }))
      persist(get, next, get().music, activeClipId)
      const clip = next.find((c) => c.id === activeClipId) ?? null
      set({ sequence: next, clip, pendingTransitionBefore: null, revision: get().revision + 1 })
    },

    setTransitionDurationLive: (seconds) => {
      const { sequence, activeClipId } = get()
      if (!activeClipId) return
      const base = get().pendingTransitionBefore ?? sequence
      if (!get().pendingTransitionBefore) set({ pendingTransitionBefore: sequence })
      const duration = Math.max(0, Math.min(MAX_TRANSITION, seconds))
      const next = base.map((c) => (c.id === activeClipId ? { ...c, transitionDuration: duration } : c))
      const clip = next.find((c) => c.id === activeClipId) ?? null
      set({ sequence: next, clip, revision: get().revision + 1 })
      persist(get, next, get().music, activeClipId)
    },

    commitTransitionDuration: () => {
      const before = get().pendingTransitionBefore
      if (!before) return
      const after = get().sequence
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        recordHistory(get, 'Transition length', snap(get, { clips: before }), snap(get))
      }
      set({ pendingTransitionBefore: null })
    },
  }
}
