import { useState, type ReactNode } from 'react'
import { Type } from 'lucide-react'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { cn } from '../../../lib/cn'
import { useVideoEditor } from '../store'
import type { TitlePosition } from '../sequenceModel'
import { Heading } from './InspectorUi'

export function TitleControls({ clipId }: { clipId: string }): ReactNode {
  const clip = useVideoEditor((s) => s.clip)
  const setTitleText = useVideoEditor((s) => s.setTitleText)
  const setTitlePosition = useVideoEditor((s) => s.setTitlePosition)
  const setTitleShow = useVideoEditor((s) => s.setTitleShow)
  const commitTitle = useVideoEditor((s) => s.commitTitle)
  const [draft, setDraft] = useState<string | null>(null)
  const title = clip?.title ?? null
  const value = draft ?? title?.text ?? ''

  return (
    <section>
      <Heading icon={<Type size={11} />}>Title</Heading>
      <input
        type="text"
        aria-label="Title text"
        value={value}
        placeholder="Add a text overlay…"
        disabled={clip?.id !== clipId}
        onChange={(e) => {
          setTitleText(e.target.value)
          setDraft(e.target.value)
        }}
        onBlur={() => {
          setDraft(null)
          commitTitle()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none placeholder:text-lo focus-visible:border-accent"
      />
      {title ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-1">
            {(['lower', 'center'] as TitlePosition[]).map((pos) => (
              <button
                key={pos}
                type="button"
                aria-pressed={title.position === pos}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  title.position === pos ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                )}
                onClick={() => setTitlePosition(pos)}
              >
                {pos === 'lower' ? 'Lower third' : 'Center'}
              </button>
            ))}
          </div>
          <AdjustSlider
            param={{ label: 'Show for', min: 0.5, max: 30, def: 3 }}
            value={title.show}
            onLive={setTitleShow}
            onCommit={() => commitTitle()}
            onReset={() => {
              setTitleShow(3)
              commitTitle()
            }}
          />
        </div>
      ) : null}
    </section>
  )
}

