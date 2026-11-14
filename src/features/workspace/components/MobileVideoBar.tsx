import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Gauge, Scissors, Trash2, Volume2, Wand2, Film, Music2, Redo2, SlidersHorizontal, Type as TypeIcon, Undo2, X } from 'lucide-react'
import { VideoInspectorBody } from '../../video/components/VideoInspector'
import { useVideoEditor } from '../../video/store'
import { useAssets } from '../../library/useAssets'
import type { Histogram } from '../../../core/render/histogram'
import { cn } from '../../../lib/cn'

/**
 * CapCut-style mobile bottom bar for the video editor: Undo/Redo plus
 * "Edit clip" and "Overlays" tools in swipe-up sheets. Export/Compare stay
 * on the stage controls (already touch-sized).
 */

export function MobileVideoBar(): ReactNode {
  const undo = useVideoEditor((s) => s.undo)
  const redo = useVideoEditor((s) => s.redo)
  const [sheet, setSheet] = useState<'edit' | 'overlays' | null>(null)
  const histogram = useVideoEditor((s) => s.histogram) as Histogram | null
  const hasClips = useVideoEditor((s) => s.sequence.length > 0)
  // Contextual mode: selecting a clip swaps the bar for clip tools (CapCut).
  const activeClipId = useVideoEditor((s) => s.activeClipId)
  const setActiveClip = useVideoEditor((s) => s.setActiveClip)
  const splitAtPlayhead = useVideoEditor((s) => s.splitAtPlayhead)
  const duplicateClip = useVideoEditor((s) => s.duplicateClip)
  const removeClip = useVideoEditor((s) => s.removeClip)

  if (activeClipId !== null) {
    return (
      <>
        <div
          className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-line bg-panel px-2 pt-1.5"
          style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
          role="toolbar"
          aria-label="Clip tools"
        >
          <BarButton icon={<Scissors size={18} />} label="Split" onPress={splitAtPlayhead} className="min-w-[4.25rem] shrink-0" />
          <BarButton
            icon={<Gauge size={18} />}
            label="Speed"
            onPress={() => setSheet('edit')}
            className="min-w-[4.25rem] shrink-0"
          />
          <BarButton
            icon={<Volume2 size={18} />}
            label="Volume"
            onPress={() => setSheet('edit')}
            className="min-w-[4.25rem] shrink-0"
          />
          <BarButton
            icon={<Wand2 size={18} />}
            label="Animate"
            onPress={() => setSheet('edit')}
            className="min-w-[4.25rem] shrink-0"
          />
          <BarButton icon={<Copy size={18} />} label="Copy" onPress={() => duplicateClip(activeClipId)} className="min-w-[4.25rem] shrink-0" />
          <BarButton icon={<Trash2 size={18} />} label="Delete" onPress={() => removeClip(activeClipId)} className="min-w-[4.25rem] shrink-0" />
          <BarButton icon={<Check size={18} />} label="Done" primary onPress={() => setActiveClip(null)} className="min-w-[4.25rem] shrink-0" />
        </div>
        {sheet === 'edit' ? (
          <ToolSheet title="Edit clip" onClose={() => setSheet(null)}>
            <VideoInspectorBody histogram={histogram} />
          </ToolSheet>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div
        className="flex shrink-0 items-center justify-around gap-1 border-t border-line bg-panel px-2 pt-1.5"
        style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      >
        <BarButton icon={<Undo2 size={18} />} label="Undo" onPress={undo} />
        <BarButton icon={<Redo2 size={18} />} label="Redo" onPress={redo} />
        <BarButton
          icon={<Music2 size={18} />}
          label="Overlays"
          onPress={() => setSheet('overlays')}
          disabled={!hasClips}
        />
        <BarButton
          icon={<SlidersHorizontal size={18} />}
          label="Edit"
          primary
          onPress={() => setSheet('edit')}
          disabled={!hasClips}
        />
      </div>
      {sheet === 'edit' ? (
        <ToolSheet title="Edit clip" onClose={() => setSheet(null)}>
          <VideoInspectorBody histogram={histogram} />
        </ToolSheet>
      ) : null}
      {sheet === 'overlays' ? (
        <ToolSheet title="Overlays" onClose={() => setSheet(null)}>
          <OverlayTools />
        </ToolSheet>
      ) : null}
    </>
  )
}

/** Big thumb buttons mirroring MobileEditBar's style. */
function BarButton({
  label,
  icon,
  onPress,
  primary,
  disabled,
  className,
}: {
  label: string
  icon: ReactNode
  onPress?: () => void
  primary?: boolean
  disabled?: boolean
  className?: string
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors disabled:opacity-40',
        primary ? 'bg-accent text-onaccent' : 'text-lo hover:text-hi active:text-hi',
        className,
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

/** Shared swipe-up sheet (grab handle drag or ✕ to close). */
function ToolSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        aria-label="Close tools"
        className="fixed inset-0 z-40 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fs-anim-sheet-in fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-line bg-panel shadow-2xl"
        style={{ height: '86dvh' }}
      >
        <div
          className="mx-auto mt-1.5 h-1 w-10 shrink-0 cursor-grab touch-none rounded-full bg-line"
          aria-hidden
          onPointerDown={(e) => {
            const startY = e.clientY
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            const onUp = (ev: PointerEvent): void => {
              if (ev.clientY - startY > 56) onClose()
              el.releasePointerCapture(e.pointerId)
            }
            el.addEventListener('pointerup', onUp, { once: true })
          }}
        />
        <div className="flex h-11 shrink-0 items-center border-b border-line px-3">
          <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-lo">{title}</h2>
          <button
            type="button"
            aria-label="Close tools"
            onClick={onClose}
            className="rounded-md p-1.5 text-lo hover:text-hi"
          >
            <X size={17} />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </>
  )
}

/** Add text / sticker / media overlays to the base track. */
function OverlayTools(): ReactNode {
  const assets = useAssets()
  const addText = useVideoEditor((s) => s.addTextOverlay)
  const addMedia = useVideoEditor((s) => s.addMediaOverlay)
  const media = (assets ?? []).filter((a) => a.kind === 'video' || a.kind === 'image')

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
          <TypeIcon size={11} />
          Text & stickers
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addText()}
            className="rounded-lg border border-dashed border-accent/50 px-4 py-3 text-sm font-medium text-hi hover:bg-accent-soft"
          >
            + Add text layer
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-lo">Emoji stickers are in the sticker picker (smiley icon) on the stage overlays row.</p>
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
          <Film size={11} />
          Media layers
        </h3>
        {media.length === 0 ? (
          <p className="text-xs text-lo">Import media in the library first.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {media.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => addMedia(a.id, a.kind === 'image' ? 'image' : 'video')}
                className="flex h-11 items-center gap-2 rounded-lg border border-dashed border-accent/50 px-3 text-sm text-hi hover:bg-accent-soft"
              >
                {a.kind === 'image' ? <Film size={14} /> : <Film size={14} />}
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
