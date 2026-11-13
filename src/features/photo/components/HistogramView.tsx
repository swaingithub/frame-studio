import { useId, useMemo, type ReactNode } from 'react'
import type { Histogram } from '../../../core/render/histogram'

/**
 * RGB + luma histogram rendered to a tiny canvas from precomputed bins.
 * Pure display: the editor passes histogram data it computes throttled.
 */
export function HistogramView({ histogram }: { histogram: Histogram | null }): ReactNode {
  const gradientId = useId()
  const path = useMemo(() => {
    if (!histogram) return null
    return ['r', 'g', 'b', 'l'].map((ch) => buildPath(histogram[ch as keyof Histogram] as Int32Array, 96, 28))
  }, [histogram])

  return (
    <svg viewBox="0 0 96 28" preserveAspectRatio="none" className="h-14 w-full rounded bg-black/40" aria-label="Histogram">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(240 242 245)" stopOpacity="1" />
          <stop offset="100%" stopColor="rgb(240 242 245)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {path ? (
        <>
          <path d={path[3]} fill="url(#gradientId)" fillOpacity="0.5" />
          <path d={path[2]} fill="rgba(48,140,255,0.55)" />
          <path d={path[1]} fill="rgba(64,210,140,0.55)" />
          <path d={path[0]} fill="rgba(255,80,80,0.55)" />
        </>
      ) : (
        <text x="48" y="15" textAnchor="middle" fontSize="4" fill="rgb(139 147 157)">Loading…</text>
      )}
    </svg>
  )
}

function buildPath(bins: Int32Array, width: number, height: number): string {
  const max = Math.max(1, ...Array.from(bins.slice(1, 255))) // ignore pure 0/255 spikes
  const steps = 48
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width
    const bin = Math.floor((i / steps) * 255)
    const v = Math.min(1, bins[bin] / max)
    const y = height - v * height
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return `M0,${height} L${points.join(' L')} L${width},${height} Z`
}
