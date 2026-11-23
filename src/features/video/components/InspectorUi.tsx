import { Diamond } from 'lucide-react'
import type { ReactNode } from 'react'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { ANIM_DEFAULTS, ANIM_RANGES } from '../sequenceAnim'
import type { AnimBase } from '../sequenceModel'
import { cn } from '../../../lib/cn'

/** Shared inspector chrome — section headings and keyframe diamonds. */

/** Section heading with a trailing icon. */
export function Heading({ icon, children }: { icon: ReactNode; children: ReactNode }): ReactNode {
  return (
    <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
      {icon}
      {children}
    </h3>
  )
}

/** Diamond toggle: on = a keyframe exists at the playhead for that property. */
export function KeyButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): ReactNode {
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
export function AnimSliderRow({
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
