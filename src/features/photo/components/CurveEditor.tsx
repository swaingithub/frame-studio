import { useRef, type PointerEvent, type ReactNode } from 'react'
import { CURVE_INPUTS, evaluateCurve, isIdentityCurve, type CurveKnots, type ToneCurve } from '../../../core/adjustments/color'
import { AdjustSlider } from './AdjustSlider'
import { usePhotoEditor } from '../store'
import { Button } from '../../../ui/button'
import { cn } from '../../../lib/cn'

const W = 220
const H = 132
const PAD = 10

function toSvg(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: PAD + x * (W - PAD * 2),
    cy: PAD + (1 - y) * (H - PAD * 2),
  }
}

function fromSvg(px: number, py: number): { x: number; y: number } {
  return {
    x: (px - PAD) / (W - PAD * 2),
    y: 1 - (py - PAD) / (H - PAD * 2),
  }
}

interface CurveEditorProps {
  curve: ToneCurve
}

export function CurveEditor({ curve }: CurveEditorProps): ReactNode {
  const editor = usePhotoEditor()
  const dragIndex = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const path = buildPath(curve.master)
  const identity = isIdentityCurve(curve)

  function setKnot(index: number, y: number): void {
    const next = [...curve.master] as CurveKnots
    const lo = index === 0 ? 0 : 0
    const hi = index === 4 ? 1 : 1
    next[index] = Math.min(hi, Math.max(lo, y))
    editor.setCurveLive({ master: next })
  }

  function onPointerDown(index: number, e: PointerEvent<SVGCircleElement>): void {
    dragIndex.current = index
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>): void {
    if (dragIndex.current === null || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const { y } = fromSvg(
      ((e.clientX - rect.left) / rect.width) * W,
      ((e.clientY - rect.top) / rect.height) * H,
    )
    setKnot(dragIndex.current, y)
  }

  function onPointerUp(): void {
    if (dragIndex.current === null) return
    dragIndex.current = null
    editor.commit('Tone curve')
  }

  return (
    <div className="flex flex-col gap-2.5">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-md border border-line bg-elevated touch-none"
        role="slider"
        aria-label="Master tone curve"
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--c-accent)" strokeWidth={1.75} />
        {curve.master.map((y, i) => {
          const { cx, cy } = toSvg(CURVE_INPUTS[i], y)
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={5}
              className="fill-panel stroke-accent cursor-ns-resize"
              strokeWidth={1.5}
              onPointerDown={(e) => onPointerDown(i, e)}
            />
          )
        })}
      </svg>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={identity}
          onClick={() => {
            editor.setCurveLive({
              master: [0, 0.25, 0.5, 0.75, 1],
              shadows: 0,
              darks: 0,
              lights: 0,
              highlights: 0,
            })
            editor.commit('Reset curve')
          }}
        >
          Reset curve
        </Button>
      </div>
      {(
        [
          ['shadows', 'Shadows'],
          ['darks', 'Darks'],
          ['lights', 'Lights'],
          ['highlights', 'Highlights'],
        ] as const
      ).map(([key, label]) => (
        <AdjustSlider
          key={key}
          param={{ label, min: -100, max: 100, def: 0 }}
          value={curve[key]}
          onLive={(v) => editor.setCurveLive({ [key]: Math.round(v) })}
          onCommit={() => editor.commit(label)}
          onReset={() => {
            editor.setCurveLive({ [key]: 0 })
            editor.commit(`${label} reset`)
          }}
        />
      ))}
    </div>
  )
}

function buildPath(knots: CurveKnots): string {
  const steps = 32
  const parts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const x = i / steps
    const y = evaluateCurve(knots, x)
    const { cx, cy } = toSvg(x, y)
    parts.push(`${i === 0 ? 'M' : 'L'}${cx.toFixed(2)} ${cy.toFixed(2)}`)
  }
  return parts.join(' ')
}

export function CurveSection({ curve, collapsed, onToggle }: { curve: ToneCurve; collapsed: boolean; onToggle: () => void }): ReactNode {
  const touched = !isIdentityCurve(curve)
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo hover:text-hi"
        aria-expanded={!collapsed}
      >
        Tone curve
        {touched ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Adjusted" /> : null}
      </button>
      <div className={cn(collapsed && 'hidden')}>
        <CurveEditor curve={curve} />
      </div>
    </section>
  )
}
