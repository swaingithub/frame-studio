import { type ReactNode } from 'react'
import { Waves } from 'lucide-react'
import { useVideoEditor } from '../store'
import { SPEED_CURVES, SPEED_CURVE_LABELS, type VideoEditDoc } from '../model'
import { cn } from '../../../lib/cn'
import { Heading } from './InspectorUi'

/** Ease curve chips INSIDE one clip: mean-normalized, so lengths never shift. */
export function RampControls({ doc }: { doc: VideoEditDoc }): ReactNode {
  const setRamp = useVideoEditor((s) => s.setRamp)
  return (
    <section>
      <Heading icon={<Waves size={11} />}>Speed ramp</Heading>
      <div className="flex flex-wrap gap-1">
        {SPEED_CURVES.map((curve) => (
          <button
            key={curve}
            type="button"
            aria-pressed={doc.speedCurve === curve}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              doc.speedCurve === curve ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onClick={() => setRamp(curve)}
          >
            {SPEED_CURVE_LABELS[curve]}
          </button>
        ))}
      </div>
    </section>
  )
}
