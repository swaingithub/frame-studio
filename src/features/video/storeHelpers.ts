/**
 * Shared helpers for the video editor store. `set`/`get` come from the Zustand
 * store; the action slices in `storeSlices/*` spread them into `useVideoEditor`.
 */

import { EditHistory } from '../../core/history'
import { useProjectsStore } from '../projects/store'
import type { CanvasSettings, MusicTrack, OverlayClip, SequenceLayout, VideoClip, VoiceoverClip } from './sequenceModel'
import { defaultCanvasSettings, layoutSequence, sanitizeSequence } from './sequenceModel'
import type { Keyframe } from './sequenceAnim'
import type { VideoEditDoc } from './model'
import { sanitizeVideoEdit } from './model'
import type { VideoState } from './store'

/** The Zustand getter for the video editor store. */
export type EditorGet = () => VideoState
/** The Zustand setter — accepts a partial state. */
export type EditorSet = (partial: Partial<VideoState>) => void

/** One undo/redo snapshot: everything that defines the video edit. */
export interface SeqSnapshot {
  clips: VideoClip[]
  overlays: OverlayClip[]
  music: MusicTrack | null
  voiceovers: VoiceoverClip[]
  canvas: CanvasSettings
}

/** Convenience: layout of a live clip list against known durations. */
export function layoutOf(clips: readonly VideoClip[], durations: Record<string, number>): SequenceLayout {
  return layoutSequence(clips, (assetId) => durations[assetId] ?? 0)
}

let clipCounter = 0
export function newClipId(assetId: string): string {
  clipCounter += 1
  return `clip_${assetId}_${clipCounter}_${Math.random().toString(36).slice(2, 7)}`
}

let voiceoverCounter = 0
export function newVoiceoverId(): string {
  voiceoverCounter += 1
  return `voice_${Math.random().toString(36).slice(2, 8)}_${voiceoverCounter}`
}

/** Inserts (or replaces within snap distance) a keyframe, keeps track sorted. */
export function upsertKeyframe(track: Keyframe[], t: number, v: number): Keyframe[] {
  const existing = track.find((k) => Math.abs(k.t - t) <= 0.05)
  const keyframe: Keyframe = existing
    ? { ...existing, v }
    : { id: `kf_${Math.floor(t * 1000)}_${Math.floor(Math.abs(v * 1000))}_${Math.floor(Math.random() * 1000)}`, t, v, ease: 'smooth' }
  const next = track.length > 0 && existing == null ? track.filter((k) => Math.abs(k.t - t) > 0.05) : [...track]
  const without = next.filter((k) => k.id !== keyframe.id)
  without.push(keyframe)
  without.sort((a, b) => a.t - b.t)
  return without
}

/** Snapshot taken when a keyframe-drag gesture starts (one history entry). */
export const kfGesture = { before: null as SeqSnapshot | null }

/**
 * Writes the live sequence + selection back into the project doc. The
 * selection doubles as the legacy `activeVideoId` (asset id) so other
 * views stay coherent, and the active doc lands in `videoEdits`.
 */
export function persist(
  get: EditorGet,
  clips: VideoClip[],
  music: MusicTrack | null,
  activeClipId: string | null,
  overlays?: OverlayClip[],
  canvas?: CanvasSettings,
  voiceovers?: VoiceoverClip[],
): void {
  const s = useProjectsStore.getState()
  const project = s.projects.find((p) => p.id === s.currentId)
  if (!project) return
  const durations = get().durations
  const clean = sanitizeSequence(
    {
      clips,
      music,
      overlays: overlays ?? get().overlays,
      canvas: canvas ?? get().canvas,
      voiceovers: voiceovers ?? get().voiceovers,
    },
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
export function writeDoc(get: EditorGet, set: EditorSet, next: VideoEditDoc): void {
  const { activeClipId, sequence, music } = get()
  if (!activeClipId) return
  const sequenceNext = sequence.map((c) => (c.id === activeClipId ? { ...c, edit: next } : c))
  const clip = sequenceNext.find((c) => c.id === activeClipId) ?? null
  set({ doc: next, clip, sequence: sequenceNext })
  persist(get, sequenceNext, music, activeClipId)
}

/** Full "sequence as it stands now" snapshot. */
export function snap(
  get: EditorGet,
  now?: {
    clips?: VideoClip[]
    music?: MusicTrack | null
    overlays?: OverlayClip[]
    canvas?: CanvasSettings
    voiceovers?: VoiceoverClip[]
  },
): SeqSnapshot {
  const merged = {
    clips: get().sequence,
    music: get().music,
    overlays: get().overlays,
    canvas: get().canvas,
    voiceovers: get().voiceovers,
    ...now,
  }
  return {
    clips: merged.clips,
    music: merged.music,
    overlays: merged.overlays,
    canvas: merged.canvas,
    voiceovers: merged.voiceovers,
  }
}

/** Records a history entry with whole-sequence snapshots. */
export function recordHistory(get: EditorGet, label: string, before: SeqSnapshot, after: SeqSnapshot): void {
  get().history.record(get().activeClipId ?? 'sequence', label, before, after)
}

/** Restores a snapshot (undo/redo/jump) into live state + project. */
export function applySnapshot(get: EditorGet, set: EditorSet, snapshot: SeqSnapshot): void {
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
    voiceovers: snapshot.voiceovers,
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
  persist(get, snapshot.clips, snapshot.music, active, snapshot.overlays, snapshot.canvas, snapshot.voiceovers)
}

/** Adopts a freshly-built sequence doc into the store + persists. */
export function adopt(
  get: EditorGet,
  set: EditorSet,
  sequence: {
    clips: VideoClip[]
    music: MusicTrack | null
    overlays?: OverlayClip[]
    canvas?: CanvasSettings
    voiceovers?: VoiceoverClip[]
  },
  preferredClipId: string | null,
): void {
  const durations = get().durations
  const clip = sequence.clips.find((c) => c.id === preferredClipId) ?? sequence.clips[0] ?? null
  const canvas = sequence.canvas ?? defaultCanvasSettings()
  set({
    sequence: sequence.clips,
    overlays: sequence.overlays ?? [],
    music: sequence.music,
    canvas,
    voiceovers: sequence.voiceovers ?? [],
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
  persist(get, sequence.clips, sequence.music, clip?.id ?? null, sequence.overlays ?? [], canvas, sequence.voiceovers ?? [])
}
