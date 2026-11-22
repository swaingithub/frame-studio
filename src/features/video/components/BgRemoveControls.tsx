import { type ReactNode } from 'react'
import { Scissors, User } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useVideoEditor } from '../store'
import { Heading } from './InspectorUi'

/**
 * AI background removal: one toggle per clip. The subject (people) is cut
 * out by a small segmentation model that downloads once, on first use, and
 * then runs fully offline — the download is clearly labelled here.
 */
export function BgRemoveControls(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const setBgRemove = useVideoEditor((s) => s.setBgRemove)
  if (!doc) return null
  const on = doc.bgRemove === true
  return (
    <section aria-label="Background removal">
      <Heading icon={<Scissors size={11} />}>Background removal</Heading>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setBgRemove(!on)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
          on ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
        )}
      >
        <span className="flex items-center gap-1.5">
          <User size={12} />
          {on ? 'Subject cut out' : 'Cut out subject'}
        </span>
        <span className={cn('text-[10px]', on ? 'text-onaccent/70' : 'text-lo')}>
          {on ? 'On' : 'Off'}
        </span>
      </button>
      {!on ? (
        <p className="mt-1.5 text-[10px] leading-snug text-lo">
          Keeps people, drops the rest. First use downloads a small model (~250 KB) — after that it runs offline on this device.
        </p>
      ) : null}
    </section>
  )
}
