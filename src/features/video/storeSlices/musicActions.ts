import type { MusicTrack } from '../sequenceModel'
import { syncCutsToBeats } from '../sequenceModel'
import type { VideoActions } from '../store'
import { persist, recordHistory, snap, type EditorGet, type EditorSet } from '../storeHelpers'

/**
 * Music layer: track selection, the detected beat grid, beat-sync retrimming
 * ("Sync cuts to beats"), live volume, auto-ducking.
 */
export function musicActions(
  set: EditorSet,
  get: EditorGet,
): Pick<
  VideoActions,
  'setMusic' | 'setBeats' | 'syncCutsToBeats' | 'setMusicVolumeLive' | 'commitMusicVolume' | 'setMusicDuck'
> {
  return {
    setMusic: (assetId) => {
      const { sequence } = get()
      const nextMusic: MusicTrack | null = assetId ? { assetId, volume: 40 } : null
      recordHistory(get, assetId ? 'Add music' : 'Remove music', snap(get), snap(get, { music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(get, sequence, nextMusic, get().activeClipId)
    },

    setBeats: (beats, bpm) => {
      const music = get().music
      if (!music) return
      const nextMusic = { ...music, beats: beats.slice(0, 2000), bpm: bpm > 0 ? bpm : undefined }
      recordHistory(get, 'Detect beats', snap(get), snap(get, { music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(get, get().sequence, nextMusic, get().activeClipId)
    },

    syncCutsToBeats: () => {
      const { sequence, music, durations } = get()
      const beats = music?.beats
      if (!beats || beats.length === 0) return
      const next = syncCutsToBeats(sequence, durations, beats)
      if (!next) return
      recordHistory(get, 'Sync cuts to beats', snap(get), snap(get, { clips: next }))
      set({ sequence: next, revision: get().revision + 1 })
      persist(get, next, music, get().activeClipId)
      set({ doc: next.find((c) => c.id === get().activeClipId)?.edit ?? null })
    },

    setMusicVolumeLive: (v) => {
      const music = get().music
      if (!music) return
      set({ music: { ...music, volume: Math.max(0, Math.min(100, v)) } })
    },

    commitMusicVolume: () => {
      set({ revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId)
    },

    setMusicDuck: (duck) => {
      const music = get().music
      if (!music) return
      const nextMusic = { ...music, duck }
      recordHistory(get, duck ? 'Auto-duck on' : 'Auto-duck off', snap(get), snap(get, { music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(get, get().sequence, nextMusic, get().activeClipId)
    },
  }
}
