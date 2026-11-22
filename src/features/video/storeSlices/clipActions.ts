import { toast } from '../../../ui/toastStore'
import { useProjectsStore } from '../../projects/store'
import type { VideoActions } from '../store'
import { defaultVideoEdit, sanitizeVideoEdit } from '../model'
import {
  DEFAULT_TRANSITION,
  locateTime,
  layoutSequence,
  migrateLegacySequence,
  sanitizeSequence,
  splitClipAt,
  type VideoClip,
} from '../sequenceModel'
import {
  adopt,
  newClipId,
  persist,
  recordHistory,
  snap,
  type EditorGet,
  type EditorSet,
} from '../storeHelpers'

/**
 * Sequence/clip management: the timeline itself — building the sequence from
 * the project, selecting clips, adding/splitting/moving/reordering/removing
 * them, and asset durations.
 */
export function clipActions(
  set: EditorSet,
  get: EditorGet,
): Pick<
  VideoActions,
  'ensureSequence' | 'setActiveClip' | 'addClip' | 'setAssetDuration' | 'splitAtPlayhead' | 'moveClip' | 'reorderClip' | 'duplicateClip' | 'removeClip'
> {
  return {
    ensureSequence: () => {
      const s = useProjectsStore.getState()
      const project = s.projects.find((p) => p.id === s.currentId)
      if (!project) return
      const durations = { ...get().durations }
      const durationOf = (id: string): number => durations[id] ?? 0
      const hasAsset = (id: string): boolean => project.videoAssets.includes(id)
      // Choose the migration path: a real (non-empty) persisted sequence wins;
      // a null OR an emptied legacy sequence re-migrates from videoEdits.
      const rawRecord = typeof project.videoSequence === 'object' && project.videoSequence !== null
        ? (project.videoSequence as { clips?: unknown[]; fromLegacy?: boolean })
        : null
      const hasPersistedClips = Array.isArray(rawRecord?.clips) ? (rawRecord?.clips.length ?? 0) > 0 : false
      let sequence
      if (rawRecord !== null && hasPersistedClips && !rawRecord?.fromLegacy) {
        sequence = sanitizeSequence(project.videoSequence, durationOf, hasAsset)
      } else {
        sequence = migrateLegacySequence(project.videoAssets, project.videoEdits, durationOf, hasAsset)
      }
      const preferred = typeof project.activeVideoClipId === 'string' ? project.activeVideoClipId : project.activeVideoId ? `clip_${project.activeVideoId}` : null
      adopt(get, set, sequence, sequence.clips.some((c) => c.id === preferred) ? preferred : sequence.clips[0]?.id ?? null)
    },

    setActiveClip: (clipId) => {
      const clip = get().sequence.find((c) => c.id === clipId) ?? null
      set({ activeClipId: clipId, activeOverlayId: null, clip, doc: clip ? sanitizeVideoEdit(clip.edit, get().durations[clip.assetId] ?? 0) : null, pendingBefore: null, histogram: null })
      persist(get, get().sequence, get().music, clipId)
    },

    addClip: (assetId) => {
      const { sequence } = get()
      const blank = defaultVideoEdit()
      const clip: VideoClip = {
        id: newClipId(assetId),
        assetId,
        edit: blank,
        transition: 'cut',
        transitionDuration: DEFAULT_TRANSITION,
        title: null,
      }
      const before = snap(get)
      const next = [...sequence, clip]
      recordHistory(get, 'Add clip', before, snap(get, { clips: next }))
      set({ sequence: next, activeClipId: clip.id, clip, doc: blank, revision: get().revision + 1 })
      persist(get, next, get().music, clip.id)
    },

    setAssetDuration: (assetId, duration) => {
      const clean = Math.max(0, duration)
      set({ durations: { ...get().durations, [assetId]: clean } })
      const sequence = get().sequence.map((c) =>
        c.assetId === assetId ? { ...c, edit: sanitizeVideoEdit(c.edit, clean) } : c,
      )
      const active = get().activeClipId
      const clip = sequence.find((c) => c.id === active) ?? null
      set({
        sequence,
        clip,
        doc: clip ? sanitizeVideoEdit(clip.edit, clean) : get().doc,
      })
    },

    splitAtPlayhead: () => {
      const { sequence, currentTime, durations } = get()
      const before = snap(get)
      const layout = layoutSequence(sequence, (assetId) => durations[assetId] ?? 0)
      const at = locateTime(layout, currentTime)
      if (at.index < 0) return
      const next = splitClipAt(sequence, at.index, at.localOut)
      if (!next) {
        toast('Cannot split here', 'Move the playhead closer to the middle of a clip.', 'info')
        return
      }
      const target = next[at.index + 1].id
      const clip = next.find((c) => c.id === target) ?? null
      recordHistory(get, 'Split', before, snap(get, { clips: next }))
      set({ sequence: next, activeClipId: target, clip, doc: clip?.edit ?? null, revision: get().revision + 1 })
      persist(get, next, get().music, target)
    },

    moveClip: (clipId, dir) => {
      const { sequence, activeClipId } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      const target = index + dir
      if (index < 0 || target < 0 || target >= sequence.length) return
      const before = snap(get)
      const next = [...sequence]
      ;[next[index], next[target]] = [next[target], next[index]]
      recordHistory(get, dir < 0 ? 'Move earlier' : 'Move later', before, snap(get, { clips: next }))
      persist(get, next, get().music, activeClipId)
      set({ sequence: next, revision: get().revision + 1 })
    },

    reorderClip: (clipId, toIndex) => {
      const { sequence, activeClipId } = get()
      const from = sequence.findIndex((c) => c.id === clipId)
      if (from < 0) return
      const to = Math.max(0, Math.min(sequence.length - 1, Math.round(toIndex)))
      if (to === from) return
      const before = snap(get)
      const next = [...sequence]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      // Drag fires this continuously — a gesture collapses to one undo step.
      get().history.recordCoalesced(activeClipId ?? 'sequence', 'Reorder clips', before, snap(get, { clips: next }))
      persist(get, next, get().music, activeClipId)
      set({ sequence: next, revision: get().revision + 1 })
    },

    duplicateClip: (clipId) => {
      const { sequence } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      if (index < 0) return
      const source = sequence[index]
      const copy: VideoClip = { ...source, id: newClipId(source.assetId), edit: { ...source.edit } }
      const next = [...sequence.slice(0, index + 1), copy, ...sequence.slice(index + 1)]
      recordHistory(get, 'Duplicate clip', snap(get), snap(get, { clips: next }))
      set({ sequence: next, activeClipId: copy.id, clip: copy, doc: copy.edit, revision: get().revision + 1 })
      persist(get, next, get().music, copy.id)
    },

    removeClip: (clipId) => {
      const { sequence, durations } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      if (index < 0) return
      const before = snap(get)
      const next = sequence.filter((c) => c.id !== clipId)
      const fallback = next[Math.min(index, next.length - 1)] ?? null
      recordHistory(get, 'Delete clip', before, snap(get, { clips: next }))
      set({
        sequence: next,
        activeClipId: fallback?.id ?? null,
        clip: fallback,
        doc: fallback ? sanitizeVideoEdit(fallback.edit, durations[fallback.assetId] ?? 0) : null,
        revision: get().revision + 1,
      })
      persist(get, next, get().music, fallback?.id ?? null)
    },
  }
}
