import { Sparkles } from 'lucide-react'
import {
  PRESETS,
  autoValues,
  presetValues,
  type AdjustPreset,
  type HistogramStats,
} from '../../../core/adjustments/presets'
import type { AdjustValues } from '../../../core/adjustments/registry'
import { cn } from '../../../lib/cn'
import type { ReactNode } from 'react'

/**
 * One-click looks row: Auto (histogram-driven) plus curated presets.
 * Identical in the photo and video inspectors — grading knowledge lives
 * once, in core.
 */

export interface PresetBarProps {
  onApply: (values: Partial<AdjustValues>, label: string) => void
  /** Stats for the Auto heuristic; omit to disable Auto. */
  stats?: HistogramStats | null
}

export function PresetBar({ onApply, stats }: PresetBarProps): ReactNode {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
        <Sparkles size={11} />
        Looks
      </h3>
      <div className="flex flex-wrap gap-1">
        {stats ? <AutoChip stats={stats} onApply={onApply} /> : null}
        {PRESETS.map((preset) => (
          <PresetChip key={preset.id} preset={preset} onApply={onApply} />
        ))}
      </div>
    </section>
  )
}

function AutoChip({ stats, onApply }: { stats: HistogramStats; onApply: PresetBarProps['onApply'] }): ReactNode {
  const values = autoValues(stats)
  return (
    <Chip label="Auto" description="Analyze and enhance automatically" onClick={() => onApply(values, 'Auto enhance')} accent />
  )
}

function PresetChip({ preset, onApply }: { preset: AdjustPreset; onApply: PresetBarProps['onApply'] }): ReactNode {
  return (
    <Chip
      label={preset.label}
      description={preset.description}
      onClick={() => onApply(presetValues(preset), preset.label)}
    />
  )
}

function Chip({
  label,
  description,
  onClick,
  accent,
}: {
  label: string
  description: string
  onClick: () => void
  accent?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      title={description}
      aria-label={`${label} — ${description}`}
      onClick={onClick}
      className={cn(
        'rounded-full border border-line bg-elevated px-2.5 py-1 text-[11px] font-medium text-hi',
        'transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent',
        'focus-visible:outline-2 focus-visible:outline-accent',
        accent && 'border-accent/50 text-accent',
      )}
    >
      {label}
    </button>
  )
}
