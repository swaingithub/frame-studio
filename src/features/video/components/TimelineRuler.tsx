import type { ReactNode } from 'react'
import { formatDuration } from '../../../core/format'

export function TimelineRuler({ total }: { total: number }): ReactNode {
  const marks = Array.from({ length: 6 }, (_, i) => (total * i) / 5)
  return (
    <div className="flex h-4 items-end justify-between px-1 text-[9px] tabular-nums text-lo" aria-hidden>
      {marks.map((t, i) => <span key={i}>{formatDuration(t)}</span>)}
    </div>
  )
}
