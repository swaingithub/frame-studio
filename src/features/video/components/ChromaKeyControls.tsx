import { type ReactNode } from 'react'
import { Wand } from 'lucide-react'
import { DEFAULT_CHROMA_COLOR } from '../../../core/adjustments/edits'
import { useVideoEditor } from '../store'
import { cn } from '../../../lib/cn'
import { Heading } from './InspectorUi'

/** Chroma key presets (chroma-green, blue screen, magenta, cyan, white, black). */
const CHROMA_PRESETS: { label: string; color: [number, number, number] }[] = [
  { label: 'Green', color: [0.0, 0.69, 0.25] },
  { label: 'Blue', color: [0.04, 0.38, 0.82] },
  { label: 'Magenta', color: [0.66, 0.1, 0.6] },
  { label: 'Cyan', color: [0.12, 0.62, 0.68] },
  { label: 'White', color: [1.0, 1.0, 1.0] },
  { label: 'Black', color: [0.0, 0.0, 0.0] },
]

function chromaCss(color: readonly [number, number, number]): string {
  const to255 = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgb(${to255(color[0])} ${to255(color[1])} ${to255(color[2])})`
}

/** Green screen removal on the selected clip (Pro mode). */
export function ChromaKeyControls(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const setChromaKey = useVideoEditor((s) => s.setChromaKey)
  const commit = useVideoEditor((s) => s.commit)
  const key = doc?.chromaKey ?? null

  if (!doc) return null
  const active = key?.enabled ?? false
  const color = key?.color ?? DEFAULT_CHROMA_COLOR

  const pick = (c: [number, number, number]): void => {
    setChromaKey(key ? { color: c } : { color: c, enabled: true })
    commit('Chroma key')
  }
  const toggle = (): void => {
    setChromaKey({ enabled: !active })
    commit('Chroma key')
  }

  return (
    <section aria-label="Chroma key controls">
      <Heading icon={<Wand size={11} />}>Chroma key</Heading>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={toggle}
          className={cn(
            'h-4 w-8 rounded-full px-0.5 transition-colors',
            active ? 'bg-accent' : 'bg-elevated ring-1 ring-line',
          )}
        >
          <span
            className={cn('block h-3 w-3 rounded-full bg-white transition-transform', active && 'translate-x-4')}
            aria-hidden
          />
        </button>
        <span className="text-[11px] text-hi/90">{active ? 'Removing' : 'Off'}</span>
      </div>
      {active ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Key color">
            {CHROMA_PRESETS.map((preset) => {
              const selected = key ? (Math.abs(preset.color[0] - color[0]) < 0.02 && Math.abs(preset.color[1] - color[1]) < 0.02 && Math.abs(preset.color[2] - color[2]) < 0.02) : false
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={selected}
                  title={`${preset.label} screen`}
                  onClick={() => pick(preset.color)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    selected ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/25" style={{ background: chromaCss(preset.color) }} aria-hidden />
                  {preset.label}
                </button>
              )
            })}
          </div>
          {/* Sliders commit on release via pointerup/leave — one undo entry. */}
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Similarity</span>
            <input
              type="range"
              min={0}
              max={0.35}
              step={0.01}
              value={key ? key.similarity : 0.3}
              aria-label="Key similarity"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ similarity: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.similarity.toFixed(2) : '—'}</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">Smoothness</span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.01}
              value={key ? key.smoothness : 0.08}
              aria-label="Key edge smoothness"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ smoothness: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.smoothness.toFixed(2) : '—'}</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-lo">
            <span className="w-16 shrink-0">De-spill</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={key ? key.spill : 0.25}
              aria-label="Spill suppression"
              className="min-w-0 flex-1 accent-accent"
              onInput={(e) => setChromaKey({ spill: Number((e.target as HTMLInputElement).value) })}
              onPointerUp={() => commit('Chroma key')}
              onPointerLeave={() => key?.enabled && commit('Chroma key')}
            />
            <span className="w-7 shrink-0 text-right tabular-nums text-hi/80">{key ? key.spill.toFixed(2) : '—'}</span>
          </label>
          <p className="text-[10px] text-lo" aria-hidden>
            Pick the screen color, then tune Similarity until the backdrop disappears cleanly.
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-lo" aria-hidden>
          Film your subject on a solid screen, turn this on, and the screen drops away.
        </p>
      )}
    </section>
  )
}
