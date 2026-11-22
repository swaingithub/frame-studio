import { ANIM_DEFAULTS, animAt, moveKeyframeTime, type AnimBase, type KeyframeSet } from '../sequenceAnim'
import type { VideoActions } from '../store'
import { clampAnimValue, clipOutDuration, locateTime } from '../sequenceModel'
import { kfGesture, layoutOf, persist, recordHistory, snap, upsertKeyframe, type EditorGet, type EditorSet } from '../storeHelpers'

/** Keyframed camera (zoom/pan) on the selected base-track clip. */
export function clipCameraActions(
  set: EditorSet,
  get: EditorGet,
): Pick<VideoActions, 'setClipAnim' | 'commitClipAnim' | 'toggleClipKeyframe' | 'moveClipKeyframe'> {
  return {
    setClipAnim: (values) => {
      const id = get().activeClipId
      const clip = get().sequence.find((c) => c.id === id)
      if (!clip) return
      const empty: KeyframeSet = { scale: [], x: [], y: [], opacity: [] }
      const keyframes = clip.keyframes ?? empty
      if (!get().pendingAnimBefore) set({ pendingAnimBefore: clip })
      // Clip camera anims always live as keyframes (a single key at 0 = static).
      const layout = layoutOf(get().sequence, get().durations)
      const at = locateTime(layout, get().currentTime)
      const localAt = at.index >= 0 && layout.entries[at.index].clip.id === id ? at.localOut : 0
      const nextKeys = { ...keyframes }
      for (const [prop, value] of Object.entries(values) as [keyof AnimBase, number][]) {
        nextKeys[prop] = upsertKeyframe(nextKeys[prop], localAt, clampAnimValue(prop, value))
      }
      const sequenceNext = get().sequence.map((c) => (c.id === id ? { ...c, keyframes: nextKeys } : c))
      const clipNext = sequenceNext.find((c) => c.id === id) ?? null
      set({ sequence: sequenceNext, clip: clipNext, revision: get().revision + 1 })
      persist(get, sequenceNext, get().music, id)
    },

    commitClipAnim: () => {
      const { pendingAnimBefore } = get()
      if (pendingAnimBefore) {
        const after = get().sequence.find((c) => c.id === pendingAnimBefore.id)
        if (after && JSON.stringify(after) !== JSON.stringify(pendingAnimBefore)) {
          recordHistory(
            get,
            'Camera keyframe',
            snap(get, { clips: get().sequence.map((c) => (c.id === after.id ? pendingAnimBefore : c)) }),
            snap(get),
          )
        }
      }
      set({ pendingAnimBefore: null, revision: get().revision + 1 })
    },

    toggleClipKeyframe: (prop) => {
      const id = get().activeClipId
      const clip = get().sequence.find((c) => c.id === id)
      if (!clip) return
      const before = snap(get)
      const layout = layoutOf(get().sequence, get().durations)
      const at = locateTime(layout, get().currentTime)
      const localAt = at.index >= 0 && layout.entries[at.index].clip.id === id ? at.localOut : 0
      const empty: KeyframeSet = { scale: [], x: [], y: [], opacity: [] }
      const keys = clip.keyframes ?? empty
      const has = keys[prop].some((k) => Math.abs(k.t - localAt) < 0.05)
      const current = animAt(keys, localAt, ANIM_DEFAULTS)[prop]
      const nextKeys: KeyframeSet = { ...keys, [prop]: has ? keys[prop].filter((k) => Math.abs(k.t - localAt) >= 0.05) : upsertKeyframe(keys[prop], localAt, current) }
      const sequenceNext = get().sequence.map((c) => (c.id === id ? { ...c, keyframes: nextKeys } : c))
      const clipNext = sequenceNext.find((c) => c.id === id) ?? null
      recordHistory(get, has ? 'Remove keyframe' : 'Add keyframe', before, snap(get, { clips: sequenceNext }))
      set({ sequence: sequenceNext, clip: clipNext, pendingAnimBefore: null, revision: get().revision + 1 })
      persist(get, sequenceNext, get().music, id)
    },

    /**
     * Drags a timeline keyframe diamond: moves every track's key at local
     * time `from` to `to`. `phase` starts/ends the gesture so the whole drag
     * lands as one history entry.
     */
    moveClipKeyframe: (clipId, from, to, phase) => {
      const clip = get().sequence.find((c) => c.id === clipId)
      if (!clip?.keyframes) return
      if (phase === 'start') kfGesture.before = snap(get)
      if (phase === 'end') {
        const beforeSnap = kfGesture.before
        kfGesture.before = null
        if (beforeSnap && JSON.stringify(beforeSnap) !== JSON.stringify(snap(get))) {
          recordHistory(get, 'Move keyframe', beforeSnap, snap(get))
        }
      }
      const maxT = Math.max(0.1, clipOutDuration(clip, get().durations[clip.assetId] ?? 0))
      const nextKeys = moveKeyframeTime(clip.keyframes, from, to, maxT)
      if (nextKeys === clip.keyframes) return
      const sequenceNext = get().sequence.map((c) => (c.id === clipId ? { ...c, keyframes: nextKeys } : c))
      const clipNext = sequenceNext.find((c) => c.id === clipId) ?? null
      set({ sequence: sequenceNext, clip: clipNext, pendingAnimBefore: null, revision: get().revision + 1 })
      persist(get, sequenceNext, get().music, clipId)
    },
  }
}
