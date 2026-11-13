import { create } from 'zustand'
import { db } from '../../core/db/schema'
import { defaultFilters, type LibraryFilters } from './filters'
import type { MediaAsset } from '../../core/db/schema'

/**
 * Library UI state (filters, selection). The asset list itself is read
 * reactively from Dexie via useLiveQuery — no duplication of source of truth.
 */

interface LibraryState extends LibraryFilters {
  /** Selection is a list for iteration order stability; updates are immutable. */
  selection: string[]
  importTotal: number
  importDone: number
  importCurrent: string
  importing: boolean
  patch: (f: Partial<LibraryFilters>) => void
  toggleSelect: (id: string) => void
  selectMany: (ids: string[]) => void
  clearSelection: () => void
  setImportProgress: (p: { total: number; done: number; current: string }) => void
  setImporting: (v: boolean) => void
}

export const useLibraryStore = create<LibraryState>()((set) => ({
  ...defaultFilters,
  selection: [],
  importTotal: 0,
  importDone: 0,
  importCurrent: '',
  importing: false,
  patch: (f) => set(f),
  toggleSelect: (id) =>
    set((s) => {
      if (s.selection.includes(id)) return { selection: s.selection.filter((x) => x !== id) }
      return { selection: [...s.selection, id] }
    }),
  selectMany: (ids) =>
    set((s) => {
      const merged = new Set([...s.selection, ...ids])
      return { selection: [...merged] }
    }),
  clearSelection: () => set({ selection: [] }),
  setImportProgress: ({ total, done, current }) => set({ importTotal: total, importDone: done, importCurrent: current }),
  setImporting: (v) => set({ importing: v }),
}))

export async function updateAssets(ids: string[], mutate: (a: MediaAsset) => MediaAsset): Promise<void> {
  await db.transaction('rw', db.assets, async () => {
    for (const id of ids) {
      const asset = await db.assets.get(id)
      if (asset) await db.assets.put(mutate(asset))
    }
  })
}

/** Adds/updates one tag on a set of assets. */
export function setTagOn(ids: string[], tag: string, add: boolean): Promise<void> {
  return updateAssets(ids, (a) => {
    const has = a.tags.includes(tag)
    if (add && !has) return { ...a, tags: [...a.tags, tag] }
    if (!add && has) return { ...a, tags: a.tags.filter((t) => t !== tag) }
    return a
  })
}
