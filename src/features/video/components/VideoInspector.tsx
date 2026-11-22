import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Circle, Diamond, Frame, ListMusic, Trash2, Undo2, Redo2, RotateCcw, Volume2, Gauge, Blend, Type, Music2, Waves, X, Wand, Captions, Sparkles, TriangleAlert, Scissors, User, AudioLines, Zap, Speaker } from 'lucide-react'
import { ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../core/adjustments/registry'
import { statsFromHistogram } from '../../../core/adjustments/presets'
import type { Histogram } from '../../../core/render/histogram'
import { PresetBar } from '../../photo/components/PresetBar'
import { AdjustSlider } from '../../photo/components/AdjustSlider'
import { HistogramView } from '../../photo/components/HistogramView'
import { useAssets, useThumbnail, useAssetBlob } from '../../library/useAssets'
import { useVideoEditor, layoutOf, useInspectorTime, videoEditsChanged } from '../store'
import { useCaptions, type CaptionStatus } from '../useCaptions'
import { generateVoiceover, kokoroVoiceNames } from '../voiceover'
import { transcribeVoiceoverWav } from '../voiceoverCaptions'
import { importFiles } from '../../library/import'
import { toast } from '../../../ui/toastStore'
import { Button } from '../../../ui/button'
import { getBlob } from '../../../core/db/blobStore'
import type { CaptionSegment } from '../captions'
import { MIN_OVERLAY_OUT, OVERLAY_ANIM_LABELS, OVERLAY_ANIM_PRESETS, TRANSITION_LABELS, TRANSITION_TYPES, MAX_TRANSITION, baseAnimAt, CANVAS_ASPECTS, CANVAS_ASPECT_LABELS, CANVAS_COLORS, isOverlapTransition, type CanvasSettings, type VideoClip, type VideoTransition, type TitlePosition, type OverlayClip, type AnimBase, type OverlayAnimPreset } from '../sequenceModel'
import { ANIM_DEFAULTS, ANIM_RANGES, animAt } from '../sequenceAnim'
import { DEFAULT_CHROMA_COLOR, MASK_SHAPES, MASK_SHAPE_LABELS, defaultMask, type Mask } from '../../../core/adjustments/edits'
import { SPEED_CURVES, SPEED_CURVE_LABELS, type VideoEditDoc } from '../model'
import { cn } from '../../../lib/cn'
import { MusicLibraryDialog } from './MusicLibraryDialog'
import { ConvertDialog } from './ConvertDialog'
import { useClipFrame } from '../clipFrame'

/**
 * Right-hand inspector for the video workspace: shared Looks (presets &
 * Auto), the adjustment sections, clip speed, transition, title, volume,
 * sequence music and history.
 */

const sectionLabels: Record<string, string> = {
  light: 'Light',
  color: 'Color',
  detail: 'Detail',
  effects: 'Effects',
}

const speedMarks: { v: number; label: string }[] = [
  { v: 0.25, label: '0.25×' },
  { v: 0.5, label: '0.5×' },
  { v: 1, label: '1×' },
  { v: 1.5, label: '1.5×' },
  { v: 2, label: '2×' },
  { v: 4, label: '4×' },
]

/** Basic ↔ Pro switch: Pro exposes keyframes, speed ramps and camera tools. */
/** Strength dial for the active look on the selected clip. */
function VideoLookStrength(): ReactNode {
  const look = useVideoEditor((s) => s.doc?.look ?? null)
  const editor = useVideoEditor()
  if (!look) return null
  return (
    <AdjustSlider
      param={{ label: 'Look strength', min: 0, max: 1, def: 1, step: 0.01 }}
      value={look.strength}
      onLive={(v) => editor.setLookStrength(v)}
      onCommit={() => editor.commit('Look strength')}
      onReset={() => {
        editor.setLookStrength(1)
        editor.commit('Look strength')
      }}
    />
  )
}

function ModeToggle(): ReactNode {
  const proMode = useVideoEditor((s) => s.proMode)
  const setProMode = useVideoEditor((s) => s.setProMode)
  return (
    <div role="group" aria-label="Editing mode" className="flex items-center gap-1 rounded-lg bg-elevated p-0.5">
      <button
        type="button"
        aria-pressed={!proMode}
        className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', !proMode ? 'bg-accent text-onaccent' : 'text-lo hover:text-hi')}
        onClick={() => setProMode(false)}
      >
        Basic
      </button>
      <button
        type="button"
        aria-pressed={proMode}
        className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', proMode ? 'bg-accent text-onaccent' : 'text-lo hover:text-hi')}
        onClick={() => setProMode(true)}
      >
        Pro
      </button>
    </div>
  )
}

export function VideoInspectorBody({ histogram, simpleMode = true }: { histogram: Histogram | null; simpleMode?: boolean }): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const clip = useVideoEditor((s) => s.clip)
  const proMode = useVideoEditor((s) => s.proMode)
  const isFirstClip = useVideoEditor((s) => s.sequence[0]?.id !== undefined && s.sequence[0]?.id === (s.clip?.id ?? ''))
  const setAdjustment = useVideoEditor((s) => s.setAdjustment)
  const commit = useVideoEditor((s) => s.commit)
  const applyAdjustments = useVideoEditor((s) => s.applyAdjustments)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const stats = histogram ? statsFromHistogram(histogram.l, histogram.samples) : null
  const clipFrame = useClipFrame(clip?.id ?? null, clip?.assetId ?? null)
  const musicSection = <MusicSection />
  const canvasSection = <CanvasControls />
  const historySection = (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-lo">History</h3>
        <VideoHistoryButtons />
        <ResetButton />
      </div>
      <VideoHistoryList />
    </section>
  )

  const activeOverlayId = useVideoEditor((s) => s.activeOverlayId)
  const activeOverlay = useVideoEditor((s) => s.overlays.find((o) => o.id === s.activeOverlayId) ?? null)
  if (activeOverlayId !== null) {
    return (
      <div className="flex flex-col gap-4">
        {activeOverlay ? <OverlayControls overlay={activeOverlay} proMode={proMode} /> : null}
        <CaptionsControls />
        {canvasSection}
        {musicSection}
        {historySection}
      </div>
    )
  }

  if (!clip || !doc) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <ModeToggle />
        </div>
        <p className="rounded-lg border border-dashed border-line p-3 text-xs text-lo">
          Select a clip on the timeline to grade it. Looks, speed, transitions, titles and audio appear here.
        </p>
        {canvasSection}
        {musicSection}
        {historySection}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-lo">Edit clip</span>
        <ModeToggle />
      </div>

      <ConvertControls />

      <HistogramView histogram={histogram} />

      <PresetBar
        stats={stats}
        onApply={applyAdjustments}
        source={clipFrame}
        sourceKey={clip?.id}
      />

      <VideoLookStrength />

      <SpeedControls doc={doc} />

      {!simpleMode && proMode ? <RampControls doc={doc} /> : null}

      {!simpleMode && proMode ? <CameraControls clip={clip} /> : null}

      {!simpleMode && proMode ? <ChromaKeyControls /> : null}

      {!simpleMode && proMode ? <MaskControls /> : null}

      <BgRemoveControls />

      <VoiceoverSection />

      <TransitionControls transition={clip.transition} duration={clip.transitionDuration} isFirst={isFirstClip} />

      <CaptionsControls />

      <TitleControls clipId={clip.id} />

      {ADJUSTMENT_SECTIONS.map((section) => {
        const params = ADJUSTMENTS.filter((p) => p.section === section)
        const isCollapsed = collapsed[section] === true
        const isTouched = params.some((p) => doc.adjustments[p.key] !== p.def)
        return (
          <section key={section} className="rounded-xl border border-line/70 bg-elevated/35 p-3">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [section]: !c[section] }))}
              className="mb-2 flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo hover:text-hi"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
              {sectionLabels[section]}
              {isTouched ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Adjusted" /> : null}
            </button>
            {!isCollapsed ? (
              <div className="flex flex-col gap-2.5">
                {params.map((param) => (
                  <AdjustSlider
                    key={param.key}
                    param={param}
                    value={doc.adjustments[param.key]}
                    onLive={(v) => setAdjustment(param.key, v)}
                    onCommit={() => commit(param.label)}
                    onReset={() => {
                      setAdjustment(param.key, param.def)
                      commit(`${param.label} reset`)
                    }}
                  />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}

      <AudioControls doc={doc} />

      {canvasSection}
      {musicSection}
      {historySection}
    </div>
  )
}

function Heading({ icon, children }: { icon: ReactNode; children: ReactNode }): ReactNode {
  return (
    <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
      {icon}
      {children}
    </h3>
  )
}

/** Diamond toggle: on = a keyframe exists at the playhead for that property. */
function KeyButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title="Add/remove keyframe at playhead"
      className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md disabled:opacity-30', active ? 'text-accent' : 'text-lo hover:bg-hover hover:text-hi')}
      onClick={onClick}
    >
      <Diamond size={11} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}

/** Slider row + keyframe diamond for one animatable overlay/clip property. */
function AnimSliderRow({
  label,
  prop,
  value,
  hasKey,
  onLive,
  onCommit,
  onReset,
  onToggleKey,
}: {
  label: string
  prop: keyof AnimBase
  value: number
  hasKey: boolean
  onLive: (v: number) => void
  onCommit: () => void
  onReset: () => void
  onToggleKey: () => void
}): ReactNode {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <AdjustSlider
          param={{ label, min: ANIM_RANGES[prop].min, max: ANIM_RANGES[prop].max, def: ANIM_DEFAULTS[prop], step: 0.01 }}
          value={value}
          onLive={onLive}
          onCommit={() => onCommit()}
          onReset={onReset}
        />
      </div>
      <KeyButton active={hasKey} label={`${label} keyframe`} onClick={onToggleKey} />
    </div>
  )
}

/** Inspector for the selected overlay layer: text, transform, timing, layering. */
function OverlayControls({ overlay, proMode }: { overlay: OverlayClip; proMode: boolean }): ReactNode {
  const currentTime = useInspectorTime()
  const clips = useVideoEditor((s) => s.sequence)
  const durations = useVideoEditor((s) => s.durations)
  const setOverlayProps = useVideoEditor((s) => s.setOverlayProps)
  const commitOverlayProps = useVideoEditor((s) => s.commitOverlayProps)
  const toggleOverlayKeyframe = useVideoEditor((s) => s.toggleOverlayKeyframe)
  const setOverlayTiming = useVideoEditor((s) => s.setOverlayTiming)
  const setOverlayText = useVideoEditor((s) => s.setOverlayText)
  const commitOverlayText = useVideoEditor((s) => s.commitOverlayProps)
  const moveOverlay = useVideoEditor((s) => s.moveOverlay)
  const removeOverlay = useVideoEditor((s) => s.removeOverlay)
  const setOverlayAnim = useVideoEditor((s) => s.setOverlayAnim)
  const setActiveOverlay = useVideoEditor((s) => s.setActiveOverlay)
  const [draft, setDraft] = useState<string | null>(null)

  const total = useMemo(() => Math.max(1, layoutOf(clips, durations).total), [clips, durations])
  const at = Math.max(0, currentTime - overlay.start)
  const anim = animAt(overlay.keyframes, at, overlay.base)
  const keyAt = (prop: keyof AnimBase): boolean => overlay.keyframes[prop].some((k) => Math.abs(k.t - at) < 0.05)

  return (
    <section aria-label="Overlay controls">
      <Heading icon={<Type size={11} />}>Overlay layer</Heading>
      {overlay.kind === 'text' ? (
        <input
          type="text"
          aria-label="Overlay text"
          value={draft ?? overlay.text ?? ''}
          onChange={(e) => {
            setDraft(e.target.value)
            setOverlayText(overlay.id, e.target.value)
          }}
          onBlur={() => {
            setDraft(null)
            commitOverlayText()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="mb-2 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none placeholder:text-lo focus-visible:border-accent"
          placeholder="Overlay text…"
        />
      ) : null}

      {/* Intro/outro motion — available in both modes, like CapCut's presets. */}
      <div className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-wide text-lo" aria-hidden>
        Animation
      </div>
      {(['in', 'out'] as const).map((which) => {
        const current: OverlayAnimPreset = (which === 'in' ? overlay.animIn : overlay.animOut) ?? 'none'
        return (
          <div key={which} className="mb-1.5">
            <div className="mb-1 text-[10px] text-lo" aria-hidden>{which === 'in' ? 'In' : 'Out'}</div>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label={`${which === 'in' ? 'In' : 'Out'} animation`}>
              {OVERLAY_ANIM_PRESETS.filter((p) => which === 'in' || p !== 'typewriter').map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={current === preset}
                  onClick={() => setOverlayAnim(overlay.id, which, preset)}
                  className={cn(
                    'rounded-md px-1 py-1 text-[10px] font-medium transition-colors',
                    current === preset ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                  )}
                >
                  {OVERLAY_ANIM_LABELS[preset]}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {proMode ? (
        <>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-lo" aria-hidden>
            Transform (at playhead)
          </div>
          <AnimSliderRow
            label="Scale"
            prop="scale"
            value={anim.scale}
            hasKey={keyAt('scale')}
            onLive={(v) => setOverlayProps({ scale: v })}
            onCommit={commitOverlayProps}
            onReset={() => {
              setOverlayProps({ scale: overlay.base.scale })
              commitOverlayProps()
            }}
            onToggleKey={() => toggleOverlayKeyframe('scale')}
          />
          <AnimSliderRow
            label="X position"
            prop="x"
            value={anim.x}
            hasKey={keyAt('x')}
            onLive={(v) => setOverlayProps({ x: v })}
            onCommit={commitOverlayProps}
            onReset={() => {
              setOverlayProps({ x: overlay.base.x })
              commitOverlayProps()
            }}
            onToggleKey={() => toggleOverlayKeyframe('x')}
          />
          <AnimSliderRow
            label="Y position"
            prop="y"
            value={anim.y}
            hasKey={keyAt('y')}
            onLive={(v) => setOverlayProps({ y: v })}
            onCommit={commitOverlayProps}
            onReset={() => {
              setOverlayProps({ y: overlay.base.y })
              commitOverlayProps()
            }}
            onToggleKey={() => toggleOverlayKeyframe('y')}
          />
          <AnimSliderRow
            label="Opacity"
            prop="opacity"
            value={anim.opacity}
            hasKey={keyAt('opacity')}
            onLive={(v) => setOverlayProps({ opacity: v })}
            onCommit={commitOverlayProps}
            onReset={() => {
              setOverlayProps({ opacity: overlay.base.opacity })
              commitOverlayProps()
            }}
            onToggleKey={() => toggleOverlayKeyframe('opacity')}
          />
        </>
      ) : (
        <p className="mb-2 text-[11px] text-lo" aria-hidden>
          🖐 Drag the layer on the preview to place it. Use <span className="text-hi">Pro mode</span> for size, opacity and animation.
        </p>
      )}

      <div className="mt-3 mb-1 text-[10px] font-medium uppercase tracking-wide text-lo" aria-hidden>
        Timing
      </div>
      <AdjustSlider
        param={{ label: 'Start at', min: 0, max: total, def: 0, step: 0.1 }}
        value={overlay.start}
        onLive={(v) => setOverlayTiming(overlay.id, v, overlay.duration)}
        onCommit={() => undefined}
        onReset={() => setOverlayTiming(overlay.id, 0, overlay.duration)}
      />
      <AdjustSlider
        param={{ label: 'Length', min: MIN_OVERLAY_OUT, max: Math.max(3, total), def: 3, step: 0.1 }}
        value={overlay.duration}
        onLive={(v) => setOverlayTiming(overlay.id, overlay.start, v)}
        onCommit={() => undefined}
        onReset={() => setOverlayTiming(overlay.id, overlay.start, 3)}
      />

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          title="Move layer down (behind)"
          aria-label="Move overlay layer behind"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-lo hover:bg-hover hover:text-hi"
          onClick={() => moveOverlay(overlay.id, -1)}
        >
          <ArrowDown size={11} />
          Behind
        </button>
        <button
          type="button"
          title="Move layer up (in front)"
          aria-label="Move overlay layer in front"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-lo hover:bg-hover hover:text-hi"
          onClick={() => moveOverlay(overlay.id, 1)}
        >
          <ArrowUp size={11} />
          In front
        </button>
        <button
          type="button"
          title="Delete overlay layer"
          aria-label="Delete overlay"
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-danger hover:bg-hover"
          onClick={() => removeOverlay(overlay.id)}
        >
          <Trash2 size={11} />
          Delete
        </button>
        <button
          type="button"
          aria-label="Back to clip editing"
          className="rounded-md px-1.5 py-1 text-[11px] text-lo hover:bg-hover hover:text-hi"
          onClick={() => setActiveOverlay(null)}
        >
          Done
        </button>
      </div>
      <p className="mt-1 text-[10px] text-lo" aria-hidden>
        Once a diamond is filled, sliders drag that keyframe at the playhead.
      </p>
    </section>
  )
}

/** Keyframed camera (zoom/pan) on the selected base-track clip. */
function CameraControls({ clip }: { clip: VideoClip }): ReactNode {
  const currentTime = useInspectorTime()
  const clips = useVideoEditor((s) => s.sequence)
  const durations = useVideoEditor((s) => s.durations)
  const setClipAnim = useVideoEditor((s) => s.setClipAnim)
  const commitClipAnim = useVideoEditor((s) => s.commitClipAnim)
  const toggleClipKeyframe = useVideoEditor((s) => s.toggleClipKeyframe)

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])
  const entry = layout.entries.find((e) => e.clip.id === clip.id)
  const at = entry ? Math.max(0, Math.min(entry.out, currentTime - entry.globalStart)) : 0
  const anim = baseAnimAt(clip, at)
  const keyAt = (prop: keyof AnimBase): boolean => (clip.keyframes?.[prop].some((k) => Math.abs(k.t - at) < 0.05) ?? false)

  return (
    <section aria-label="Camera controls">
      <Heading icon={<Frame size={11} />}>Camera</Heading>
      <AnimSliderRow
        label="Zoom"
        prop="scale"
        value={anim.scale}
        hasKey={keyAt('scale')}
        onLive={(v) => setClipAnim({ scale: Math.max(1, v) })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ scale: 1 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('scale')}
      />
      <AnimSliderRow
        label="Pan X"
        prop="x"
        value={anim.x}
        hasKey={keyAt('x')}
        onLive={(v) => setClipAnim({ x: v })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ x: 0.5 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('x')}
      />
      <AnimSliderRow
        label="Pan Y"
        prop="y"
        value={anim.y}
        hasKey={keyAt('y')}
        onLive={(v) => setClipAnim({ y: v })}
        onCommit={commitClipAnim}
        onReset={() => {
          setClipAnim({ y: 0.5 })
          commitClipAnim()
        }}
        onToggleKey={() => toggleClipKeyframe('y')}
      />
      <p className="mt-1 text-[10px] text-lo" aria-hidden>
        Add two diamonds at different times for a smooth zoom/pan auto-curve.
      </p>
    </section>
  )
}

/** Ease curve chips INSIDE one clip: mean-normalized, so lengths never shift. */
function RampControls({ doc }: { doc: VideoEditDoc }): ReactNode {
  const setRamp = useVideoEditor((s) => s.setRamp)
  return (
    <section>
      <Heading icon={<Waves size={11} />}>Speed ramp</Heading>
      <div className="flex flex-wrap gap-1">
        {SPEED_CURVES.map((curve) => (
          <button
            key={curve}
            type="button"
            aria-pressed={doc.speedCurve === curve}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              doc.speedCurve === curve ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onClick={() => setRamp(curve)}
          >
            {SPEED_CURVE_LABELS[curve]}
          </button>
        ))}
      </div>
    </section>
  )
}

function SpeedControls({ doc }: { doc: VideoEditDoc }): ReactNode {
  const setSpeedLive = useVideoEditor((s) => s.setSpeedLive)
  const commitSpeed = useVideoEditor((s) => s.commitSpeed)
  return (
    <section>
      <Heading icon={<Gauge size={11} />}>Speed</Heading>
      <div className="flex flex-wrap gap-1">
        {speedMarks.map((mark) => (
          <button
            key={mark.v}
            type="button"
            aria-pressed={Math.abs(doc.speed - mark.v) < 0.01}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              Math.abs(doc.speed - mark.v) < 0.01 ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onPointerDown={() => setSpeedLive(mark.v)}
            onPointerUp={() => commitSpeed()}
            onPointerLeave={() => commitSpeed()}
          >
            {mark.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Chroma key presets (chroma-green, blue screen, magenta, cyan, white, black). */
const CHROMA_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: 'Green', color: [0.0, 0.69, 0.25] },
  { label: 'Blue', color: [0.04, 0.38, 0.82] },
  { label: 'Magenta', color: [0.66, 0.1, 0.6] },
  { label: 'Cyan', color: [0.12, 0.62, 0.68] },
  { label: 'White', color: [1.0, 1.0, 1.0] },
  { label: 'Black', color: [0.0, 0.0, 0.0] },
]

function chromaCss(color: readonly [number, number, number]): string {
  const to255 = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgb(${to255(color[0])} ${to255(color[1])} ${to255(color[2])})`
}

/** Green screen removal on the selected clip (Pro mode). */
function ChromaKeyControls(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const setChromaKey = useVideoEditor((s) => s.setChromaKey)
  const commit = useVideoEditor((s) => s.commit)
  const key = doc?.chromaKey ?? null

  if (!doc) return null
  const active = key?.enabled ?? false
  const color = key?.color ?? DEFAULT_CHROMA_COLOR

  const pick = (c: [number, number, number]): void => {
    setChromaKey(key ? { color: c } : { color: c, enabled: true })
    commit('Chroma key')
  }
  const toggle = (): void => {
    setChromaKey({ enabled: !active })
    commit('Chroma key')
  }

  return (
    <section aria-label="Chroma key controls">
      <Heading icon={<Wand size={11} />}>Chroma key</Heading>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={toggle}
          className={cn(
            'h-4 w-8 rounded-full px-0.5 transition-colors',
            active ? 'bg-accent' : 'bg-elevated ring-1 ring-line',
          )}
        >
          <span
            className={cn('block h-3 w-3 rounded-full bg-white transition-transform', active && 'translate-x-4')}
            aria-hidden
          />
        </button>
        <span className="text-[11px] text-hi/90">{active ? 'Removing' : 'Off'}</span>
      </div>
      {active ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Key color">
            {CHROMA_PRESETS.map((preset) => {
              const selected = key ? (Math.abs(preset.color[0] - color[0]) < 0.02 && Math.abs(preset.color[1] - color[1]) < 0.02 && Math.abs(preset.color[2] - color[2]) < 0.02) : false
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={selected}
                  title={`${preset.label} screen`}
                  onClick={() => pick(preset.color)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    selected ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/25" style={{ background: chromaCss(preset.color) }} aria-hidden />
                  {preset.label}
                </button>
              )
            })}
          </div>
          {/* Sliders commit on release via pointerup/leave — one undo entry. */}
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Similarity</span>
            <input
              type="range"
              min={0}
              max={0.35}
              step={0.01}
              value={key ? key.similarity : 0.3}
              aria-label="Key similarity"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ similarity: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.similarity.toFixed(2) : '—'}</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Smoothness</span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.01}
              value={key ? key.smoothness : 0.08}
              aria-label="Key edge smoothness"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ smoothness: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.smoothness.toFixed(2) : '—'}</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">De-spill</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={key ? key.spill : 0.25}
              aria-label="Spill suppression"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ spill: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.spill.toFixed(2) : '—'}</span>
          </label>
          <p className="text-[10px] text-lo" aria-hidden>
            Pick the screen color, then tune Similarity until the backdrop disappears cleanly.
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-lo" aria-hidden>
          Film your subject on a solid screen, turn this on, and the screen drops away.
        </p>
      )}
    </section>
  )
}

/** Shape mask on the selected clip (Pro mode). */
/** Video converter (CapCut-style tool): re-encode to another format/size. */
function ConvertControls(): ReactNode {
  const clip = useVideoEditor((s) => s.clip)
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Convert">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi transition-colors hover:bg-hover"
      >
        <Zap size={12} /> Convert
      </button>
      <ConvertDialog assetId={clip?.assetId ?? null} open={open} onClose={() => setOpen(false)} />
    </section>
  )
}

/** Voiceover: generate Kokoro speech from pasted text, added to the timeline. */
function VoiceoverSection(): ReactNode {
  const addVoiceover = useVideoEditor((s) => s.addVoiceover)
  const addVoiceoverCaptions = useVideoEditor((s) => s.addVoiceoverCaptions)
  const voiceovers = useVideoEditor((s) => s.voiceovers)
  const assets = useAssets()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('af_heart')
  const [voices, setVoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState<{ voiceoverId: string; text: string; segments: CaptionSegment[] } | null>(null)
  const [transcribingId, setTranscribingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void kokoroVoiceNames()
      .then((names) => {
        if (!alive) return
        setVoices(names)
        setVoice((v) => (names.includes(v) ? v : (names[0] ?? v)))
      })
      .catch((err) => console.error('Kokoro voices unavailable', err))
    return () => {
      alive = false
    }
  }, [])

  async function generate(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const { blob, duration } = await generateVoiceover(trimmed, voice)
      const name = `voiceover-${new Date().toISOString().replace(/[:.]/g, '')}.wav`
      const { imported } = await importFiles([new File([blob], name, { type: 'audio/wav' })])
      const assetId = imported[0]?.id
      if (assetId) {
        addVoiceover(assetId, duration)
        toast('Voiceover added', `"${trimmed.slice(0, 24)}" — added to the timeline at the end of the video.`, 'success')
        setText('')
      }
    } catch (err) {
      toast('Voiceover failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function transcribe(voiceoverId: string): Promise<void> {
    setTranscribingId(voiceoverId)
    try {
      const asset = (assets ?? []).find((a) => a.id === voiceovers.find((v) => v.id === voiceoverId)?.assetId)
      if (!asset) throw new Error('Voiceover asset not found.')
      const blob = await getBlob({ key: asset.storageKey, storage: asset.storage ?? 'idb' })
      if (!blob) throw new Error('Voiceover audio not available.')
      const segments = await transcribeVoiceoverWav(blob)
      setTranscript({ voiceoverId, text: segments.map((s) => s.text).join(' '), segments })
    } catch (err) {
      toast('Transcription failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setTranscribingId(null)
    }
  }

  function addTranscript(): void {
    if (!transcript) return
    addVoiceoverCaptions(transcript.voiceoverId, transcript.segments)
    setTranscript(null)
    toast('Voiceover captions added', 'Captions were added to the timeline as text overlays.', 'success')
  }

  return (
    <section aria-label="Voiceover">
      <Heading icon={<Speaker size={11} />}>Voiceover</Heading>
      <p className="mt-1.5 text-[10px] text-lo">
        Generates speech from text — Kokoro, on-device (first use downloads ~92 MB).
      </p>
      <div className="mt-2 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Type the voiceover text…"
          aria-label="Voiceover text"
          className="w-full resize-none rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
        />
        <div className="flex items-center gap-2">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={voices.length === 0}
            aria-label="Voiceover voice"
            className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
          >
            {voices.length === 0 ? (
              <option value="">Loading voices…</option>
            ) : (
              voices.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, ' ')}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={busy || voices.length === 0 || !text.trim()}
            onClick={() => void generate()}
            className="fs-tool-hit shrink-0 rounded-md border border-dashed border-accent/50 bg-panel px-2.5 py-1.5 text-[11px] font-medium text-hi transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {/* Captions: transcribe a voiceover to timeline captions (Whisper). */}
        {voiceovers.length > 0 ? (
          <div className="mt-2 space-y-2 border-t border-line pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-lo">Captions</span>
            {transcript ? (
              <div className="rounded-md border border-line bg-elevated px-2 py-1.5">
                <p className="max-h-28 overflow-y-auto text-[10px] leading-relaxed text-hi">{transcript.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-lo">
                    {transcript.segments.length} segment{transcript.segments.length === 1 ? '' : 's'} — Whisper, on-device
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="subtle" size="sm" onClick={() => setTranscript(null)}>
                      Dismiss
                    </Button>
                    <Button variant="primary" size="sm" onClick={addTranscript}>
                      Add to timeline
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <select
                value={transcript?.voiceoverId ?? ''}
                onChange={(e) => {
                  if (e.target.value) void transcribe(e.target.value)
                }}
                disabled={transcribingId !== null}
                aria-label="Transcribe voiceover"
                className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
              >
                <option value="">Transcribe a voiceover…</option>
                {voiceovers.map((v) => {
                  const name = (assets ?? []).find((a) => a.id === v.assetId)?.name ?? v.id
                  return (
                    <option key={v.id} value={v.id}>
                      {v.id === transcript?.voiceoverId ? '✓ ' : ''}
                      {name}
                    </option>
                  )
                })}
              </select>
              {transcribingId ? <span className="text-[10px] text-lo">Transcribing…</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * AI background removal: one toggle per clip. The subject (people) is cut
 * out by a small segmentation model that downloads once, on first use, and
 * then runs fully offline — the download is clearly labelled here.
 */
function BgRemoveControls(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const setBgRemove = useVideoEditor((s) => s.setBgRemove)
  if (!doc) return null
  const on = doc.bgRemove === true
  return (
    <section aria-label="Background removal">
      <Heading icon={<Scissors size={11} />}>Background removal</Heading>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setBgRemove(!on)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
          on ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
        )}
      >
        <span className="flex items-center gap-1.5">
          <User size={12} />
          {on ? 'Subject cut out' : 'Cut out subject'}
        </span>
        <span className={cn('text-[10px]', on ? 'text-onaccent/70' : 'text-lo')}>
          {on ? 'On' : 'Off'}
        </span>
      </button>
      {!on ? (
        <p className="mt-1.5 text-[10px] leading-snug text-lo">
          Keeps people, drops the rest. First use downloads a small model (~250 KB) — after that it runs offline on this device.
        </p>
      ) : null}
    </section>
  )
}

function MaskControls(): ReactNode {  const doc = useVideoEditor((s) => s.doc)
  const setMask = useVideoEditor((s) => s.setMask)
  const commit = useVideoEditor((s) => s.commit)
  const mask = doc?.mask ?? null
  if (!doc) return null

  const shape = mask?.shape ?? 'none'
  const m = mask ?? defaultMask()
  const patch = (p: Partial<Mask>): void => setMask(p)
  const commitMask = (): void => commit('Mask')
  const reset = (p: Partial<Mask>): void => {
    setMask(p)
    commit('Mask')
  }

  return (
    <section aria-label="Mask controls">
      <Heading icon={<Circle size={11} />}>Mask</Heading>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Mask shape">
        {MASK_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            onClick={() => {
              setMask({ shape: s })
              commit('Mask')
            }}
            className={cn(
              'rounded-md px-1 py-1 text-[10px] font-medium transition-colors',
              shape === s ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
          >
            {MASK_SHAPE_LABELS[s]}
          </button>
        ))}
      </div>

      {shape !== 'none' ? (
        <div className="mt-2 flex flex-col gap-1">
          <AdjustSlider param={{ label: 'X', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.x}
            onLive={(v) => patch({ x: v })} onCommit={commitMask} onReset={() => reset({ x: 0.5 })} />
          <AdjustSlider param={{ label: 'Y', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.y}
            onLive={(v) => patch({ y: v })} onCommit={commitMask} onReset={() => reset({ y: 0.5 })} />
          <AdjustSlider param={{ label: 'Width', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.w}
            onLive={(v) => patch({ w: v })} onCommit={commitMask} onReset={() => reset({ w: 0.6 })} />
          <AdjustSlider param={{ label: 'Height', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.h}
            onLive={(v) => patch({ h: v })} onCommit={commitMask} onReset={() => reset({ h: 0.6 })} />
          <AdjustSlider param={{ label: 'Rotation', min: -180, max: 180, def: 0, step: 1 }} value={m.rotation}
            onLive={(v) => patch({ rotation: v })} onCommit={commitMask} onReset={() => reset({ rotation: 0 })} />
          <AdjustSlider param={{ label: 'Feather', min: 0, max: 0.4, def: 0.08, step: 0.01 }} value={m.feather}
            onLive={(v) => patch({ feather: v })} onCommit={commitMask} onReset={() => reset({ feather: 0.08 })} />

          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={m.invert}
              onClick={() => {
                setMask({ invert: !m.invert })
                commit('Mask')
              }}
              className={cn(
                'h-4 w-8 rounded-full px-0.5 transition-colors',
                m.invert ? 'bg-accent' : 'bg-elevated ring-1 ring-line',
              )}
            >
              <span
                className={cn('block h-3 w-3 rounded-full bg-white transition-transform', m.invert && 'translate-x-4')}
                aria-hidden
              />
            </button>
            <span className="text-[11px] text-hi/90">Invert mask</span>
          </div>
          <p className="text-[10px] text-lo" aria-hidden>
            Only the area inside the shape stays visible. Feather softens its edges.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-lo" aria-hidden>
          Add a shape to reveal just part of the frame — great for circles, slits and creative wipes.
        </p>
      )}
    </section>
  )
}

function TransitionControls({
  transition,
  duration,
  isFirst,
}: {
  transition: VideoTransition
  duration: number
  isFirst: boolean
}): ReactNode {
  const setTransition = useVideoEditor((s) => s.setTransition)
  const setTransitionDurationLive = useVideoEditor((s) => s.setTransitionDurationLive)
  const commitTransitionDuration = useVideoEditor((s) => s.commitTransitionDuration)
  const overlap = isOverlapTransition(transition) && !isFirst
  return (
    <section>
      <Heading icon={<Blend size={11} />}>
        Transition in {isFirst ? '(start of film)' : ''}
      </Heading>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Transition type">
        {TRANSITION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={transition === type}
            disabled={isFirst && isOverlapTransition(type)}
            title={
              isFirst && isOverlapTransition(type)
                ? 'The first clip has no previous clip to overlap — fades still work as a fade-in'
                : TRANSITION_LABELS[type]
            }
            className={cn(
              'truncate rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-30',
              transition === type ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onClick={() => setTransition(type)}
          >
            {TRANSITION_LABELS[type]}
          </button>
        ))}
      </div>
      {overlap ? (
        <>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Length</span>
            <input
              type="range"
              min={0.1}
              max={MAX_TRANSITION}
              step={0.1}
              value={duration}
              aria-label="Transition length"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setTransitionDurationLive(Number((e.target as HTMLInputElement).value))}
              onPointerUp={() => commitTransitionDuration()}
              onPointerLeave={() => commitTransitionDuration()}
              onKeyUp={() => commitTransitionDuration()}
            />
            <span className="w-8 shrink-0 text-right tabular-nums text-hi/80">{duration.toFixed(1)}s</span>
          </label>
          <p className="mt-1 text-[10px] leading-snug text-lo">
            Plays both clips at once; capped at half of the shorter neighbour.
          </p>
        </>
      ) : null}
    </section>
  )
}

const CAPTION_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto-detect' },
  { value: 'english', label: 'English' },
  { value: 'chinese', label: '中文' },
  { value: 'japanese', label: '日本語' },
  { value: 'korean', label: '한국어' },
  { value: 'spanish', label: 'Español' },
  { value: 'french', label: 'Français' },
  { value: 'german', label: 'Deutsch' },
  { value: 'portuguese', label: 'Português' },
  { value: 'russian', label: 'Русский' },
]

const STATUS_LABELS: Record<CaptionStatus, string> = {
  idle: '',
  'loading-model': 'Loading speech model…',
  decoding: 'Reading audio…',
  transcribing: 'Transcribing…',
  done: 'Captions added to the timeline',
  error: '',
}

/**
 * Auto-captions: transcribes every clip's audio locally (Whisper WASM in a
 * worker) and lays the chunks onto the timeline as text overlays. The model
 * downloads once on first use, then runs fully offline.
 */
function CaptionsControls(): ReactNode {
  const hasCaptions = useVideoEditor((s) => s.overlays.some((o) => o.caption))
  const clearCaptions = useVideoEditor((s) => s.clearCaptions)
  const { status, progress, error, busy, generate } = useCaptions()
  const [language, setLanguage] = useState('')

  const firstUse = status === 'loading-model'
  return (
    <section>
      <Heading icon={<Captions size={11} />}>
        Auto captions
      </Heading>
      <div className="flex items-center gap-1.5">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label="Caption language"
          disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none"
        >
          {CAPTION_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate(language || undefined)}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-onaccent hover:brightness-110 disabled:opacity-40"
        >
          <Sparkles size={12} />
          {hasCaptions ? 'Regenerate' : 'Generate'}
        </button>
        {hasCaptions && !busy ? (
          <button
            type="button"
            onClick={clearCaptions}
            aria-label="Remove captions"
            title="Remove captions"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elevated text-lo hover:bg-hover hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
      </div>
      {busy ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label="Caption progress">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {STATUS_LABELS[status] ? <p className="mt-1.5 text-[10px] text-lo">{STATUS_LABELS[status]}</p> : null}
      {firstUse ? (
        <p className="mt-1.5 text-[10px] leading-snug text-lo">
          First run downloads the speech model (~40 MB) — after that it stays on this device and works offline.
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-danger">
          <TriangleAlert size={11} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  )
}

function TitleControls({ clipId }: { clipId: string }): ReactNode {
  const clip = useVideoEditor((s) => s.clip)
  const setTitleText = useVideoEditor((s) => s.setTitleText)
  const setTitlePosition = useVideoEditor((s) => s.setTitlePosition)
  const setTitleShow = useVideoEditor((s) => s.setTitleShow)
  const commitTitle = useVideoEditor((s) => s.commitTitle)
  const [draft, setDraft] = useState<string | null>(null)
  const title = clip?.title ?? null
  const value = draft ?? title?.text ?? ''

  return (
    <section>
      <Heading icon={<Type size={11} />}>Title</Heading>
      <input
        type="text"
        aria-label="Title text"
        value={value}
        placeholder="Add a text overlay…"
        disabled={clip?.id !== clipId}
        onChange={(e) => {
          setTitleText(e.target.value)
          setDraft(e.target.value)
        }}
        onBlur={() => {
          setDraft(null)
          commitTitle()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none placeholder:text-lo focus-visible:border-accent"
      />
      {title ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-1">
            {(['lower', 'center'] as TitlePosition[]).map((pos) => (
              <button
                key={pos}
                type="button"
                aria-pressed={title.position === pos}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  title.position === pos ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                )}
                onClick={() => setTitlePosition(pos)}
              >
                {pos === 'lower' ? 'Lower third' : 'Center'}
              </button>
            ))}
          </div>
          <AdjustSlider
            param={{ label: 'Show for', min: 0.5, max: 30, def: 3 }}
            value={title.show}
            onLive={setTitleShow}
            onCommit={() => commitTitle()}
            onReset={() => {
              setTitleShow(3)
              commitTitle()
            }}
          />
        </div>
      ) : null}
    </section>
  )
}

/** Platform export presets: one tap sets aspect + quality together. */
const EXPORT_PRESETS = [
  { label: 'Reel / TikTok', aspect: '9:16' as const, quality: 1080, hint: '1080×1920 vertical — Instagram Reels, TikTok, YouTube Shorts' },
  { label: 'YouTube', aspect: '16:9' as const, quality: 1080, hint: '1920×1080 landscape — YouTube, standard HD' },
  { label: 'Square', aspect: '1:1' as const, quality: 1080, hint: '1080×1080 — Instagram feed post' },
  { label: 'Portrait', aspect: '4:5' as const, quality: 1080, hint: '1080×1350 — Instagram portrait post' },
  { label: 'Cinema', aspect: '2.35:1' as const, quality: 1080, hint: 'Widescreen cinematic letterbox' },
  { label: 'TV', aspect: '4:3' as const, quality: 720, hint: 'Classic TV aspect' },
]

/** Project-level output frame: aspect preset + letterbox fill (Basic + Pro). */
function CanvasControls(): ReactNode {
  const canvas = useVideoEditor((s) => s.canvas)
  const setCanvasLive = useVideoEditor((s) => s.setCanvasLive)
  const commitCanvas = useVideoEditor((s) => s.commitCanvas)

  const apply = (patch: Partial<CanvasSettings>, label: string): void => {
    setCanvasLive(patch)
    commitCanvas(label)
  }

  return (
    <section aria-label="Canvas controls">
      <Heading icon={<Frame size={11} />}>Canvas</Heading>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Aspect ratio">
        {CANVAS_ASPECTS.map((aspect) => (
          <button
            key={aspect}
            type="button"
            aria-pressed={canvas.aspect === aspect}
            onClick={() => apply({ aspect }, 'Aspect ratio')}
            className={cn(
              'rounded-md px-1 py-1 text-[10px] font-medium transition-colors',
              canvas.aspect === aspect ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
          >
            {CANVAS_ASPECT_LABELS[aspect]}
          </button>
        ))}
      </div>

      {canvas.aspect !== 'original' ? (
        <div className="mt-1.5 flex items-center gap-1" role="group" aria-label="Export quality">
          <span className="text-[10px] text-lo">Quality</span>
          {([720, 1080, 1440] as const).map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={(canvas.quality ?? 720) === q}
              onClick={() => apply({ quality: q }, 'Export quality')}
              className={cn(
                'rounded-md px-2 py-1 text-[10px] font-medium tabular-nums transition-colors',
                (canvas.quality ?? 720) === q ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
              )}
            >
              {q}p
            </button>
          ))}
        </div>
      ) : null}

      {canvas.aspect !== 'original' ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Platform export presets">
          <span className="text-[10px] text-lo">Presets</span>
          {EXPORT_PRESETS.map((preset) => {
            const active = canvas.aspect === preset.aspect && (canvas.quality ?? 720) === preset.quality
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                title={preset.hint}
                onClick={() => apply({ aspect: preset.aspect, quality: preset.quality }, `Preset: ${preset.label}`)}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                  active ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      ) : null}

      {canvas.aspect !== 'original' ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Canvas background">
            {(['color', 'blur'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={canvas.background === mode}
                onClick={() => apply({ background: mode }, 'Canvas background')}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[10px] font-semibold capitalize transition-colors',
                  canvas.background === mode ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                )}
              >
                {mode === 'color' ? 'Color fill' : 'Blurred clip'}
              </button>
            ))}
          </div>

          {canvas.background === 'color' ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Canvas colour">
              {CANVAS_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Canvas colour ${color}`}
                  aria-pressed={canvas.color === color}
                  onClick={() => apply({ color }, 'Canvas colour')}
                  style={{ backgroundColor: color }}
                  className={cn(
                    'h-5 w-5 rounded-full border border-white/20 transition-transform hover:scale-110',
                    canvas.color === color && 'ring-2 ring-accent ring-offset-2 ring-offset-panel',
                  )}
                />
              ))}
              <label className="relative h-5 w-5 cursor-pointer rounded-full border border-dashed border-line bg-elevated" title="Custom colour">
                <input
                  type="color"
                  value={canvas.color}
                  aria-label="Custom canvas colour"
                  onInput={(e) => setCanvasLive({ color: e.currentTarget.value })}
                  onBlur={() => commitCanvas('Canvas colour')}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-[9px] text-lo">+</span>
              </label>
            </div>
          ) : null}

          <p className="text-[10px] text-lo" aria-hidden>
            Fills the space around clips that don&apos;t match the frame. Blurred clip uses the current shot as the backdrop.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-lo" aria-hidden>
          Original keeps each clip&apos;s own frame. Pick a preset for a fixed shape (Reels, square, cinema…).
        </p>
      )}
    </section>
  )
}

function MusicSection(): ReactNode {
  const music = useVideoEditor((s) => s.music)
  const setMusic = useVideoEditor((s) => s.setMusic)
  const setMusicVolumeLive = useVideoEditor((s) => s.setMusicVolumeLive)
  const commitMusicVolume = useVideoEditor((s) => s.commitMusicVolume)
  const setMusicDuck = useVideoEditor((s) => s.setMusicDuck)
  const assets = useAssets()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const audioAssets = (assets ?? []).filter((a) => a.kind === 'audio')
  const chosen = music ? (assets ?? []).find((a) => a.id === music.assetId) ?? null : null
  const thumb = useThumbnail(chosen)

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
          <Music2 size={11} />
          Music
        </h3>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[10px] font-semibold text-hi transition-colors hover:bg-hover"
        >
          <ListMusic size={11} aria-hidden />
          Library
        </button>
      </div>
      {audioAssets.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-2 py-1.5 text-[11px] text-lo">
          <p>Pick a free CC0 track from the built-in library, or import your own audio in the Library.</p>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="mt-1 font-semibold text-accent hover:underline"
          >
            Browse music library
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {thumb ? <img src={thumb} alt="" className="h-7 w-7 rounded object-cover" aria-hidden /> : null}
            <select
              value={music?.assetId ?? ''}
              onChange={(e) => setMusic(e.target.value === '' ? null : e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
              aria-label="Music track"
            >
              <option value="">No music</option>
              {audioAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {music ? (
              <button type="button" onClick={() => setMusic(null)} className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi" aria-label="Remove music">
                <X size={12} />
              </button>
            ) : null}
          </div>
          {music ? (
            <AdjustSlider
              param={{ label: 'Music level', min: 0, max: 100, def: 40 }}
              value={music.volume}
              onLive={setMusicVolumeLive}
              onCommit={() => commitMusicVolume()}
              onReset={() => {
                setMusicVolumeLive(40)
                commitMusicVolume()
              }}
            />
          ) : null}
          {music ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-lo" id="music-duck-label">Auto-duck under clip audio</span>
              <button
                type="button"
                role="switch"
                aria-checked={music.duck !== false}
                aria-labelledby="music-duck-label"
                onClick={() => setMusicDuck(music.duck === false)}
                className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${music.duck !== false ? 'bg-accent' : 'bg-elevated border border-line'}`}
              >
                <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${music.duck !== false ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          ) : null}
          {music ? <BeatControls /> : null}
        </div>
      )}
      <MusicLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </section>
  )
}

/** Decode + analyse states for the beat detector. */
type BeatStatus = 'idle' | 'analysing' | 'error'

/**
 * Beat-sync controls: analyse the chosen music locally (no upload) to find
 * its tempo, then either snap every clip boundary to the grid with
 * "Sync cuts to beats" or just show the grid on the timeline.
 */
function BeatControls(): ReactNode {
  const music = useVideoEditor((s) => s.music)
  const setBeats = useVideoEditor((s) => s.setBeats)
  const syncCuts = useVideoEditor((s) => s.syncCutsToBeats)
  const clipCount = useVideoEditor((s) => s.sequence.length)
  const [status, setStatus] = useState<BeatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const asset = useAssets()?.find((a) => a.id === music?.assetId) ?? null
  const blob = useAssetBlob(asset)

  const detect = async (): Promise<void> => {
    if (!blob) return
    setStatus('analysing')
    setError(null)
    try {
      const { extractClipAudio } = await import('../captionAudio')
      const samples = await extractClipAudio(blob, 0, null, 300)
      const { detectBeats } = await import('../beatDetect')
      const info = detectBeats(samples, 16000)
      if (info.beats.length < 4) {
        setError('No steady tempo found in this track.')
        setStatus('error')
        return
      }
      setBeats(info.beats, info.bpm)
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const busy = status === 'analysing'
  const beats = music?.beats ?? null
  return (
    <section aria-label="Beat sync">
      <Heading icon={<AudioLines size={11} />}>Beat sync</Heading>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void detect()}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-elevated px-2 py-1.5 text-[11px] font-medium text-hi hover:bg-hover disabled:opacity-40"
        >
          <AudioLines size={12} />
          {beats ? 'Re-detect beats' : 'Detect beats'}
        </button>
        {beats ? (
          <button
            type="button"
            disabled={clipCount < 2}
            onClick={syncCuts}
            title={clipCount < 2 ? 'Add another clip first' : undefined}
            className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-onaccent hover:brightness-110 disabled:opacity-40"
          >
            <Sparkles size={12} />
            Sync cuts
          </button>
        ) : null}
      </div>
      {beats ? (
        <p className="mt-1.5 text-[10px] text-lo">
          {music?.bpm ? `${Math.round(music.bpm)} BPM · ` : ''}
          {beats.length} beats on the timeline — cuts can snap to them.
        </p>
      ) : null}
      {busy ? <p className="mt-1.5 text-[10px] text-lo">Analysing the track on this device…</p> : null}
      {error ? <p className="mt-1.5 text-[10px] leading-snug text-danger">{error}</p> : null}
    </section>
  )
}

function AudioControls({ doc }: { doc: VideoEditDoc }): ReactNode {  const setVolume = useVideoEditor((s) => s.setVolume)
  const commitVolume = useVideoEditor((s) => s.commitVolume)
  return (
    <section>
      <Heading icon={<Volume2 size={11} />}>Audio</Heading>
      <AdjustSlider
        param={{ label: 'Volume', min: 0, max: 150, def: 100 }}
        value={doc.volume}
        onLive={setVolume}
        onCommit={() => commitVolume()}
        onReset={() => {
          setVolume(100)
          commitVolume()
        }}
      />
    </section>
  )
}

function VideoHistoryButtons(): ReactNode {
  const canUndo = useVideoEditor((s) => s.history.canUndo)
  const canRedo = useVideoEditor((s) => s.history.canRedo)
  const undo = useVideoEditor((s) => s.undo)
  const redo = useVideoEditor((s) => s.redo)
  return (
    <>
      <button
        type="button"
        className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
        title="Undo (⌘Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 size={13} />
      </button>
      <button
        type="button"
        className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2 size={13} />
      </button>
    </>
  )
}

function ResetButton(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const resetEdits = useVideoEditor((s) => s.resetEdits)
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
      title="Reset all edits on the selected clip"
      aria-label="Reset all edits"
      disabled={!doc || !videoEditsChanged(doc)}
      onClick={resetEdits}
    >
      <RotateCcw size={13} />
      Reset
    </button>
  )
}

function VideoHistoryList(): ReactNode {
  const history = useVideoEditor((s) => s.history)
  const jumpTo = useVideoEditor((s) => s.jumpTo)
  const revision = useVideoEditor((s) => s.revision)
  void revision
  const entries = history.list()

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-2.5 text-[11px] text-lo">
        No edits yet — splits, trims, grades, speed and titles appear here.
      </p>
    )
  }
  return (
    <ol className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
      {entries.map((entry, indexInList) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => jumpTo(entry.id)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-lo hover:bg-hover hover:text-hi data-[latest=true]:bg-accent-soft data-[latest=true]:text-accent"
            data-latest={indexInList === 0}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
