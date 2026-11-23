/**
 * Right-hand inspector for the video workspace — shell.
 *
 * The inspector body (`VideoInspectorBody`) composes the section components
 * from the sibling files — each is one feature (Looks/Auto, camera, speed,
 * transitions, titles, music, beat sync, captions, background removal,
 * masks, chroma key, voiceover, Convert, canvas presets, history).
 */

import { useState, type ReactNode } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../core/adjustments/registry'
import { statsFromHistogram } from '../../../core/adjustments/presets'
import type { Histogram } from '../../../core/render/histogram'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { HistogramView } from '../../../ui/histogramView'
import { PresetBar } from '../../../ui/presetBar'
import { useClipFrame } from '../clipFrame'
import { useVideoEditor } from '../store'
import { cn } from '../../../lib/cn'
import { OverlayControls } from './OverlayControls'
import { CameraControls } from './CameraControls'
import { RampControls } from './RampControls'
import { SpeedControls } from './SpeedControls'
import { ChromaKeyControls } from './ChromaKeyControls'
import { ConvertControls } from './ConvertControls'
import { VoiceoverSection } from './VoiceoverSection'
import { ManhwaSection } from './ManhwaSection'
import { BgRemoveControls } from './BgRemoveControls'
import { MaskControls } from './MaskControls'
import { TransitionControls } from './TransitionControls'
import { CaptionsControls } from './CaptionsControls'
import { TitleControls } from './TitleControls'
import { CanvasControls } from './CanvasControls'
import { MusicSection } from './MusicSection'
import { AudioControls } from './AudioControls'
import { VideoHistoryButtons, ResetButton, VideoHistoryList } from './HistoryButtons'

const sectionLabels: Record<string, string> = {
  light: 'Light',
  color: 'Color',
  detail: 'Detail',
  effects: 'Effects',
}

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

      <ManhwaSection />

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
