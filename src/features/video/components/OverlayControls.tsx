import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Trash2, Type } from 'lucide-react'
import { AdjustSlider } from '../../photo/components/AdjustSlider'
import { useVideoEditor, layoutOf, useInspectorTime } from '../store'
import { MIN_OVERLAY_OUT, OVERLAY_ANIM_LABELS, OVERLAY_ANIM_PRESETS, type AnimBase, type OverlayAnimPreset, type OverlayClip } from '../sequenceModel'
import { animAt } from '../sequenceAnim'
import { AnimSliderRow, Heading } from './InspectorUi'
import { cn } from '../../../lib/cn'

/** Inspector for the selected overlay layer: text, transform, timing, layering. */
export function OverlayControls({ overlay, proMode }: { overlay: OverlayClip; proMode: boolean }): ReactNode {
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
