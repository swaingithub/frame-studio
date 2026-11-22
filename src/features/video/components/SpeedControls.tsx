import { type ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { useVideoEditor } from '../store'
import { cn } from '../../../lib/cn'
import { Heading } from './InspectorUi'
import type { VideoEditDoc } from '../model'

const speedMarks: { v: number; label: string }[] = [
  { v: 0.25, label: '0.25×' },
  { v: 0.5, label: '0.5×' },
  { v: 1, label: '1×' },
  { v: 1.5, label: '1.5×' },
  { v: 2, label: '2×' },
  { v: 4, label: '4×' },
]

export function SpeedControls({ doc }: { doc: VideoEditDoc }): ReactNode {
  const setSpeedLive = useVideoEditor((s) => s.setSpeedLive)
  const commitSpeed = useVideoEditor((s) => s.commitSpeed)
  return (
    <section>
      <Heading icon={<Gauge size={11} />}>Speed</Heading>
      <div className="flex flex-wrap gap-1">
        {speedMarks.map((mark) => (
          <button
            key={mark.v}
            type="button"
            aria-pressed={Math.abs(doc.speed - mark.v) < 0.01}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              Math.abs(doc.speed - mark.v) < 0.01 ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onPointerDown={() => setSpeedLive(mark.v)}
            onPointerUp={() => commitSpeed()}
            onPointerLeave={() => commitSpeed()}
          >
            {mark.label}
          </button>
        ))}
      </div>
    </section>
  )
}
