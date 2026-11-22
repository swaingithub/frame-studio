import { toast } from '../../../ui/toastStore'
import { useProjectsStore } from '../../projects/store'
import type { VideoActions } from '../store'
import { defaultVideoEdit } from '../model'
import { DEFAULT_TRANSITION, MIN_OVERLAY_OUT, type OverlayClip, type VoiceoverClip, type VideoClip } from '../sequenceModel'
import { animAt, ANIM_DEFAULTS } from '../sequenceAnim'
import { CAPTION_BASE } from '../captions'
import { MUSIC_LIBRARY } from '../musicLibrary'
import { newClipId, newVoiceoverId, persist, recordHistory, snap, layoutOf, type EditorGet, type EditorSet } from '../storeHelpers'

/**
 * Voiceover track: Kokoro TTS generates the speech WAV (added to the library)
 * and appends a clip to the voice track. Auto-captions (Whisper) can then
 * transcribe a voiceover into timeline captions.
 */
export function voiceoverActions(
  set: EditorSet,
  get: EditorGet,
): Pick<
  VideoActions,
  'addVoiceover' | 'removeVoiceover' | 'addVoiceoverCaptions' | 'createYouTubeMontage'
> {
  return {
    addVoiceover: (assetId, duration) => {
      const { voiceovers, sequence, durations } = get()
      if (voiceovers.some((v) => v.assetId === assetId)) return
      const clip: VoiceoverClip = {
        id: newVoiceoverId(),
        assetId,
        start: layoutOf(sequence, durations).total,
        duration: Math.max(0.2, duration),
      }
      const before = snap(get)
      const next = [...voiceovers, clip]
      recordHistory(get, 'Add voiceover', before, snap(get, { voiceovers: next }))
      set({ voiceovers: next, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, get().overlays, get().canvas, next)
    },

    removeVoiceover: (id) => {
      const { voiceovers } = get()
      const next = voiceovers.filter((v) => v.id !== id)
      const before = snap(get)
      recordHistory(get, 'Remove voiceover', before, snap(get, { voiceovers: next }))
      set({ voiceovers: next, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, get().overlays, get().canvas, next)
    },

    addVoiceoverCaptions: (voiceoverId, segments) => {
      if (segments.length === 0) return
      const before = snap(get)
      const base = get().voiceovers.find((v) => v.id === voiceoverId)?.start ?? 0
      const defaults = { ...ANIM_DEFAULTS, ...CAPTION_BASE }
      const kept = get().overlays.filter((o) => !o.caption)
      const captions: OverlayClip[] = segments.slice(0, 400).map((segment) => ({
        id: newClipId('caption'),
        kind: 'text',
        text: segment.text.slice(0, 140),
        start: Math.round((base + segment.start) * 20) / 20,
        duration: Math.max(MIN_OVERLAY_OUT, Math.round((segment.end - segment.start) * 20) / 20),
        base: { ...defaults },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
        caption: true,
      }))
      const next = [...kept, ...captions]
      recordHistory(get, 'Voiceover captions', before, snap(get, { overlays: next }))
      set({ overlays: next, activeOverlayId: null, revision: get().revision + 1 })
      persist(get, get().sequence, get().music, get().activeClipId, next)
    },

    createYouTubeMontage: () => {
      const project = useProjectsStore.getState().projects.find((p) => p.id === useProjectsStore.getState().currentId)
      const ids = [...new Set(project?.videoAssets ?? [])]
      if (ids.length === 0) {
        toast('Add a video first', 'Import at least one video into this project to build a montage.', 'info')
        return
      }
      const before = snap(get)
      const clips: VideoClip[] = []
      // Twelve 5-second beats gives a familiar ~1-minute YouTube montage.
      for (let i = 0; i < 12; i++) {
        const assetId = ids[i % ids.length]
        const duration = Math.max(0.5, get().durations[assetId] ?? 5)
        const out = Math.min(5, duration)
        clips.push({
          id: newClipId(assetId),
          assetId,
          edit: { ...defaultVideoEdit(), trimStart: 0, trimEnd: out },
          transition: i === 0 ? 'cut' : 'dissolve',
          transitionDuration: i === 0 ? DEFAULT_TRANSITION : 0.45,
          title: null,
        })
      }
      const title: OverlayClip = {
        id: newClipId('text'), kind: 'text', text: 'MY STORY IN 60 SECONDS', start: 0.35, duration: 3.5,
        base: { ...animAt(undefined, 0, ANIM_DEFAULTS), scale: 1.15 },
        keyframes: { scale: [], x: [], y: [], opacity: [] },
      }
      const nextMusic = MUSIC_LIBRARY.tracks[0] ? { assetId: MUSIC_LIBRARY.tracks[0].id, volume: 32 } : null
      const canvas = { ...get().canvas, aspect: '16:9' as const, quality: 1080 }
      const active = clips[0]
      recordHistory(get, 'Build YouTube montage', before, snap(get, { clips, overlays: [title], music: nextMusic, canvas }))
      set({ sequence: clips, overlays: [title], music: nextMusic, canvas, activeClipId: active.id, activeOverlayId: null, clip: active, doc: active.edit, currentTime: 0, revision: get().revision + 1 })
      persist(get, clips, nextMusic, active.id, [title], canvas)
      toast('YouTube montage ready', 'Your 16:9 edit has clips, dissolves, a title, and music. Fine-tune it on the timeline.', 'success')
    },
  }
}
