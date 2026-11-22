import { type ReactNode } from 'react'
import { Blend } from 'lucide-react'
import { useVideoEditor } from '../store'
import { MAX_TRANSITION, TRANSITION_LABELS, TRANSITION_TYPES, isOverlapTransition, type VideoTransition } from '../sequenceModel'
import { cn } from '../../../lib/cn'
import { Heading } from './InspectorUi'

export function TransitionControls({
  transition,
  duration,
  isFirst,
}: {
  transition: VideoTransition
  duration: number
  isFirst: boolean
}): ReactNode {
  const setTransition = useVideoEditor((s) => s.setTransition)
  const setTransitionDurationLive = useVideoEditor((s) => s.setTransitionDurationLive)
  const commitTransitionDuration = useVideoEditor((s) => s.commitTransitionDuration)
  const overlap = isOverlapTransition(transition) && !isFirst
  return (
    <section>
      <Heading icon={<Blend size={11} />}>
        Transition in {isFirst ? '(start of film)' : ''}
      </Heading>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Transition type">
        {TRANSITION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={transition === type}
            disabled={isFirst && isOverlapTransition(type)}
            title={
              isFirst && isOverlapTransition(type)
                ? 'The first clip has no previous clip to overlap — fades still work as a fade-in'
                : TRANSITION_LABELS[type]
            }
            className={cn(
              'truncate rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-30',
              transition === type ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
            onClick={() => setTransition(type)}
          >
            {TRANSITION_LABELS[type]}
          </button>
        ))}
      </div>
      {overlap ? (
        <>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Length</span>
            <input
              type="range"
              min={0.1}
              max={MAX_TRANSITION}
              step={0.1}
              value={duration}
              aria-label="Transition length"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setTransitionDurationLive(Number((e.target as HTMLInputElement).value))}
              onPointerUp={() => commitTransitionDuration()}
              onPointerLeave={() => commitTransitionDuration()}
              onKeyUp={() => commitTransitionDuration()}
            />
            <span className="w-8 shrink-0 text-right tabular-nums text-hi/80">{duration.toFixed(1)}s</span>
          </label>
          <p className="mt-1 text-[10px] leading-snug text-lo">
            Plays both clips at once; capped at half of the shorter neighbour.
          </p>
        </>
      ) : null}
    </section>
  )
}
