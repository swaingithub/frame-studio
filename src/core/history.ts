import type { EditDoc } from './adjustments/edits'

/**
 * Pure snapshot-history engine. Each committed edit records a before/after
 * pair; undo/redo walk the stacks, and `jumpTo` truncates like Photoshop's
 * history palette. Bounded to keep memory predictable. Generic over the
 * snapshot type so the video editor can reuse it with its own doc type.
 */

export interface HistoryEntry<T = EditDoc> {
  id: string
  photoId: string
  label: string
  before: T
  after: T
  at: number
}

export const HISTORY_CAP = 80

let seq = 0
function nextId(): string {
  seq += 1
  return `h${seq}`
}

export class EditHistory<T = EditDoc> {
  undoStack: HistoryEntry<T>[] = []
  redoStack: HistoryEntry<T>[] = []

  /** Records a commit; clears the redo stack (linear-time semantics) even
   *  for no-op commits, so any new action kills redo like Photoshop's. */
  record(photoId: string, label: string, before: T, after: T): HistoryEntry<T> | null {
    const noOp = JSON.stringify(before) === JSON.stringify(after)
    this.redoStack = []
    if (noOp) return null
    const entry: HistoryEntry<T> = {
      id: nextId(),
      photoId,
      label,
      before,
      after,
      at: Date.now(),
    }
    this.undoStack.push(entry)
    if (this.undoStack.length > HISTORY_CAP) this.undoStack.shift()
    return entry
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Like record, but a rapid series with the same label collapses into one
   *  entry — drag gestures move things live and commit as a single undo step. */
  recordCoalesced(photoId: string, label: string, before: T, after: T, windowMs = 900): HistoryEntry<T> | null {
    const noOp = JSON.stringify(before) === JSON.stringify(after)
    this.redoStack = []
    if (noOp) return null
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && last.photoId === photoId && last.label === label && Date.now() - last.at < windowMs) {
      last.after = after
      last.at = Date.now()
      return last
    }
    return this.record(photoId, label, before, after)
  }

  /** Pops the last entry; caller applies entry.before to entry.photoId. */
  undo(): HistoryEntry<T> | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.redoStack.push(entry)
    return entry
  }

  redo(): HistoryEntry<T> | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    this.undoStack.push(entry)
    return entry
  }

  /** Truncates: jump to (keep) an entry in the undo stack by id. */
  jumpTo(entryId: string): HistoryEntry<T> | null {
    const index = this.undoStack.findIndex((e) => e.id === entryId)
    if (index < 0) return null
    // Up to and including `index` stays as undo history; the rest becomes redo.
    const moved = this.undoStack.splice(index + 1)
    moved.reverse()
    this.redoStack = moved
    return this.undoStack[index] ?? null
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  /** Most recent first — for panel rendering. */
  list(): HistoryEntry<T>[] {
    return [...this.undoStack].reverse()
  }
}
