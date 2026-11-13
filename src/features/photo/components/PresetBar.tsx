import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import {
  PRESETS,
  autoValues,
  presetValues,
  type AdjustPreset,
  type HistogramStats,
} from '../../../core/adjustments/presets'
import type { AdjustValues } from '../../../core/adjustments/registry'
import { createDefaultEditDoc, withAdjustments } from '../../../core/adjustments/edits'
import { renderEdit } from '../../../core/render/pipeline'
import type { TexSource } from '../../../core/render/webgl'
import { cn } from '../../../lib/cn'

/**
 * One-click looks row: Auto (histogram-driven) plus curated presets.
 * Identical in the photo and video inspectors — grading knowledge lives
 * once, in core. When a preview source is available, each preset renders
 * as a live thumbnail of the actual image (like Lightroom's filter bar).
 */

export interface PresetBarProps {
  onApply: (values: Partial<AdjustValues>, label: string) => void
  /** Stats for the Auto heuristic; omit to disable Auto. */
  stats?: HistogramStats | null
  /** Preview bitmap to render live preset thumbnails; omit for text chips. */
  source?: TexSource | null
  /** Change when the source (and thus thumbnails) must be re-rendered. */
  sourceKey?: string
}

export function PresetBar({ onApply, stats, source, sourceKey }: PresetBarProps): ReactNode {
  const hasThumbs = !!source && source.width > 4 && source.height > 4
  return (
    <section aria-label="Looks">
      <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
        <Sparkles size={11} />
        Looks
      </h3>
      <div className={cn('flex', hasThumbs ? 'gap-1.5 overflow-x-auto pb-1 snap-x' : 'flex-wrap gap-1')}>
        {stats ? (
          <AutoChip
            stats={stats}
            onApply={onApply}
            source={hasThumbs ? source : null}
          />
        ) : null}
        {PRESETS.map((preset) => (
          <PresetChip
            key={preset.id}
            preset={preset}
            onApply={onApply}
            source={hasThumbs ? source : null}
            sourceKey={sourceKey}
          />
        ))}
      </div>
    </section>
  )
}

function AutoChip({ stats, onApply, source }: { stats: HistogramStats; onApply: PresetBarProps['onApply']; source: TexSource | null }): ReactNode {
  const values = autoValues(stats)
  return (
    <Chip
      label="Auto"
      description="Analyze and enhance automatically"
      values={values}
      onClick={() => onApply(values, 'Auto enhance')}
      accent
      source={source}
    />
  )
}

function PresetChip({
  preset,
  onApply,
  source,
  sourceKey,
}: {
  preset: AdjustPreset
  onApply: PresetBarProps['onApply']
  source: TexSource | null
  sourceKey?: string
}): ReactNode {
  const values = presetValues(preset)
  return (
    <Chip
      key={preset.id}
      label={preset.label}
      description={preset.description}
      values={values}
      onClick={() => onApply(values, preset.label)}
      source={source}
      sourceKey={sourceKey}
    />
  )
}

/** Live thumbnail: renders the preset over the actual image (88×66 @2x). */
function PresetThumb({ values, source, sourceKey, accent }: {
  values: Partial<AdjustValues>
  source: TexSource | null
  sourceKey?: string
  accent?: boolean
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source || source.width < 8) {
      setFailed(true)
      return
    }
    let cancelled = false
    const W = 176
    const H = 132
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    try {
      const doc = withAdjustments(createDefaultEditDoc(), values)
      renderEdit(source, doc, canvas, { maxSize: W })
    } catch {
      if (!cancelled) setFailed(true)
    }
    return () => {
      cancelled = true
    }
  }, [values, source, sourceKey])

  if (failed) return null
  return (
    <span
      className={cn(
        'block h-[46px] w-[62px] shrink-0 overflow-hidden rounded',
        accent ? 'ring-1 ring-accent' : 'ring-1 ring-line',
      )}
    >
      <canvas ref={canvasRef} width={176} height={132} className="h-full w-full object-cover" aria-hidden />
    </span>
  )
}

function Chip({
  label,
  description,
  values,
  onClick,
  accent,
  source,
  sourceKey,
}: {
  label: string
  description: string
  values: Partial<AdjustValues>
  onClick: () => void
  accent?: boolean
  source: TexSource | null
  sourceKey?: string
}): ReactNode {
  return (
    <button
      type="button"
      title={description}
      onClick={onClick}
      className={cn(
        'group flex shrink-0 snap-start items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-transform hover:scale-[1.03] active:scale-95',
        accent
          ? 'border-accent/60 bg-accent-soft text-hi'
          : 'border-line bg-elevated text-lo hover:text-hi',
      )}
    >
      {source ? <PresetThumb values={values} source={source} sourceKey={sourceKey} accent={accent} /> : null}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
