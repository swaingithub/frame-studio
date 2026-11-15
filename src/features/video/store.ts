import { create } from 'zustand'
import { useProjectsStore } from '../projects/store'
import { toast } from '../../ui/toastStore'
import { EditHistory } from '../photo/history'
import {
  defaultVideoEdit,
  isVideoEditNeutral,
  sanitizeVideoEdit,
  withSpeed,
  withSpeedCurve,
  withTrim,
  withVideoAdjustment,
  withVideoAdjustments,
  withVolume,
  withAudioFades,
  withChromaKey,
  withMask,
  withBgRemove,
  type VideoEditDoc,
} from './model'
import {
  DEFAULT_TRANSITION,
  MAX_TRANSITION,
  clampAnimValue,
  defaultCanvasSettings,
  locateTime,
  migrateLegacySequence,
  MIN_OVERLAY_OUT,
  sanitizeSequence,
  splitClipAt,
  type CanvasSettings,
  type MusicTrack,
  type OverlayClip,
  type OverlayAnimPreset,
  type OverlayKind,
  type SequenceLayout,
  type TitlePosition,
  type VideoClip,
  type VideoTransition,
} from './sequenceModel'
import { layoutSequence } from './sequenceModel'
import { syncCutsToBeats } from './sequenceModel'
import { PRESETS, mixValues, filmicCurve } from '../../core/adjustments/presets'
import { animAt, ANIM_DEFAULTS, type AnimBase, type Keyframe, type KeyframeSet, type SpeedCurve } from './sequenceAnim'
import { STICKER_DEFAULT_SCALE } from './stickers'
import { CAPTION_BASE, type CaptionSegment } from './captions'
import type { ChromaKey, Mask } from '../../core/adjustments/edits'

/**
 * Video editor store — sequence-first. The live state mirrors the active
 * project's `videoSequence`; the active clip's doc is exposed directly so the
 * inspector keeps its slider model. History snapshots span the WHOLE clip
 * list plus music, so undo/redo covers split, reorder, trim, grade, speed,
 * transitions, titles and music with one mechanism.
 */

export type { SequenceLayout }

/** One undo/redo snapshot: everything that defines the video edit. */
interface SeqSnapshot {
  clips: VideoClip[]
  overlays: OverlayClip[]
  music: MusicTrack | null
  canvas: CanvasSettings
}

interface VideoState {
  activeClipId: string | null
  /** The active clip instance (live mirror of the stored one). */
  clip: VideoClip | null
  /** The active clip's edit doc (drives sliders; === clip.edit). */
  doc: VideoEditDoc | null
  /** Live clip list (mirrors project.videoSequence.clips). */
  sequence: VideoClip[]
  /** Overlay layers above the base track. */
  overlays: OverlayClip[]
  /** Selected overlay layer id (inspector target when set). */
  activeOverlayId: string | null
  music: MusicTrack | null
  /** Output frame + letterbox fill for the whole sequence. */
  canvas: CanvasSettings
  /** Known asset durations (seconds) by asset id. */
  durations: Record<string, number>
  playing: boolean
  /** Playhead in GLOBAL sequence seconds. */
  currentTime: number
  exporting: boolean
  bypass: boolean
  /** Pro mode exposes keyframes, speed ramps and camera controls; default hides them. */
  proMode: boolean
  history: EditHistory<SeqSnapshot>
  pendingBefore: VideoEditDoc | null
  pendingCanvasBefore: CanvasSettings | null
  pendingTitleBefore: VideoClip[] | null
  pendingOverlayBefore: OverlayClip | null
  pendingAnimBefore: VideoClip | null
  pendingTransitionBefore: VideoClip[] | null
  revision: number
  histogram: unknown | null

  /** Builds/adopts the persisted sequence for the current project (idempotent). */
  ensureSequence: () => void
  setActiveClip: (clipId: string | null) => void
  addClip: (assetId: string) => void
  setAssetDuration: (assetId: string, duration: number) => void

  setAdjustment: (key: keyof VideoEditDoc['adjustments'], value: number) => void
  applyAdjustments: (values: Partial<VideoEditDoc['adjustments']>, label: string, lookId?: string) => void
  /** Dials the active look's strength (0..1). */
  setLookStrength: (strength: number) => void
  /** Live chroma key change (single history entry via the following commit). */
  setChromaKey: (patch: Partial<ChromaKey>) => void
  /** Live shape-mask change (single history entry via the following commit). */
  setMask: (patch: Partial<Mask>) => void
  /** Toggles AI background removal on the selected clip (one undo entry). */
  setBgRemove: (enabled: boolean) => void
  commit: (label: string) => void
  setTrimLive: (start: number, end: number | null) => void
  commitTrim: () => void
  setVolume: (v: number) => void
  commitVolume: () => void
  /** Per-clip audio fade drag (live), committed on release. */
  setAudioFades: (fadeIn: number, fadeOut: number) => void
  commitAudioFades: () => void
  setMuted: (v: boolean) => void
  setSpeedLive: (v: number) => void
  commitSpeed: () => void
  setTransition: (type: VideoTransition) => void
  setTransitionDurationLive: (seconds: number) => void
  commitTransitionDuration: () => void
  setTitleText: (text: string) => void
  setTitlePosition: (position: TitlePosition) => void
  setTitleShow: (show: number) => void
  commitTitle: () => void
  setRamp: (curve: SpeedCurve) => void

  /** Overlay layers: select, add, move, delete, animate (keyframes). */
  setActiveOverlay: (id: string | null) => void
  addTextOverlay: (text?: string) => void
  /** Inserts an emoji sticker as a text overlay at the playhead (one undo entry). */
  addSticker: (emoji: string) => void
  addMediaOverlay: (assetId: string, kind: OverlayKind) => void
  moveOverlay: (id: string, dir: -1 | 1) => void
  removeOverlay: (id: string) => void
  setOverlayProps: (values: Partial<AnimBase>) => void
  commitOverlayProps: () => void
  toggleOverlayKeyframe: (prop: keyof AnimBase) => void
  setOverlayTiming: (id: string, start: number, duration: number) => void
  setOverlayText: (id: string, text: string) => void
  /** Sets an overlay's intro/outro motion preset (one undo entry). */
  setOverlayAnim: (id: string, which: 'in' | 'out', preset: OverlayAnimPreset) => void
  /** Mutes/unmutes a media overlay's own audio (one undo entry). */
  setOverlayMuted: (id: string, muted: boolean) => void
  /** Replaces every auto-caption overlay with `segments` (one undo entry). */
  addCaptions: (segments: readonly CaptionSegment[]) => void
  /** Removes all auto-caption overlays (one undo entry). */
  clearCaptions: () => void

  /** Keyframed camera (zoom/pan) on the selected base clip. */
  setClipAnim: (values: Partial<AnimBase>) => void
  commitClipAnim: () => void
  toggleClipKeyframe: (prop: keyof AnimBase) => void

  splitAtPlayhead: () => void
  moveClip: (clipId: string, dir: -1 | 1) => void
  /** Drag-reorder: moves a clip to an absolute insertion index (one undo per gesture). */
  reorderClip: (clipId: string, toIndex: number) => void
  duplicateClip: (clipId: string) => void
  removeClip: (clipId: string) => void

  setMusic: (assetId: string | null) => void
  /** Stores the detected beat grid on the music track (one undo entry). */
  setBeats: (beats: number[], bpm: number) => void
  /** Retrims clip boundaries onto the beat grid (one undo entry). */
  syncCutsToBeats: () => void
  setMusicVolumeLive: (v: number) => void
  /** Toggles auto-ducking of music under unmuted clip audio. */
  setMusicDuck: (duck: boolean) => void
  commitMusicVolume: () => void

  /** Live canvas settings (aspect/background/colour) + one history entry per gesture. */
  setCanvasLive: (patch: Partial<CanvasSettings>) => void
  commitCanvas: (label?: string) => void

  setPlaying: (v: boolean) => void
  setTime: (t: number) => void
  setHistogram: (h: unknown | null) => void
  setBypass: (v: boolean) => void
  setExporting: (v: boolean) => void
  setProMode: (v: boolean) => void
  resetEdits: () => void
  undo: () => void
  redo: () => void
  jumpTo: (entryId: string) => void
}

/** Convenience: layout of a live clip list against known durations. */
export function layoutOf(clips: readonly VideoClip[], durations: Record<string, number>): SequenceLayout {
  return layoutSequence(clips, (assetId) => durations[assetId] ?? 0)
}

let clipCounter = 0
function newClipId(assetId: string): string {
  clipCounter += 1
  return `clip_${assetId}_${clipCounter}_${Math.random().toString(36).slice(2, 7)}`
}

/** Inserts (or replaces within snap distance) a keyframe, keeps track sorted. */
function upsertKeyframe(track: Keyframe[], t: number, v: number): Keyframe[] {
  const existing = track.find((k) => Math.abs(k.t - t) <= 0.05)
  const keyframe: Keyframe = existing
    ? { ...existing, v }
    : { id: `kf_${Math.floor(t * 1000)}_${Math.floor(Math.abs(v * 1000))}_${Math.floor(Math.random() * 1000)}`, t, v, ease: 'smooth' }
  const next = (track.length > 0 && existing == null) ? track.filter((k) => Math.abs(k.t - t) > 0.05) : [...track]
  const without = next.filter((k) => k.id !== keyframe.id)
  without.push(keyframe)
  without.sort((a, b) => a.t - b.t)
  return without
}

export const useVideoEditor = create<VideoState>()((set, get) => {
  /**
   * Writes the live sequence + selection back into the project doc. The
   * selection doubles as the legacy `activeVideoId` (asset id) so other
   * views stay coherent, and the active doc lands in `videoEdits`.
   */
  function persist(clips: VideoClip[], music: MusicTrack | null, activeClipId: string | null, overlays?: OverlayClip[], canvas?: CanvasSettings): void {
    const s = useProjectsStore.getState()
    const project = s.projects.find((p) => p.id === s.currentId)
    if (!project) return
    const durations = get().durations
    const clean = sanitizeSequence(
      { clips, music, overlays: overlays ?? get().overlays, canvas: canvas ?? get().canvas },
      (id) => durations[id] ?? 0,
      (id) => project.videoAssets.includes(id),
    )
    const active = clips.find((c) => c.id === activeClipId) ?? null
    useProjectsStore.getState().updateCurrent((p) => ({
      ...p,
      videoSequence: clean,
      activeVideoClipId: active?.id ?? null,
      activeVideoId: active?.assetId ?? null,
      videoEdits: active ? { ...p.videoEdits, [active.assetId]: active.edit } : p.videoEdits,
    }))
  }

  /** Applies an edit doc to the active clip (live, no history) + persists. */
  function writeDoc(next: VideoEditDoc): void {
    const { activeClipId, sequence, music } = get()
    if (!activeClipId) return
    const sequenceNext = sequence.map((c) => (c.id === activeClipId ? { ...c, edit: next } : c))
    const clip = sequenceNext.find((c) => c.id === activeClipId) ?? null
    set({ doc: next, clip, sequence: sequenceNext })
    persist(sequenceNext, music, activeClipId)
  }

  /** Full "sequence as it stands now" snapshot. */
  function snap(now?: { clips?: VideoClip[]; music?: MusicTrack | null; overlays?: OverlayClip[]; canvas?: CanvasSettings }): SeqSnapshot {
    const merged = { clips: get().sequence, music: get().music, overlays: get().overlays, canvas: get().canvas, ...now }
    return { clips: merged.clips, music: merged.music, overlays: merged.overlays, canvas: merged.canvas }
  }

  /** Records a history entry with whole-sequence snapshots. */
  function recordHistory(label: string, before: SeqSnapshot, after: SeqSnapshot): void {
    get().history.record(get().activeClipId ?? 'sequence', label, before, after)
  }

  /** Restores a snapshot (undo/redo/jump) into live state + project. */
  function applySnapshot(snapshot: SeqSnapshot): void {
    const durations = get().durations
    let active = get().activeClipId
    if (!snapshot.clips.some((c) => c.id === active)) active = snapshot.clips[0]?.id ?? null
    const clip = snapshot.clips.find((c) => c.id === active) ?? null
    let overlayActive = get().activeOverlayId
    if (overlayActive && !snapshot.overlays.some((o) => o.id === overlayActive)) overlayActive = null
    set({
      sequence: snapshot.clips,
      overlays: snapshot.overlays,
      music: snapshot.music,
      canvas: snapshot.canvas,
      activeClipId: active,
      activeOverlayId: overlayActive,
      clip,
      doc: clip ? sanitizeVideoEdit(clip.edit, durations[clip.assetId] ?? 0) : null,
      pendingBefore: null,
      pendingCanvasBefore: null,
      pendingTitleBefore: null,
      pendingOverlayBefore: null,
      pendingAnimBefore: null,
      pendingTransitionBefore: null,
      revision: get().revision + 1,
    })
    persist(snapshot.clips, snapshot.music, active, snapshot.overlays, snapshot.canvas)
  }

  function adopt(sequence: { clips: VideoClip[]; music: MusicTrack | null; overlays?: OverlayClip[]; canvas?: CanvasSettings }, preferredClipId: string | null): void {
    const durations = get().durations
    const clip = sequence.clips.find((c) => c.id === preferredClipId) ?? sequence.clips[0] ?? null
    const canvas = sequence.canvas ?? defaultCanvasSettings()
    set({
      sequence: sequence.clips,
      overlays: sequence.overlays ?? [],
      music: sequence.music,
      canvas,
      activeClipId: clip?.id ?? null,
      activeOverlayId: null,
      clip,
      doc: clip ? sanitizeVideoEdit(clip.edit, durations[clip.assetId] ?? 0) : null,
      playing: false,
      currentTime: 0,
      bypass: false,
      pendingBefore: null,
      pendingCanvasBefore: null,
      pendingTitleBefore: null,
      pendingOverlayBefore: null,
      pendingAnimBefore: null,
      pendingTransitionBefore: null,
      histogram: null,
      history: new EditHistory<SeqSnapshot>(),
      revision: get().revision + 1,
    })
    persist(sequence.clips, sequence.music, clip?.id ?? null, sequence.overlays ?? [], canvas)
  }

  return {
    activeClipId: null,
    activeOverlayId: null,
    clip: null,
    doc: null,
    sequence: [],
    overlays: [],
    music: null,
    canvas: defaultCanvasSettings(),
    durations: {},
    playing: false,
    currentTime: 0,
    exporting: false,
    bypass: false,
    proMode: typeof localStorage !== 'undefined' ? localStorage.getItem('frame-studio:proMode') === '1' : false,
    history: new EditHistory<SeqSnapshot>(),
    pendingBefore: null,
    pendingCanvasBefore: null,
    pendingTitleBefore: null,
    pendingOverlayBefore: null,
    pendingAnimBefore: null,
    pendingTransitionBefore: null,
    revision: 0,
    histogram: null,

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
      adopt(sequence, sequence.clips.some((c) => c.id === preferred) ? preferred : sequence.clips[0]?.id ?? null)
    },

    setActiveClip: (clipId) => {
      const clip = get().sequence.find((c) => c.id === clipId) ?? null
      set({ activeClipId: clipId, activeOverlayId: null, clip, doc: clip ? sanitizeVideoEdit(clip.edit, get().durations[clip.assetId] ?? 0) : null, pendingBefore: null, histogram: null })
      persist(get().sequence, get().music, clipId)
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
      const before = snap()
      const next = [...sequence, clip]
      recordHistory('Add clip', before, snap({ clips: next }))
      set({ sequence: next, activeClipId: clip.id, clip, doc: blank, revision: get().revision + 1 })
      persist(next, get().music, clip.id)
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

    setAdjustment: (key, value) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      // Manual tweaks detach the active one-click look (and its curve).
      writeDoc({ ...withVideoAdjustment(base, key, value), look: null, ...(base.look ? { curves: null } : {}) })
    },

    setChromaKey: (patch) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      writeDoc(withChromaKey(base, patch))
    },

    setMask: (patch) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      writeDoc(withMask(base, patch))
    },

    setBgRemove: (enabled) => {
      const doc = get().doc
      const clipId = get().activeClipId
      if (!doc || !clipId) return
      if (doc.bgRemove === enabled) return
      const before = snap()
      const next = withBgRemove(doc, enabled)
      const afterClips = get().sequence.map((c) => (c.id === clipId ? { ...c, edit: next } : c))
      recordHistory(enabled ? 'Remove background' : 'Restore background', before, snap({ clips: afterClips }))
      writeDoc(next)
      set({ revision: get().revision + 1 })
    },

    applyAdjustments: (values, label, lookId) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap()
      const next = {
        ...withVideoAdjustments(doc, values),
        look: lookId ? { id: lookId, strength: 1 } : null,
        curves: lookId ? filmicCurve(1) : null,
      }
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory(label, before, snap({ clips: afterClips }))
      writeDoc(next)
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
      writeDoc(next)
      set({ sequence: afterClips, doc: next, revision: get().revision + 1 })
    },

    commit: (label) => {
      const { pendingBefore, doc } = get()
      if (!doc || !pendingBefore || !get().activeClipId) return
      if (JSON.stringify(pendingBefore) !== JSON.stringify(doc)) {
        const afterClips = get().sequence // doc is already merged into sequence
        const beforeClips = afterClips.map((c) => (c.id === get().activeClipId ? { ...c, edit: pendingBefore } : c))
        recordHistory(label, snap({ clips: beforeClips }), snap({ clips: afterClips }))
      }
      set({ pendingBefore: null, revision: get().revision + 1 })
    },

    setTrimLive: (start, end) => {
      const doc = get().doc
      if (!doc) return
      const base = get().pendingBefore ?? doc
      if (!get().pendingBefore) set({ pendingBefore: doc })
      const duration = get().durations[get().clip?.assetId ?? ''] ?? 0
      writeDoc(withTrim(base, start, end, duration))
    },

    commitTrim: () => {
      get().commit('Trim')
    },

    setVolume: (v) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(withVolume(base, v))
    },

    commitVolume: () => {
      get().commit('Volume')
    },

    setAudioFades: (fadeIn, fadeOut) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(withAudioFades(base, fadeIn, fadeOut))
    },

    commitAudioFades: () => {
      get().commit('Audio fade')
    },

    setMuted: (v) => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap()
      const next: VideoEditDoc = { ...doc, muted: v }
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory(v ? 'Mute' : 'Unmute', before, snap({ clips: afterClips }))
      writeDoc(next)
      set({ revision: get().revision + 1 })
    },

    setSpeedLive: (v) => {
      const base = get().pendingBefore ?? get().doc
      if (!base || !get().activeClipId) return
      if (!get().pendingBefore) set({ pendingBefore: get().doc })
      writeDoc(withSpeed(base, v))
    },

    commitSpeed: () => {
      get().commit('Speed')
    },

    setTransition: (type) => {
      const { sequence, activeClipId } = get()
      if (!activeClipId) return
      const before = snap()
      const next = sequence.map((c) => (c.id === activeClipId ? { ...c, transition: type, transitionDuration: DEFAULT_TRANSITION } : c))
      recordHistory('Transition', before, snap({ clips: next }))
      persist(next, get().music, activeClipId)
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
      persist(next, get().music, activeClipId)
    },

    commitTransitionDuration: () => {
      const before = get().pendingTransitionBefore
      if (!before) return
      const after = get().sequence
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        recordHistory('Transition length', snap({ clips: before }), snap())
      }
      set({ pendingTransitionBefore: null })
    },

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
      persist(changed, get().music, activeClipId)
    },

    setTitlePosition: (position) => {
      const { activeClipId, sequence } = get()
      if (!activeClipId) return
      const clip = sequence.find((c) => c.id === activeClipId)
      if (!clip?.title) return
      const before = snap()
      const next = sequence.map((c) => (c.id === activeClipId && c.title ? { ...c, title: { ...c.title, position } } : c))
      recordHistory('Title position', before, snap({ clips: next }))
      persist(next, get().music, activeClipId)
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
      persist(next, get().music, activeClipId)
    },

    commitTitle: () => {
      const { pendingTitleBefore, sequence } = get()
      if (pendingTitleBefore && JSON.stringify(pendingTitleBefore) !== JSON.stringify(sequence)) {
        recordHistory('Title', snap({ clips: pendingTitleBefore }), snap())
      }
      set({ pendingTitleBefore: null, revision: get().revision + 1 })
    },

    setRamp: (curve) => {
      const doc = get().doc
      if (!doc || !get().activeClipId || doc.speedCurve === curve) return
      const next = withSpeedCurve(doc, curve)
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: next } : c))
      recordHistory('Speed ramp', snap(), snap({ clips: afterClips }))
      writeDoc(next)
      set({ revision: get().revision + 1 })
    },

    // ------------------------------------------------------------- overlays

    setActiveOverlay: (id) => {
      set({ activeOverlayId: id, activeClipId: id ? null : get().activeClipId, pendingOverlayBefore: null })
      if (id) persist(get().sequence, get().music, null)
    },

    addTextOverlay: (text) => {
      const before = snap()
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
      recordHistory('Add text', before, snap({ overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
    },

    addSticker: (emoji) => {
      const before = snap()
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
      recordHistory('Add sticker', before, snap({ overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
    },

    addCaptions: (segments) => {
      if (segments.length === 0) return
      const before = snap()
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
      recordHistory('Captions', before, snap({ overlays: next }))
      set({ overlays: next, activeOverlayId: null, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
    },

    clearCaptions: () => {
      const kept = get().overlays.filter((o) => !o.caption)
      if (kept.length === get().overlays.length) return
      const before = snap()
      recordHistory('Remove captions', before, snap({ overlays: kept }))
      set({ overlays: kept, activeOverlayId: null, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, kept)
    },

    addMediaOverlay: (assetId, kind) => {
      const before = snap()
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
      recordHistory('Add overlay', before, snap({ overlays: next }))
      set({ overlays: next, activeOverlayId: overlay.id, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
    },

    moveOverlay: (id, dir) => {
      const overlays = get().overlays
      const index = overlays.findIndex((o) => o.id === id)
      const target = index + dir
      if (index < 0 || target < 0 || target >= overlays.length) return
      const before = snap()
      const next = [...overlays]
      ;[next[index], next[target]] = [next[target], next[index]]
      recordHistory('Layer order', before, snap({ overlays: next }))
      set({ overlays: next, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
    },

    removeOverlay: (id) => {
      const before = snap()
      const next = get().overlays.filter((o) => o.id !== id)
      const fallback = get().activeOverlayId === id ? null : get().activeOverlayId
      recordHistory('Remove overlay', before, snap({ overlays: next }))
      set({ overlays: next, activeOverlayId: fallback, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, next)
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
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    commitOverlayProps: () => {
      const { pendingOverlayBefore } = get()
      if (pendingOverlayBefore) {
        const after = get().overlays.find((o) => o.id === pendingOverlayBefore.id)
        if (after && JSON.stringify(after) !== JSON.stringify(pendingOverlayBefore)) {
          recordHistory('Overlay', snap({ overlays: get().overlays.map((o) => (o.id === after.id ? pendingOverlayBefore : o)) }), snap())
        }
      }
      set({ pendingOverlayBefore: null, revision: get().revision + 1 })
    },

    toggleOverlayKeyframe: (prop) => {
      const id = get().activeOverlayId
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const before = snap()
      const at = Math.max(0, get().currentTime - overlay.start)
      const current = animAt(overlay.keyframes, at, overlay.base)[prop]
      const has = overlay.keyframes[prop].some((k) => Math.abs(k.t - at) < 0.05)
      const keyframes = { ...overlay.keyframes }
      keyframes[prop] = has
        ? overlay.keyframes[prop].filter((k) => Math.abs(k.t - at) >= 0.05)
        : upsertKeyframe(overlay.keyframes[prop], at, clampAnimValue(prop, current))
      const next = { ...overlay, keyframes }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(has ? 'Remove keyframe' : 'Add keyframe', before, snap({ overlays: overlaysNext }))
      set({ overlays: overlaysNext, pendingOverlayBefore: null, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayTiming: (id, start, duration) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const next: OverlayClip = { ...overlay, start: Math.max(0, start), duration: Math.max(MIN_OVERLAY_OUT, duration) }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      // Dragging fires this continuously — coalesce so a gesture is one undo step.
      get().history.recordCoalesced(get().activeClipId ?? 'sequence', 'Overlay timing', snap({ overlays: get().overlays }), snap({ overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayAnim: (id, which, preset) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay) return
      const before = snap()
      const next: OverlayClip = which === 'in'
        ? { ...overlay, animIn: preset }
        : { ...overlay, animOut: preset }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(which === 'in' ? 'In animation' : 'Out animation', before, snap({ overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayMuted: (id, muted) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay || overlay.kind !== 'video') return
      const before = snap()
      const next: OverlayClip = { ...overlay, muted }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      recordHistory(muted ? 'Mute layer audio' : 'Unmute layer audio', before, snap({ overlays: overlaysNext }))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    setOverlayText: (id, text) => {
      const overlay = get().overlays.find((o) => o.id === id)
      if (!overlay || overlay.kind !== 'text') return
      if (!get().pendingOverlayBefore) set({ pendingOverlayBefore: overlay })
      const next = { ...overlay, text: text.slice(0, 140) }
      const overlaysNext = get().overlays.map((o) => (o.id === id ? next : o))
      set({ overlays: overlaysNext, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, overlaysNext)
    },

    // ------------------------------------------------- clip camera keyframes

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
      persist(sequenceNext, get().music, id)
    },

    commitClipAnim: () => {
      const { pendingAnimBefore } = get()
      if (pendingAnimBefore) {
        const after = get().sequence.find((c) => c.id === pendingAnimBefore.id)
        if (after && JSON.stringify(after) !== JSON.stringify(pendingAnimBefore)) {
          recordHistory(
            'Camera keyframe',
            snap({ clips: get().sequence.map((c) => (c.id === after.id ? pendingAnimBefore : c)) }),
            snap(),
          )
        }
      }
      set({ pendingAnimBefore: null, revision: get().revision + 1 })
    },

    toggleClipKeyframe: (prop) => {
      const id = get().activeClipId
      const clip = get().sequence.find((c) => c.id === id)
      if (!clip) return
      const before = snap()
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
      recordHistory(has ? 'Remove keyframe' : 'Add keyframe', before, snap({ clips: sequenceNext }))
      set({ sequence: sequenceNext, clip: clipNext, pendingAnimBefore: null, revision: get().revision + 1 })
      persist(sequenceNext, get().music, id)
    },

    splitAtPlayhead: () => {
      const { sequence, currentTime, durations } = get()
      const before = snap()
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
      recordHistory('Split', before, snap({ clips: next }))
      set({ sequence: next, activeClipId: target, clip, doc: clip?.edit ?? null, revision: get().revision + 1 })
      persist(next, get().music, target)
    },

    moveClip: (clipId, dir) => {
      const { sequence, activeClipId } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      const target = index + dir
      if (index < 0 || target < 0 || target >= sequence.length) return
      const before = snap()
      const next = [...sequence]
      ;[next[index], next[target]] = [next[target], next[index]]
      recordHistory(dir < 0 ? 'Move earlier' : 'Move later', before, snap({ clips: next }))
      persist(next, get().music, activeClipId)
      set({ sequence: next, revision: get().revision + 1 })
    },

    reorderClip: (clipId, toIndex) => {
      const { sequence, activeClipId } = get()
      const from = sequence.findIndex((c) => c.id === clipId)
      if (from < 0) return
      const to = Math.max(0, Math.min(sequence.length - 1, Math.round(toIndex)))
      if (to === from) return
      const before = snap()
      const next = [...sequence]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      // Drag fires this continuously — a gesture collapses to one undo step.
      get().history.recordCoalesced(activeClipId ?? 'sequence', 'Reorder clips', before, snap({ clips: next }))
      persist(next, get().music, activeClipId)
      set({ sequence: next, revision: get().revision + 1 })
    },

    duplicateClip: (clipId) => {
      const { sequence } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      if (index < 0) return
      const source = sequence[index]
      const copy: VideoClip = { ...source, id: newClipId(source.assetId), edit: { ...source.edit } }
      const next = [...sequence.slice(0, index + 1), copy, ...sequence.slice(index + 1)]
      recordHistory('Duplicate clip', snap(), snap({ clips: next }))
      set({ sequence: next, activeClipId: copy.id, clip: copy, doc: copy.edit, revision: get().revision + 1 })
      persist(next, get().music, copy.id)
    },

    removeClip: (clipId) => {
      const { sequence, durations } = get()
      const index = sequence.findIndex((c) => c.id === clipId)
      if (index < 0) return
      const before = snap()
      const next = sequence.filter((c) => c.id !== clipId)
      const fallback = next[Math.min(index, next.length - 1)] ?? null
      recordHistory('Delete clip', before, snap({ clips: next }))
      set({
        sequence: next,
        activeClipId: fallback?.id ?? null,
        clip: fallback,
        doc: fallback ? sanitizeVideoEdit(fallback.edit, durations[fallback.assetId] ?? 0) : null,
        revision: get().revision + 1,
      })
      persist(next, get().music, fallback?.id ?? null)
    },

    setMusic: (assetId) => {
      const { sequence } = get()
      const nextMusic: MusicTrack | null = assetId ? { assetId, volume: 40 } : null
      recordHistory(assetId ? 'Add music' : 'Remove music', snap(), snap({ music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(sequence, nextMusic, get().activeClipId)
    },

    setBeats: (beats, bpm) => {
      const music = get().music
      if (!music) return
      const nextMusic = { ...music, beats: beats.slice(0, 2000), bpm: bpm > 0 ? bpm : undefined }
      recordHistory('Detect beats', snap(), snap({ music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(get().sequence, nextMusic, get().activeClipId)
    },

    syncCutsToBeats: () => {
      const { sequence, music, durations } = get()
      const beats = music?.beats
      if (!beats || beats.length === 0) return
      const next = syncCutsToBeats(sequence, durations, beats)
      if (!next) return
      recordHistory('Sync cuts to beats', snap(), snap({ clips: next }))
      set({ sequence: next, revision: get().revision + 1 })
      persist(next, music, get().activeClipId)
      set({ doc: next.find((c) => c.id === get().activeClipId)?.edit ?? null })
    },

    setMusicVolumeLive: (v) => {
      const music = get().music
      if (!music) return
      set({ music: { ...music, volume: Math.max(0, Math.min(100, v)) } })
    },

    commitMusicVolume: () => {
      set({ revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId)
    },

    setMusicDuck: (duck) => {
      const music = get().music
      if (!music) return
      const nextMusic = { ...music, duck }
      recordHistory(duck ? 'Auto-duck on' : 'Auto-duck off', snap(), snap({ music: nextMusic }))
      set({ music: nextMusic, revision: get().revision + 1 })
      persist(get().sequence, nextMusic, get().activeClipId)
    },

    setCanvasLive: (patch) => {
      const current = get().canvas
      if (!get().pendingCanvasBefore) set({ pendingCanvasBefore: current })
      const next = { ...current, ...patch }
      set({ canvas: next, revision: get().revision + 1 })
      persist(get().sequence, get().music, get().activeClipId, get().overlays, next)
    },

    commitCanvas: (label) => {
      const before = get().pendingCanvasBefore
      const after = get().canvas
      set({ pendingCanvasBefore: null })
      if (!before || JSON.stringify(before) === JSON.stringify(after)) return
      recordHistory(label ?? 'Canvas', snap({ canvas: before }), snap({ canvas: after }))
    },

    setPlaying: (v) => set({ playing: v }),
    setTime: (t) => set({ currentTime: Math.max(0, t) }),
    setHistogram: (h) => set({ histogram: h }),
    setBypass: (v) => set({ bypass: v }),
    setExporting: (v) => set({ exporting: v }),
    setProMode: (v) => {
      set({ proMode: v })
      if (typeof localStorage !== 'undefined') localStorage.setItem('frame-studio:proMode', v ? '1' : '0')
    },

    resetEdits: () => {
      const doc = get().doc
      if (!doc || !get().activeClipId) return
      const before = snap()
      const blank = defaultVideoEdit()
      const afterClips = get().sequence.map((c) => (c.id === get().activeClipId ? { ...c, edit: blank } : c))
      recordHistory('Reset all edits', before, snap({ clips: afterClips }))
      writeDoc(blank)
      set({ revision: get().revision + 1 })
      toast('Edits reset', 'The clip is back to its original state', 'success')
    },

    undo: () => {
      const entry = get().history.undo()
      if (!entry) return
      applySnapshot(entry.before)
    },

    redo: () => {
      const entry = get().history.redo()
      if (!entry) return
      applySnapshot(entry.after)
    },

    jumpTo: (entryId) => {
      const entry = get().history.jumpTo(entryId)
      if (!entry) return
      applySnapshot(entry.after)
    },
  }
})

/**
 * Playhead time for heavy inspector panels. The engine clock stays at full
 * frame rate; inspector controls only need ~20 fps, so quantizing here keeps
 * sliders and keyframe readouts responsive without re-rendering the whole
 * panel on every animation frame.
 */
export function useInspectorTime(): number {
  return useVideoEditor((s) => Math.round(s.currentTime * 20) / 20)
}

/** Whether the active clip differs from a fresh one (drives the Reset button). */
export function videoEditsChanged(doc: VideoEditDoc | null, needsTrim = false): boolean {
  if (!doc) return false
  return !isVideoEditNeutral(doc, defaultVideoEdit()) || needsTrim
}
