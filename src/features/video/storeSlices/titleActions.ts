import type { TitlePosition } from '../sequenceModel'
import type { VideoActions } from '../store'
import { persist, recordHistory, snap, type EditorGet, type EditorSet } from '../storeHelpers'

/** Live title editing on the selected clip: text, position, duration on screen. */
export function titleActions(
  set: EditorSet,
  get: EditorGet,
): Pick<VideoActions, 'setTitleText' | 'setTitlePosition' | 'setTitleShow' | 'commitTitle'> {
  return {
    setTitleText: (text) => {
      const { activeClipId, sequence } = get()
      if (!activeClipId) return
      if (!get().pendingTitleBefore) set({ pendingTitleBefore: sequence })
      const changed = sequence.map((c) => {
        if (c.id !== activeClipId) return c
        const trimmed = text.slice(0, 140)
        const previous = c.title ?? { position: 'lower' as TitlePosition, show: 3 }
        const title = trimmed.trim() ? { ...previous, text: trimmed } : null
        return { ...c, title }
      })
      const clip = changed.find((c) => c.id === activeClipId) ?? null
      set({ sequence: changed, clip })
      persist(get, changed, get().music, activeClipId)
    },

    setTitlePosition: (position) => {
      const { activeClipId, sequence } = get()
      if (!activeClipId) return
      const clip = sequence.find((c) => c.id === activeClipId)
      if (!clip?.title) return
      const before = snap(get)
      const next = sequence.map((c) => (c.id === activeClipId && c.title ? { ...c, title: { ...c.title, position } } : c))
      recordHistory(get, 'Title position', before, snap(get, { clips: next }))
      persist(get, next, get().music, activeClipId)
      set({ sequence: next, clip: next.find((c) => c.id === activeClipId) ?? null, revision: get().revision + 1 })
    },

    setTitleShow: (show) => {
      const { activeClipId, sequence } = get()
      if (!activeClipId) return
      const active = sequence.find((c) => c.id === activeClipId)
      if (!active?.title) return
      if (!get().pendingTitleBefore) set({ pendingTitleBefore: sequence })
      const value = Math.max(0.5, Math.min(30, show))
      const next = sequence.map((c) => (c.id === activeClipId && c.title ? { ...c, title: { ...c.title, show: value } } : c))
      const clip = next.find((c) => c.id === activeClipId) ?? null
      set({ sequence: next, clip })
      persist(get, next, get().music, activeClipId)
    },

    commitTitle: () => {
      const { pendingTitleBefore, sequence } = get()
      if (pendingTitleBefore && JSON.stringify(pendingTitleBefore) !== JSON.stringify(sequence)) {
        recordHistory(get, 'Title', snap(get, { clips: pendingTitleBefore }), snap(get))
      }
      set({ pendingTitleBefore: null, revision: get().revision + 1 })
    },
  }
}
