import { Redo2, RotateCcw, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useVideoEditor, videoEditsChanged } from '../store'

/** Undo/redo/reset buttons for the video workspace. */
export function VideoHistoryButtons(): ReactNode {
  const canUndo = useVideoEditor((s) => s.history.canUndo)
  const canRedo = useVideoEditor((s) => s.history.canRedo)
  const undo = useVideoEditor((s) => s.undo)
  const redo = useVideoEditor((s) => s.redo)
  return (
    <>
      <button
        type="button"
        className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
        title="Undo (⌘Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 size={13} />
      </button>
      <button
        type="button"
        className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2 size={13} />
      </button>
    </>
  )
}

/** The "Reset" button — resets all edits on the selected clip. */
export function ResetButton(): ReactNode {
  const doc = useVideoEditor((s) => s.doc)
  const resetEdits = useVideoEditor((s) => s.resetEdits)
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-lo hover:bg-hover hover:text-hi disabled:opacity-30"
      title="Reset all edits on the selected clip"
      aria-label="Reset all edits"
      disabled={!doc || !videoEditsChanged(doc)}
      onClick={resetEdits}
    >
      <RotateCcw size={13} />
      Reset
    </button>
  )
}

/** Scrollable list of video-edit history entries. */
export function VideoHistoryList(): ReactNode {
  const history = useVideoEditor((s) => s.history)
  const jumpTo = useVideoEditor((s) => s.jumpTo)
  const revision = useVideoEditor((s) => s.revision)
  void revision
  const entries = history.list()

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-2.5 text-[11px] text-lo">
        No edits yet — splits, trims, grades, speed and titles appear here.
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
            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-lo hover:bg-hover hover:text-hi data-[latest=true]:bg-accent-soft data-[latest=true]:text-accent"
            data-latest={indexInList === 0}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
