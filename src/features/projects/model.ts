import { PROJECT_SCHEMA_VERSION, type ProjectDoc, type WorkspaceKind } from '../../core/db/schema'
import { newId } from '../../core/id'

/**
 * Pure project-document helpers — no IO, fully unit-testable.
 * `sanitizeProject` is the recovery path for corrupted/stale documents:
 * anything that fails validation is repaired with defaults instead of
 * crashing the app.
 */

export const NAME_MAX_LENGTH = 80

export function normalizeProjectName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX_LENGTH)
  return name.length > 0 ? name : 'Untitled Project'
}

export function createProjectDoc(name: string, workspace: WorkspaceKind, now = Date.now()): ProjectDoc {
  return {
    id: newId('proj_'),
    name: normalizeProjectName(name),
    createdAt: now,
    updatedAt: now,
    activeWorkspace: workspace,
    photoAssets: [],
    videoAssets: [],
    activePhotoId: null,
    activeVideoId: null,
    photoEdits: {},
    videoEdits: {},
    videoSequence: null,
    activeVideoClipId: null,
    timeline: null,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }
}

export function duplicateProjectDoc(source: ProjectDoc, now = Date.now()): ProjectDoc {
  return {
    ...source,
    photoAssets: [...source.photoAssets],
    videoAssets: [...source.videoAssets],
    photoEdits: { ...source.photoEdits },
    videoEdits: { ...source.videoEdits },
    videoSequence: source.videoSequence ?? null,
    activeVideoClipId: source.activeVideoClipId ?? null,
    id: newId('proj_'),
    name: normalizeProjectName(`${source.name} copy`),
    createdAt: now,
    updatedAt: now,
  }
}

export function touchProject(doc: ProjectDoc, now = Date.now()): ProjectDoc {
  return { ...doc, updatedAt: now }
}

export function addAssetsToDoc(doc: ProjectDoc, ids: readonly string[], kind: 'image' | 'video' | 'audio'): ProjectDoc {
  const listKey = kind === 'image' ? 'photoAssets' : 'videoAssets'
  const current = doc[listKey]
  const next = [...current]
  for (const id of ids) if (!next.includes(id)) next.push(id)
  return touchProject({ ...doc, [listKey]: next })
}

export function removeAssetFromDoc(doc: ProjectDoc, id: string): ProjectDoc {
  const videoEdits = { ...doc.videoEdits }
  delete videoEdits[id]
  return touchProject({
    ...doc,
    photoAssets: doc.photoAssets.filter((a) => a !== id),
    videoAssets: doc.videoAssets.filter((a) => a !== id),
    activePhotoId: doc.activePhotoId === id ? null : doc.activePhotoId,
    activeVideoId: doc.activeVideoId === id ? null : doc.activeVideoId,
    videoEdits,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Validates + repairs a project doc read from disk. Anything that carries the
 * faintest signature of a project (its `id` or `name` key) is recovered with
 * defaults; unrelated garbage returns null.
 */
export function sanitizeProject(raw: unknown): ProjectDoc | null {
  if (!isRecord(raw)) return null
  if (raw.name === undefined && raw.id === undefined) return null

  const now = Date.now()
  const workspace = raw.activeWorkspace === 'video' ? 'video' : 'photo'

  return {
    id: typeof raw.id === 'string' ? raw.id : newId('proj_'),
    name: typeof raw.name === 'string' ? normalizeProjectName(raw.name) : 'Recovered Project',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    activeWorkspace: workspace,
    photoAssets: asStringArray(raw.photoAssets),
    videoAssets: asStringArray(raw.videoAssets),
    activePhotoId: typeof raw.activePhotoId === 'string' ? raw.activePhotoId : null,
    activeVideoId: typeof raw.activeVideoId === 'string' ? raw.activeVideoId : null,
    photoEdits: isRecord(raw.photoEdits) ? raw.photoEdits : {},
    videoEdits: isRecord(raw.videoEdits) ? raw.videoEdits : {},
    videoSequence: raw.videoSequence ?? null,
    activeVideoClipId: typeof raw.activeVideoClipId === 'string' ? raw.activeVideoClipId : null,
    timeline: raw.timeline ?? null,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }
}
