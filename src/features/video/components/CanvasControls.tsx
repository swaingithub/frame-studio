import { type ReactNode } from 'react'
import { Frame } from 'lucide-react'
import { useVideoEditor } from '../store'
import { CANVAS_ASPECTS, CANVAS_ASPECT_LABELS, CANVAS_COLORS, type CanvasSettings } from '../sequenceModel'
import { cn } from '../../../lib/cn'
import { Heading } from './InspectorUi'

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
export function CanvasControls(): ReactNode {
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
