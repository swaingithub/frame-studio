/**
 * Video editor store — sequence-first. The live state mirrors the active
 * project's `videoSequence`; the active clip's doc is exposed directly so the
 * inspector keeps its slider model. History snapshots span the WHOLE clip
 * list plus music, so undo/redo covers split, reorder, trim, grade, speed,
 * transitions, titles and music with one mechanism.
 *
 * The interface is split into `VideoStateFields` + `VideoActions`; the
 * actions live in `storeSlices/*` (one domain each) and are merged into
 * `useVideoEditor` below.
 */

import { create } from 'zustand'
import { EditHistory } from '../photo/history'
import { defaultCanvasSettings } from './sequenceModel'
import type {
  CanvasSettings,
  MusicTrack,
  OverlayAnimPreset,
  OverlayClip,
  OverlayKind,
  TitlePosition,
  VideoClip,
  VideoTransition,
  VoiceoverClip,
} from './sequenceModel'
import type { AnimBase, SpeedCurve } from './sequenceAnim'
import type { CaptionSegment } from './captions'
import type { ChromaKey, Mask } from '../../core/adjustments/edits'
import type { VideoEditDoc } from './model'
import type { SeqSnapshot } from './storeHelpers'
import { clipActions } from './storeSlices/clipActions'
import { voiceoverActions } from './storeSlices/voiceoverActions'
import { gradeActions } from './storeSlices/gradeActions'
import { transitionActions } from './storeSlices/transitionActions'
import { clipCameraActions } from './storeSlices/clipCameraActions'
import { overlayActions } from './storeSlices/overlayActions'
import { musicActions } from './storeSlices/musicActions'
import { playbackActions } from './storeSlices/playbackActions'
import { titleActions } from './storeSlices/titleActions'
import { historyActions } from './storeSlices/historyActions'

export type { SequenceLayout } from './sequenceModel'
export { layoutOf } from './storeHelpers'
export { videoEditsChanged } from './storeSlices/historyActions'

/** Editor state fields (everything but the actions). */
interface VideoStateFields {
  activeClipId: string | null
  /** The active clip instance (live mirror of the stored one). */
  clip: VideoClip | null
  /** The active clip's edit doc (drives sliders; === clip.edit). */
  doc: VideoEditDoc | null
  /** Live clip list (mirrors project.videoSequence.clips). */
  sequence: VideoClip[]
  /** Voiceover track (Kokoro TTS): plays during export. */
  voiceovers: VoiceoverClip[]
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
}

/** Editor actions — the store's mutators. */
export interface VideoActions {
  /** Builds/adopts the persisted sequence for the current project (idempotent). */
  ensureSequence: () => void
  setActiveClip: (clipId: string | null) => void
  addClip: (assetId: string) => void
  /** Appends a Kokoro-generated voiceover to the timeline (one undo entry). */
  addVoiceover: (assetId: string, duration: number) => void
  removeVoiceover: (id: string) => void
  /** Adds Whisper-transcribed voiceover captions to the timeline overlays. */
  addVoiceoverCaptions: (voiceoverId: string, segments: readonly CaptionSegment[]) => void
  /** Builds a polished, editable YouTube-style montage from project videos. */
  createYouTubeMontage: () => void
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
  /** Drags a keyframe diamond: phase start/move during the drag, end commits one history entry. */
  moveClipKeyframe: (clipId: string, from: number, to: number, phase: 'start' | 'move' | 'end') => void

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

export interface VideoState extends VideoStateFields, VideoActions {}

const initialState: VideoStateFields = {
  activeClipId: null,
  activeOverlayId: null,
  clip: null,
  doc: null,
  sequence: [],
  voiceovers: [],
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
}

/** Merged editor state: the live mirror + the action slices. */
export const useVideoEditor = create<VideoState>()((set, get) => ({
  ...initialState,
  ...clipActions(set, get),
  ...voiceoverActions(set, get),
  ...gradeActions(set, get),
  ...transitionActions(set, get),
  ...clipCameraActions(set, get),
  ...overlayActions(set, get),
  ...musicActions(set, get),
  ...playbackActions(set),
  ...titleActions(set, get),
  ...historyActions(set, get),
}))

/**
 * Playhead time for heavy inspector panels. The engine clock stays at full
 * frame rate; inspector controls only need ~20 fps, so quantizing here keeps
 * sliders and keyframe readouts responsive without re-rendering the whole
 * panel on every animation frame.
 */
export function useInspectorTime(): number {
  return useVideoEditor((s) => Math.round(s.currentTime * 20) / 20)
}
