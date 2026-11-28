import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Adjustment slider. Lightroom-style behavior:
 *  - dragging updates the gradient fill + value label live
 *  - double-click the label (the accessible reset affordance) resets to the
 *    parameter default and commits one history entry
 *  - one history entry per drag gesture (commits fire on pointer-up or after
 *    a short idle for keyboard/programmatic input)
 */
interface SliderParam {
  label: string
  min: number
  max: number
  def: number
  /** Optional step override (defaults to 1 for the ±100 adjustment range). */
  step?: number
}

interface AdjustSliderProps {
  param: SliderParam
  value: number
  disabled?: boolean
  onLive: (value: number) => void
  onCommit: (value: number) => void
  onReset: () => void
}

export function AdjustSlider({ param, value, disabled, onLive, onCommit, onReset }: AdjustSliderProps): ReactNode {
  const rangeRef = useRef<HTMLInputElement>(null)
  const idleTimer = useRef<number | undefined>(undefined)
  const gestureActive = useRef(false)

  useEffect(() => {
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
  }, [])

  function scheduleCommit(v: number): void {
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (!gestureActive.current) onCommit(v)
    }, 350)
  }

  const pct = ((value - param.min) / (param.max - param.min)) * 100
  // Fill from the default position, in gradient direction
  const defPct = ((param.def - param.min) / (param.max - param.min)) * 100
  const from = Math.min(pct, defPct)
  const to = Math.max(pct, defPct)

  return (
    <div className={cn('flex items-center gap-2', disabled && 'pointer-events-none opacity-40')}>
      <button
        type="button"
        title={`${param.label} — double-click to reset`}
        onDoubleClick={() => {
          if (idleTimer.current) window.clearTimeout(idleTimer.current)
          onReset()
        }}
        className="w-20 shrink-0 cursor-default select-none rounded text-left text-[11px] text-lo transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {param.label}
      </button>
      <input
        ref={rangeRef}
        type="range"
        min={param.min}
        max={param.max}
        step={param.step ?? 1}
        value={value}
        disabled={disabled}
        aria-label={param.label}
        onChange={(e) => {
          const v = Number(e.target.value)
          onLive(v)
          scheduleCommit(v)
        }}
        onPointerDown={() => {
          gestureActive.current = true
        }}
        onPointerUp={() => {
          gestureActive.current = false
          if (idleTimer.current) window.clearTimeout(idleTimer.current)
          onCommit(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (idleTimer.current) window.clearTimeout(idleTimer.current)
            onReset()
          }
        }}
        className={cn(
          'h-1.5 w-full cursor-pointer appearance-none rounded-full outline-offset-2',
          '[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent',
          '[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition-transform',
          '[&::-webkit-slider-thumb]:hover:scale-115',
          '[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent',
        )}
        style={{
          background: `linear-gradient(to right, var(--c-line) 0%, var(--c-line) ${from}%, var(--c-accent) ${from}%, var(--c-accent) ${to}%, var(--c-line) ${to}%, var(--c-line) 100%)`,
        }}
      />
      <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-lo">
        {value === param.def ? '' : value > 0 && param.min < 0 ? `+${Math.round(value / 1)}` : Math.round(value / 1)}
      </span>
    </div>
  )
}
