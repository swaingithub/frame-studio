import { create } from 'zustand'
import { db } from '../../core/db/schema'
import {
  addAssetsToDoc,
  createProjectDoc,
  duplicateProjectDoc,
  normalizeProjectName,
  removeAssetFromDoc,
  sanitizeProject,
  touchProject,
} from './model'
import { toast } from '../../ui/toastStore'
import type { AssetKind, ProjectDoc, WorkspaceKind } from '../../core/db/schema'

/**
 * Projects store — the source of truth for the projects list and the active
 * project, kept in sync with IndexedDB with a debounced autosave.
 */

export type SaveState = 'idle' | 'saving' | 'saved'

interface ProjectsState {
  projects: ProjectDoc[]
  currentId: string | null
  loaded: boolean
  saveState: SaveState
  init: () => Promise<void>
  reload: () => Promise<void>
  create: (name: string, workspace: WorkspaceKind) => Promise<ProjectDoc>
  createSample: () => Promise<void>
  open: (id: string) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  updateCurrent: (updater: (doc: ProjectDoc) => ProjectDoc) => void
  addAssetsToCurrent: (ids: string[], kind: AssetKind) => void
  removeAssetFromCurrent: (id: string) => void
  /** Selects the active clip in the video workspace (persisted). */
  setActiveVideo: (id: string | null) => void
  saveIn: (ms: number) => void
}

const AUTOSAVE_DELAY_MS = 500

let saveTimer: number | undefined
let saveCounter = 0

function persistProject(doc: ProjectDoc): void {
  const serial = ++saveCounter
  useProjectsStore.setState({ saveState: 'saving' })
  void db.projects
    .put(touchProject(doc))
    .then(() => {
      if (serial === saveCounter) useProjectsStore.setState({ saveState: 'saved' })
    })
    .catch((err: unknown) => {
      if (serial === saveCounter) {
        useProjectsStore.setState({ saveState: 'idle' })
        toast('Autosave failed', err instanceof Error ? err.message : String(err), 'error')
      }
    })
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  currentId: null,
  loaded: false,
  saveState: 'idle',

  init: async () => {
    const raw = await db.projects.toArray()
    const projects = raw.map(sanitizeProject).filter((p): p is ProjectDoc => p !== null)
    // Repair anything that was sanitized (drops corrupt docs into valid shape).
    for (let i = 0; i < projects.length; i++) {
      if (projects[i] !== raw[i]) {
        await db.projects.put(projects[i]).catch(() => undefined)
      }
    }
    projects.sort((a, b) => b.updatedAt - a.updatedAt)
    const previous = projects[0] ?? null
    set({ projects, currentId: previous?.id ?? null, loaded: true })
  },

  reload: async () => {
    const raw = await db.projects.toArray()
    const projects = raw.map(sanitizeProject).filter((p): p is ProjectDoc => p !== null)
    projects.sort((a, b) => b.updatedAt - a.updatedAt)
    set((s) => ({
      projects,
      currentId: s.currentId && projects.some((p) => p.id === s.currentId) ? s.currentId : projects[0]?.id ?? null,
    }))
  },

  create: async (name, workspace) => {
    const doc = createProjectDoc(name, workspace)
    await db.projects.put(doc)
    set((s) => ({ projects: [doc, ...s.projects], currentId: doc.id }))
    return doc
  },

  createSample: async () => {
    const { createSampleProject } = await import('./sampleProject')
    await createSampleProject()
  },

  open: (id) => {
    if (get().projects.some((p) => p.id === id)) set({ currentId: id })
  },

  rename: (id, name) => {
    const doc = get().projects.find((p) => p.id === id)
    if (!doc) return
    const next = touchProject({ ...doc, name: normalizeProjectName(name) })
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? next : p)) }))
    persistProject(next)
  },

  duplicate: async (id) => {
    const doc = get().projects.find((p) => p.id === id)
    if (!doc) return
    const copy = duplicateProjectDoc(doc)
    await db.projects.put(copy)
    set((s) => {
      const projects = [copy, ...s.projects].sort((a, b) => b.updatedAt - a.updatedAt)
      return { projects, currentId: copy.id }
    })
  },

  remove: async (id) => {
    await db.projects.delete(id)
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id)
      const currentId = s.currentId === id ? projects[0]?.id ?? null : s.currentId
      return { projects, currentId }
    })
  },

  updateCurrent: (updater) => {
    const { currentId, projects } = get()
    const doc = projects.find((p) => p.id === currentId)
    if (!doc) return
    const next = touchProject(updater(doc))
    if (next === doc) return
    set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }))
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => persistProject(next), AUTOSAVE_DELAY_MS)
  },

  addAssetsToCurrent: (ids, kind) => {
    get().updateCurrent((doc) => addAssetsToDoc(doc, ids, kind))
  },

  removeAssetFromCurrent: (id) => {
    get().updateCurrent((doc) => removeAssetFromDoc(doc, id))
  },

  setActiveVideo: (id) => {
    get().updateCurrent((doc) => (doc.activeVideoId === id ? doc : { ...doc, activeVideoId: id }))
  },

  saveIn: (ms) => {
    const doc = get().projects.find((p) => p.id === get().currentId)
    if (!doc) return
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => persistProject(doc), ms)
  },
}))

/** Convenience hook: the active project document (or null). */
export function useCurrentProject(): ProjectDoc | null {
  return useProjectsStore((s) => s.projects.find((p) => p.id === s.currentId) ?? null)
}
