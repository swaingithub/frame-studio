import { toast } from '../../../ui/toastStore'
import { defaultVideoEdit, isVideoEditNeutral, type VideoEditDoc } from '../model'
import type { VideoActions } from '../store'
import { applySnapshot, recordHistory, snap, writeDoc, type EditorGet, type EditorSet } from '../storeHelpers'

/** History: undo/redo/jump, plus the reset-edits action. */
export function historyActions(set: EditorSet, get: EditorGet): Pick<VideoActions, 'resetEdits' | 'undo' | 'redo' | 'jumpTo'> {
  return {
    resetEdits: () => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap(get)
      const blank = defaultVideoEdit()
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: blank } : c))
      recordHistory(get, 'Reset all edits', before, snap(get, { clips: afterClips }))
      writeDoc(get, set, blank)
      set({ revision: get().revision + 1 })
      toast('Edits reset', 'The clip is back to its original state', 'success')
    },

    undo: () => {
      const entry = get().history.undo()
      if (!entry) return
      applySnapshot(get, set, entry.before)
    },

    redo: () => {
      const entry = get().history.redo()
      if (!entry) return
      applySnapshot(get, set, entry.after)
    },

    jumpTo: (entryId) => {
      const entry = get().history.jumpTo(entryId)
      if (!entry) return
      applySnapshot(get, set, entry.after)
    },
  }
}

/** Whether the active clip differs from a fresh one (drives the Reset button). */
export function videoEditsChanged(doc: VideoEditDoc | null, needsTrim = false): boolean {
  if (!doc) return false
  return !isVideoEditNeutral(doc, defaultVideoEdit()) || needsTrim
}
