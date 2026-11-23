import { type ReactNode } from 'react'
import { Circle } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { useVideoEditor } from '../store'
import { MASK_SHAPES, MASK_SHAPE_LABELS, defaultMask, type Mask } from '../../../core/adjustments/edits'
import { Heading } from './InspectorUi'

export function MaskControls(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const setMask = useVideoEditor((s) => s.setMask)
  const commit = useVideoEditor((s) => s.commit)
  const mask = doc?.mask ?? null
  if (!doc) return null

  const shape = mask?.shape ?? 'none'
  const m = mask ?? defaultMask()
  const patch = (p: Partial<Mask>): void => setMask(p)
  const commitMask = (): void => commit('Mask')
  const reset = (p: Partial<Mask>): void => {
    setMask(p)
    commit('Mask')
  }

  return (
    <section aria-label="Mask controls">
      <Heading icon={<Circle size={11} />}>Mask</Heading>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Mask shape">
        {MASK_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            onClick={() => {
              setMask({ shape: s })
              commit('Mask')
            }}
            className={cn(
              'rounded-md px-1 py-1 text-[10px] font-medium transition-colors',
              shape === s ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
          >
            {MASK_SHAPE_LABELS[s]}
          </button>
        ))}
      </div>

      {shape !== 'none' ? (
        <div className="mt-2 flex flex-col gap-1">
          <AdjustSlider param={{ label: 'X', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.x}
            onLive={(v) => patch({ x: v })} onCommit={commitMask} onReset={() => reset({ x: 0.5 })} />
          <AdjustSlider param={{ label: 'Y', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.y}
            onLive={(v) => patch({ y: v })} onCommit={commitMask} onReset={() => reset({ y: 0.5 })} />
          <AdjustSlider param={{ label: 'Width', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.w}
            onLive={(v) => patch({ w: v })} onCommit={commitMask} onReset={() => reset({ w: 0.6 })} />
          <AdjustSlider param={{ label: 'Height', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.h}
            onLive={(v) => patch({ h: v })} onCommit={commitMask} onReset={() => reset({ h: 0.6 })} />
          <AdjustSlider param={{ label: 'Rotation', min: -180, max: 180, def: 0, step: 1 }} value={m.rotation}
            onLive={(v) => patch({ rotation: v })} onCommit={commitMask} onReset={() => reset({ rotation: 0 })} />
          <AdjustSlider param={{ label: 'Feather', min: 0, max: 0.4, def: 0.08, step: 0.01 }} value={m.feather}
            onLive={(v) => patch({ feather: v })} onCommit={commitMask} onReset={() => reset({ feather: 0.08 })} />

          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={m.invert}
              onClick={() => {
                setMask({ invert: !m.invert })
                commit('Mask')
              }}
              className={cn(
                'h-4 w-8 rounded-full px-0.5 transition-colors',
                m.invert ? 'bg-accent' : 'bg-elevated ring-1 ring-line',
              )}
            >
              <span
                className={cn('block h-3 w-3 rounded-full bg-white transition-transform', m.invert && 'translate-x-4')}
                aria-hidden
              />
            </button>
            <span className="text-[11px] text-hi/90">Invert mask</span>
          </div>
          <p className="text-[10px] text-lo" aria-hidden>
            Only the area inside the shape stays visible. Feather softens its edges.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-lo" aria-hidden>
          Add a shape to reveal just part of the frame — great for circles, slits and creative wipes.
        </p>
      )}
    </section>
  )
}
