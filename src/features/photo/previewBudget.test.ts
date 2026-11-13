import { describe, expect, it } from 'vitest'
import { previewBudget } from './components/EditorCanvas'

/**
 * The budget adapts to viewport width and device memory. jsdom reports a
 * desktop-ish viewport and no `deviceMemory`, so the desktop tier applies.
 */
describe('previewBudget', () => {
  it('uses the full budget on desktop-sized viewports', () => {
    expect(previewBudget()).toBe(2048)
  })

  it('drops to the compact tier under 1000px', () => {
    const prev = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true, writable: true })
    try {
      expect(previewBudget()).toBe(1280)
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: prev, configurable: true, writable: true })
    }
  })

  it('drops to the low-memory tier when deviceMemory ≤ 2', () => {
    const prev = (navigator as { deviceMemory?: number }).deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true })
    try {
      expect(previewBudget()).toBe(1024)
    } finally {
      Object.defineProperty(navigator, 'deviceMemory', { value: prev, configurable: true })
    }
  })
})
