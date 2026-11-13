import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Workspace preferences: resizable panel widths + collapsed state.
 * Persisted to localStorage so the layout survives reloads.
 */
interface UIState {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  setLeftWidth: (w: number) => void
  setRightWidth: (w: number) => void
  toggleLeft: () => void
  toggleRight: () => void
}

export const PANEL_MIN = 200
export const PANEL_MAX = 560

const clampWidth = (w: number): number => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)))

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      leftWidth: 300,
      rightWidth: 320,
      leftCollapsed: false,
      rightCollapsed: false,
      setLeftWidth: (w) => set({ leftWidth: clampWidth(w) }),
      setRightWidth: (w) => set({ rightWidth: clampWidth(w) }),
      toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
      toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
    }),
    { name: 'frame-studio-ui' },
  ),
)

export function clampPanelWidth(w: number): number {
  return clampWidth(w)
}
