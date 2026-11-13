import { create } from 'zustand'

/** Toast state lives here so components (ui/toast.tsx) stay pure views. */

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  detail?: string
  /** Optional thumbnail URL (e.g. export result preview). */
  image?: string
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1
const autoDismissMs = 4500
/** One pending auto-dismiss handle per toast. */
type ToastTimer = ReturnType<typeof setTimeout>
const timers = new Map<number, ToastTimer>()

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }))
    const handle: ToastTimer = setTimeout(() => {
      useToastStore.getState().dismiss(id)
    }, autoDismissMs)
    timers.set(id, handle)
  },
  dismiss: (id) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Imperative helper: fire a toast from stores or event handlers. */
export function toast(title: string, detail?: string, kind: ToastKind = 'info', image?: string): void {
  useToastStore.getState().push({ title, detail, kind, image })
}
