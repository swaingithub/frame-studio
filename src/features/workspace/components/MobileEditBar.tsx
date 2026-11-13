import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Eye, Redo2, SlidersHorizontal, Trash2, Undo2, X, Download } from 'lucide-react'
import { AdjustPanel } from '../../photo/components/AdjustPanel'
import { isDocNeutral } from '../../../core/adjustments/edits'
import { usePhotoEditor } from '../../photo/store'
import { useMediaQuery, PHONE_QUERY } from '../../../ui/useMediaQuery'
import { cn } from '../../../lib/cn'

/**
 * CapCut-style mobile bottom bar for the photo editor: press-and-hold
 * Compare, big Undo/Redo, and an Edit button that raises the full tool
 * panel in a swipe-up bottom sheet. Only rendered on phones.
 */

export interface MobileEditBarProps {
  /** Opens the export dialog. */
  onExport: () => void
}

export function MobileEditBar({ onExport }: MobileEditBarProps): ReactNode {
  const undo = usePhotoEditor((s) => s.undo)
  const redo = usePhotoEditor((s) => s.redo)
  const setBypass = usePhotoEditor((s) => s.setBypass)
  const bypass = usePhotoEditor((s) => s.bypass)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <div
        className="flex shrink-0 items-center justify-around gap-1 border-t border-line bg-panel px-2 pt-1.5"
        style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      >
        <BarButton
          label={bypass ? 'Original' : 'Compare (hold)'}
          icon={<Eye size={18} />}
          active={bypass}
          onPressStart={() => setBypass(true)}
          onPressEnd={() => setBypass(false)}
        />
        <BarButton icon={<Undo2 size={18} />} label="Undo" onPress={undo} />
        <BarButton icon={<Redo2 size={18} />} label="Redo" onPress={redo} />
        <BarButton
          icon={<SlidersHorizontal size={18} />}
          label="Edit"
          primary
          onPress={() => setSheetOpen(true)}
        />
        <BarButton icon={<Download size={18} />} label="Export" onPress={onExport} />
      </div>
      {sheetOpen ? <EditSheet onClose={() => setSheetOpen(false)} /> : null}
    </>
  )
}

/** Press-and-hold button: bypasses edits while the finger stays down. */
function BarButton({
  label,
  icon,
  onPress,
  onPressStart,
  onPressEnd,
  primary,
  active,
}: {
  label: string
  icon: ReactNode
  onPress?: () => void
  onPressStart?: () => void
  onPressEnd?: () => void
  primary?: boolean
  active?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onPress}
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      className={cn(
        'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors',
        primary
          ? 'text-onaccent'
          : active
            ? 'text-accent'
            : 'text-lo hover:text-hi active:text-hi',
        primary && 'bg-accent',
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label.split(' (')[0]}</span>
    </button>
  )
}

/** Full tool panel in a swipe-up sheet (the same AdjustPanel as desktop). */
function EditSheet({ onClose }: { onClose: () => void }): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const histogram = usePhotoEditor((s) => s.histogram)
  const resetEdits = usePhotoEditor((s) => s.resetEdits)
  const phone = useMediaQuery(PHONE_QUERY)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!phone) return null

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
        aria-label="Editing tools"
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-line bg-panel shadow-2xl"
        style={{ height: '86dvh' }}
      >
        <div
          className="mx-auto mt-1.5 h-1 w-10 shrink-0 cursor-grab touch-none rounded-full bg-line"
          aria-hidden
          onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
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
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
          <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-lo">Edit photo</h2>
          <button
            type="button"
            aria-label="Reset all edits"
            title="Reset all edits"
            onClick={() => resetEdits()}
            className="rounded-md p-1.5 text-lo hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            aria-label="Close tools"
            onClick={onClose}
            className="rounded-md p-1.5 text-lo hover:text-hi"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {doc ? (
            <AdjustPanel doc={doc} histogram={histogram} unedited={isDocNeutral(doc)} />
          ) : (
            <p className="rounded-lg border border-dashed border-line p-3 text-xs text-lo">
              Select a photo to edit it.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
