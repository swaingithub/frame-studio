import { useState, type ReactNode } from 'react'
import { Crop, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Undo2, Redo2, ChevronsDownUp, ChevronsUpDown, Users, Trash2 } from 'lucide-react'
import { ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../core/adjustments/registry'
import type { EditDoc } from '../../../core/adjustments/edits'
import { usePreviewSource } from './EditorCanvas'
import { HistogramView } from '../../../ui/histogramView'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { PresetBar } from '../../../ui/presetBar'
import { CurveSection } from './CurveEditor'
import { HslPanel } from './HslPanel'
import { defaultHslMixer, defaultToneCurve } from '../../../core/adjustments/color'
import { Button } from '../../../ui/button'
import { usePhotoEditor } from '../store'
import { useProjectsStore } from '../../projects/store'
import { defaultMask, MASK_SHAPES, MASK_SHAPE_LABELS, type Mask } from '../../../core/adjustments/edits'
import { statsFromHistogram } from '../../../core/adjustments/presets'
import { cn } from '../../../lib/cn'
import { User } from 'lucide-react'
import type { Histogram } from '../../../core/render/histogram'

/**
 * Right-hand photo inspector: live histogram, the four adjustment sections,
 * geometry tools, and the global undo/redo controls.
 */
const sectionLabels: Record<string, string> = {
  light: 'Light',
  color: 'Color',
  detail: 'Detail',
  effects: 'Effects',
}

/** Social-first crop shortcuts (ratio = width / height in output space). */
const QUICK_FRAMES = [
  { label: 'Reel 9:16', ratio: 9 / 16, hint: 'Vertical video/story format' },
  { label: 'Post 1:1', ratio: 1, hint: 'Square feed post' },
  { label: 'Portrait 4:5', ratio: 4 / 5, hint: 'Portrait feed post' },
  { label: 'Wide 16:9', ratio: 16 / 9, hint: 'Landscape/thumbnail' },
]

interface AdjustPanelProps {
  doc: EditDoc | null
  histogram: Histogram | null
  unedited: boolean
  simpleMode?: boolean
}

export function AdjustPanel({ doc, histogram, unedited, simpleMode = true }: AdjustPanelProps): ReactNode {
  const editor = usePhotoEditor()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const stats = histogram ? statsFromHistogram(histogram.l, histogram.samples) : null
  // Live thumbnail source for the Looks gallery — re-derives per photo switch.
  const photoId = useProjectsStore((s) => s.projects.find((p) => p.id === s.currentId)?.activePhotoId ?? null)
  const source = usePreviewSource(photoId)

  if (!doc) {
    return (
      <p className="rounded-lg border border-dashed border-line p-3 text-xs text-lo">
        Select a photo to edit it.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <HistogramView histogram={histogram} />

      <PresetBar
        stats={stats}
        onApply={(values, label, lookId) => editor.applyAdjustments(values, label, lookId)}
        source={source}
        sourceKey={photoId ?? undefined}
      />
      <LookStrength />
      <BackgroundRemovalSection />

      {ADJUSTMENT_SECTIONS.map((section) => {
        const params = ADJUSTMENTS.filter((p) => p.section === section)
        const isCollapsed = collapsed[section] === true
        const isTouched = params.some((p) => doc.adjustments[p.key] !== p.def)
        return (
          <section key={section} className="rounded-xl border border-line/70 bg-elevated/35 p-3">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [section]: !c[section] }))}
              className="mb-2 flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo hover:text-hi"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
              {sectionLabels[section]}
              {isTouched ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Adjusted" /> : null}
            </button>
            {!isCollapsed ? (
              <div className="flex flex-col gap-2.5">
                {params.map((param) => (
                  <AdjustSlider
                    key={param.key}
                    param={param}
                    value={doc.adjustments[param.key]}
                    onLive={(v) => editor.setAdjustment(param.key, v)}
                    onCommit={() => editor.commit(param.label)}
                    onReset={() => {
                      editor.setAdjustment(param.key, param.def)
                      editor.commit(`${param.label} reset`)
                    }}
                  />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}

      {!simpleMode ? <CurveSection curve={doc.curves ?? defaultToneCurve()} collapsed={collapsed.curve === true} onToggle={() => setCollapsed((c) => ({ ...c, curve: !c.curve }))} /> : null}
      {!simpleMode ? <HslPanel mixer={doc.hsl ?? defaultHslMixer()} collapsed={collapsed.hsl === true} onToggle={() => setCollapsed((c) => ({ ...c, hsl: !c.hsl }))} /> : null}

      {/* Geometry */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-lo">Geometry</h3>
        <div className="mb-2.5 flex gap-1">
          <Button size="icon" variant="subtle" title="Rotate left 90°" aria-label="Rotate left" onClick={() => editor.setGeometryRel(-1)}>
            <RotateCcw size={13} />
          </Button>
          <Button size="icon" variant="subtle" title="Rotate right 90°" aria-label="Rotate right" onClick={() => editor.setGeometryRel(1)}>
            <RotateCw size={13} />
          </Button>
          <Button size="icon" variant="subtle" title="Flip horizontal" aria-label="Flip horizontal" onClick={() => editor.setGeometryRel(0, true)}>
            <FlipHorizontal size={13} />
          </Button>
          <Button size="icon" variant="subtle" title="Flip vertical" aria-label="Flip vertical" onClick={() => editor.setGeometryRel(0, false, true)}>
            <FlipVertical size={13} />
          </Button>
          <Button size="sm" variant="subtle" className="ml-auto" onClick={() => editor.startCrop()} disabled={editor.crop !== null}>
            <Crop size={12} />
            Crop
          </Button>
        </div>
        {/* One-tap social frames: opens crop pre-fitted to a popular ratio. */}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Quick frames">
          {QUICK_FRAMES.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={editor.crop !== null}
              onClick={() => editor.startCrop(q.ratio)}
              title={q.hint}
              className="rounded-md border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-lo transition-colors hover:text-hi disabled:opacity-40"
            >
              {q.label}
            </button>
          ))}
        </div>
        <AdjustSlider
          param={{ label: 'Straighten', min: -45, max: 45, def: 0 }}
          value={doc.geometry.straighten}
          onLive={(v) => editor.setStraightenLive(v)}
          onCommit={() => {
            editor.setStraightenActive(false)
            editor.commit('Straighten')
          }}
          onReset={() => {
            editor.setStraightenLive(0)
            editor.setStraightenActive(false)
            editor.commit('Straighten')
          }}
          disabled={editor.crop !== null}
        />
      </section>

      {/* Batch: share this photo's grade with every other photo in the project */}
      {!simpleMode ? <BatchSection unedited={unedited} /> : null}

      {/* Shape mask: grade only inside/outside a shape */}
      {!simpleMode ? <MaskSection /> : null}

      {/* Text layers: draggable captions on the photo */}
      <TextOverlaySection />

      {/* History */}
      <section>
        <div className="mb-2 flex items-center gap-1">
          <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-lo">History</h3>
          <Button size="icon" variant="ghost" title="Undo (⌘Z)" aria-label="Undo" disabled={!editor.history.canUndo} onClick={editor.undo}>
            <Undo2 size={13} />
          </Button>
          <Button size="icon" variant="ghost" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!editor.history.canRedo} onClick={editor.redo}>
            <Redo2 size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={editor.resetEdits} disabled={unedited}>
            <RotateCcw size={12} />
            Reset
          </Button>
        </div>
        <HistoryList />
      </section>
    </div>
  )
}

/** AI background removal: on/off toggle. First use downloads the segmenter. */
function BackgroundRemovalSection(): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const setBackgroundRemoval = usePhotoEditor((s) => s.setBackgroundRemoval)
  const on = doc?.backgroundRemoval?.enabled === true
  if (!doc) return null
  return (
    <section aria-label="Background removal">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setBackgroundRemoval(!on)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
          on ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
        )}
      >
        <span className="flex items-center gap-1.5">
          <User size={12} />
          {on ? 'Subject cut out' : 'Remove background'}
        </span>
        <span className={cn('text-[10px]', on ? 'text-onaccent/70' : 'text-lo')}>{on ? 'On' : 'Off'}</span>
      </button>
      {!on ? (
        <p className="mt-1.5 text-[10px] leading-snug text-lo">
          Keeps the subject, drops the rest. First use downloads a small model (~250 KB), then it runs offline on this device.
        </p>
      ) : null}
    </section>
  )
}

/** Strength dial for the active look: re-mixes adjustments from the preset. */
function LookStrength(): ReactNode {
  const look = usePhotoEditor((s) => s.doc?.look ?? null)
  const editor = usePhotoEditor()
  if (!look) return null
  return (
    <AdjustSlider
      param={{ label: 'Look strength', min: 0, max: 1, def: 1, step: 0.01 }}
      value={look.strength}
      onLive={(v) => editor.setLookStrength(v)}
      onCommit={() => editor.commit('Look strength')}
      onReset={() => {
        editor.setLookStrength(1)
        editor.commit('Look strength')
      }}
    />
  )
}

/** Text layers: add, edit, style and delete photo text overlays. */
function TextOverlaySection(): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const addTextOverlay = usePhotoEditor((s) => s.addTextOverlay)
  const setOverlayLive = usePhotoEditor((s) => s.setOverlayLive)
  const removeTextOverlay = usePhotoEditor((s) => s.removeTextOverlay)
  const commit = usePhotoEditor((s) => s.commit)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (!doc) return null
  const overlays = doc.textOverlays ?? []

  return (
    <section aria-label="Text overlays">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-lo">Text layers</h3>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          addTextOverlay(draft.trim())
          setDraft('')
        }}
        className="flex gap-1"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={140}
          placeholder="Add text layer…"
          aria-label="New text layer text"
          className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none placeholder:text-lo focus-visible:border-accent"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 rounded-md border border-dashed border-accent/50 px-2 text-[11px] font-medium text-hi hover:bg-accent-soft disabled:opacity-40"
        >
          Add
        </button>
      </form>
      {overlays.map((o) => (
        <div key={o.id} className="mt-2 rounded-md border border-line bg-elevated p-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              aria-expanded={expanded === o.id}
              className="min-w-0 flex-1 truncate text-left text-[11px] text-hi hover:text-accent"
              title={o.text}
            >
              “{o.text}”
            </button>
            <button
              type="button"
              onClick={() => removeTextOverlay(o.id)}
              aria-label={`Delete text layer ${o.text.slice(0, 20)}`}
              className="rounded p-0.5 text-lo hover:bg-hover hover:text-danger"
            >
              <Trash2 size={11} />
            </button>
          </div>
          {expanded === o.id ? (
            <div className="mt-1.5 flex flex-col gap-2.5">
              <input
                type="text"
                value={o.text}
                maxLength={140}
                onChange={(e) => setOverlayLive(o.id, { text: e.target.value })}
                onBlur={() => commit('Edit text')}
                aria-label={`Edit text of layer ${o.text.slice(0, 20)}`}
                className="w-full rounded-md border border-line bg-panel px-2 py-1 text-xs text-hi outline-none focus-visible:border-accent"
              />
              <AdjustSlider
                param={{ label: 'Size', min: 0.4, max: 3, def: 1, step: 0.05 }}
                value={o.scale}
                onLive={(v) => setOverlayLive(o.id, { scale: v })}
                onCommit={() => commit('Text size')}
                onReset={() => {
                  setOverlayLive(o.id, { scale: 1 })
                  commit('Text size')
                }}
              />
              <AdjustSlider
                param={{ label: 'Opacity', min: 0.05, max: 1, def: 1, step: 0.01 }}
                value={o.opacity}
                onLive={(v) => setOverlayLive(o.id, { opacity: v })}
                onCommit={() => commit('Text opacity')}
                onReset={() => {
                  setOverlayLive(o.id, { opacity: 1 })
                  commit('Text opacity')
                }}
              />
              <AdjustSlider
                param={{ label: 'Rotation', min: -180, max: 180, def: 0, step: 1 }}
                value={o.rotation}
                onLive={(v) => setOverlayLive(o.id, { rotation: v })}
                onCommit={() => commit('Text rotation')}
                onReset={() => {
                  setOverlayLive(o.id, { rotation: 0 })
                  commit('Text rotation')
                }}
              />
              <label className="flex items-center gap-2 text-[10px] text-lo">
                Colour
                <input
                  type="color"
                  value={o.color}
                  aria-label={`Colour of layer ${o.text.slice(0, 20)}`}
                  onInput={(e) => setOverlayLive(o.id, { color: (e.target as HTMLInputElement).value })}
                  onBlur={() => commit('Text colour')}
                  className="h-6 w-8 cursor-pointer rounded border border-line bg-panel"
                />
              </label>
              <p className="text-[10px] text-lo">Drag the text on the photo to reposition it.</p>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

/** Shape mask: grade only inside/outside a chosen shape (shared GL pipeline). */
function MaskSection(): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const setMask = usePhotoEditor((s) => s.setMask)
  const commit = usePhotoEditor((s) => s.commit)
  if (!doc) return null

  const mask = doc.mask
  const shape = mask?.shape ?? 'none'
  const m = mask ?? defaultMask()
  const commitMask = (): void => commit('Mask')
  const reset = (p: Partial<Mask>): void => {
    setMask(p)
    commitMask()
  }

  return (
    <section aria-label="Mask controls">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-lo">Mask</h3>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Mask shape">
        {MASK_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            onClick={() => {
              setMask({ shape: s })
              commitMask()
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
        <div className="mt-2 flex flex-col gap-2.5">
          <AdjustSlider param={{ label: 'X', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.x}
            onLive={(v) => setMask({ x: v })} onCommit={() => commitMask()} onReset={() => reset({ x: 0.5 })} />
          <AdjustSlider param={{ label: 'Y', min: 0, max: 1, def: 0.5, step: 0.01 }} value={m.y}
            onLive={(v) => setMask({ y: v })} onCommit={() => commitMask()} onReset={() => reset({ y: 0.5 })} />
          <AdjustSlider param={{ label: 'Width', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.w}
            onLive={(v) => setMask({ w: v })} onCommit={() => commitMask()} onReset={() => reset({ w: 0.6 })} />
          <AdjustSlider param={{ label: 'Height', min: 0.05, max: 1.5, def: 0.6, step: 0.01 }} value={m.h}
            onLive={(v) => setMask({ h: v })} onCommit={() => commitMask()} onReset={() => reset({ h: 0.6 })} />
          <AdjustSlider param={{ label: 'Rotation', min: -180, max: 180, def: 0, step: 1 }} value={m.rotation}
            onLive={(v) => setMask({ rotation: v })} onCommit={() => commitMask()} onReset={() => reset({ rotation: 0 })} />
          <AdjustSlider param={{ label: 'Feather', min: 0, max: 0.4, def: 0.08, step: 0.01 }} value={m.feather}
            onLive={(v) => setMask({ feather: v })} onCommit={() => commitMask()} onReset={() => reset({ feather: 0.08 })} />
          <button
            type="button"
            role="switch"
            aria-checked={m.invert}
            onClick={() => {
              setMask({ invert: !m.invert })
              commitMask()
            }}
            className={cn(
              'self-start rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
              m.invert ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
            )}
          >
            {m.invert ? 'Inverted — grading outside the shape' : 'Grading inside the shape — invert?'}
          </button>
          <p className="text-[10px] leading-snug text-lo">
            Sliders above only affect what the mask reveals — the rest of the photo keeps its grade.
          </p>
        </div>
      ) : null}
    </section>
  )
}

/** Batch grading: one click copies the current look onto every other photo. */
function BatchSection({ unedited }: { unedited: boolean }): ReactNode {
  const applyGradeToAll = usePhotoEditor((s) => s.applyGradeToAll)
  const count = useProjectsStore((s) => s.projects.find((p) => p.id === s.currentId)?.photoAssets.length ?? 0)
  const disabled = unedited || count < 2
  const hint = count < 2
    ? 'Add another photo to the project to batch-apply.'
    : unedited
      ? 'Adjust this photo first, then copy the look to all.'
      : `Copies this look to the other ${count - 1} photo${count - 1 === 1 ? '' : 's'} (their crops stay).`
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-lo">Batch</h3>
      <button
        type="button"
        disabled={disabled}
        onClick={() => applyGradeToAll()}
        title={hint}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-accent/50 px-2.5 py-1.5 text-[11px] font-medium text-hi hover:bg-accent-soft disabled:opacity-40"
      >
        <Users size={12} aria-hidden />
        Apply grade to all photos
      </button>
    </section>
  )
}

function HistoryList(): ReactNode {
  const history = usePhotoEditor((s) => s.history)
  const jumpTo = usePhotoEditor((s) => s.jumpTo)
  const revision = usePhotoEditor((s) => s.revision)
  const entries = history.list()
  void revision

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-2.5 text-[11px] text-lo">
        No edits yet — every change is recorded here.
      </p>
    )
  }
  return (
    <ol className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
      {entries.map((entry, indexInList) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => jumpTo(entry.id)}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px]',
              indexInList === 0 ? 'bg-accent-soft text-accent' : 'text-lo hover:bg-hover hover:text-hi',
            )}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
