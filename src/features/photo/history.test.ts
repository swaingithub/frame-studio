import { describe, expect, it } from 'vitest'
import { createDefaultEditDoc, withAdjustment } from '../../core/adjustments/edits'
import { EditHistory } from './history'

function docA(): ReturnType<typeof createDefaultEditDoc> {
  return withAdjustment(createDefaultEditDoc(), 'exposure', 10)
}
function docB(): ReturnType<typeof createDefaultEditDoc> {
  return withAdjustment(createDefaultEditDoc(), 'contrast', 20)
}

describe('EditHistory', () => {
  it('records commits and clears redo', () => {
    const h = new EditHistory()
    expect(h.record('p1', 'Exposure', createDefaultEditDoc(), docA())).not.toBeNull()
    expect(h.record('p1', 'Exposure (same)', docA(), docA())).toBeNull()
    h.record('p1', 'Contrast', docA(), docB())
    expect(h.canUndo).toBe(true)
    expect(h.canRedo).toBe(false)
    // redo cleared by a new record after an undo
    const undone = h.undo()
    expect(undone?.label).toBe('Contrast')
    expect(h.canRedo).toBe(true)
    h.record('p1', 'Straighten', docA(), docA())
    expect(h.canRedo).toBe(false)
  })

  it('round-trips undo/redo', () => {
    const h = new EditHistory()
    h.record('p1', 'Exposure', createDefaultEditDoc(), docA())
    const entry = h.undo()
    expect(entry?.before.adjustments.exposure).toBe(0)
    const redone = h.redo()
    expect(redone?.after.adjustments.exposure).toBe(10)
    expect(h.canRedo).toBe(false)
  })

  it('coalesces rapid same-label commits into one undo step', () => {
    const h = new EditHistory()
    h.recordCoalesced('p1', 'Overlay timing', createDefaultEditDoc(), docA())
    // A rapid follow-up with the same label replaces the last entry's "after".
    const second = h.recordCoalesced('p1', 'Overlay timing', docA(), docB())
    expect(h.undoStack).toHaveLength(1)
    expect(second?.after.adjustments.contrast).toBe(20)
    const undone = h.undo()
    expect(undone?.label).toBe('Overlay timing')
    expect(undone?.before.adjustments.exposure).toBe(0)
    // A different label starts a new entry again.
    h.recordCoalesced('p1', 'Overlay', docB(), docA())
    expect(h.undoStack).toHaveLength(1)
  })

  it('jumps to an entry and truncates', () => {
    const h = new EditHistory()
    const d1 = withAdjustment(createDefaultEditDoc(), 'exposure', 10)
    const e1 = h.record('p1', 'Exposure', createDefaultEditDoc(), d1)
    const d2 = withAdjustment(d1, 'contrast', 20)
    const e2 = h.record('p1', 'Contrast', d1, d2)
    const d3 = withAdjustment(d2, 'clarity', 30)
    h.record('p1', 'Clarity', d2, d3)
    expect(h.list()).toHaveLength(3)

    const kept = h.jumpTo(e1?.id ?? '')
    expect(kept?.label).toBe('Exposure')
    expect(h.undoStack.length).toBe(1)
    expect(h.redoStack.length).toBe(2)
    // redoing the first popped redo returns e2
    const redone = h.redo()
    expect(redone?.id).toBe(e2?.id)
  })

  it('caps the undo stack', () => {
    const h = new EditHistory()
    for (let i = 0; i < 100; i++) {
      h.record('p1', `Step ${i}`, withAdjustment(createDefaultEditDoc(), 'exposure', i), withAdjustment(createDefaultEditDoc(), 'exposure', i + 1))
    }
    expect(h.undoStack.length).toBeLessThanOrEqual(80)
  })

  it('clear() resets both stacks', () => {
    const h = new EditHistory()
    h.record('p1', 'x', createDefaultEditDoc(), docA())
    h.clear()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })
})
