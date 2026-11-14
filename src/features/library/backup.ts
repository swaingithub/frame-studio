import { db } from '../../core/db/schema'
import { getBlob, putBlob } from '../../core/db/blobStore'
import { newId } from '../../core/id'
import { normalizeProjectName, sanitizeProject } from '../projects/model'
import type { MediaAsset } from '../../core/db/schema'
import { downloadBlob } from '../video/exportVideo'

/**
 * Local project backup: one `.framestudio.json` file containing the project
 * document and every referenced asset's media (base64) + thumbnail. The
 * privacy model is unchanged — the file is generated and saved entirely by
 * the user; nothing is uploaded anywhere.
 */

export const BACKUP_FORMAT = 'frame-studio-backup'
export const BACKUP_VERSION = 1

interface BackupAsset {
  asset: MediaAsset
  /** Original media as a data URL (base64). */
  file: string
  thumb: string | null
}

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  project: unknown
  assets: BackupAsset[]
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

function fromDataUrl(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const referencedIds = (doc: { photoAssets?: unknown; videoAssets?: unknown }): Set<string> => {
  const ids = new Set<string>()
  for (const list of [doc.photoAssets, doc.videoAssets]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const id = typeof item === 'string' ? item : (item as { id?: unknown })?.id
      if (typeof id === 'string') ids.add(id)
    }
  }
  return ids
}

/** Builds and downloads the backup file for a project. */
export async function exportProjectBackup(projectId: string): Promise<void> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('Project not found')
  const ids = referencedIds(project)
  const assets: BackupAsset[] = []
  for (const id of ids) {
    const asset = await db.assets.get(id)
    if (!asset) continue
    const file = await getBlob({ key: asset.storageKey, storage: asset.storage })
    if (!file) continue
    const thumb = asset.thumbKey ? await getBlob({ key: asset.thumbKey, storage: asset.storage }) : null
    assets.push({
      asset,
      file: await toDataUrl(file),
      thumb: thumb ? await toDataUrl(thumb) : null,
    })
  }
  const backup: ProjectBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    project,
    assets,
  }
  const name = normalizeProjectName(project.name).replace(/[\\/:*?"<>|]+/g, '_')
  const json = JSON.stringify(backup)
  await downloadBlob(new Blob([json], { type: 'application/json' }), `${name}.framestudio.json`)
}

/**
 * Imports a backup file: re-stores every asset with fresh storage keys and
 * installs the project under a new id (so re-importing never overwrites).
 * Returns the new project id.
 */
export async function importProjectBackup(raw: unknown): Promise<string> {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a backup file')
  const rec = raw as Record<string, unknown>
  if (rec.format !== BACKUP_FORMAT) throw new Error('Not a Frame Studio backup')
  const project = sanitizeProject(rec.project)
  if (!project) throw new Error('Backup contains no valid project')
  const list = Array.isArray(rec.assets) ? rec.assets : []

  const restoredIds = new Map<string, string>()
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const meta = entry.asset as MediaAsset | undefined
    if (!meta || typeof meta.id !== 'string' || typeof entry.file !== 'string') continue
    const file = fromDataUrl(entry.file)
    const stored = await putBlob(file)
    let thumbKey: string | null = null
    if (typeof entry.thumb === 'string') {
      const thumbStored = await putBlob(fromDataUrl(entry.thumb))
      thumbKey = thumbStored.key
    }
    const asset: MediaAsset = {
      ...meta,
      id: newId('asset_'),
      storage: stored.storage,
      storageKey: stored.key,
      thumbKey,
    }
    await db.assets.put(asset)
    restoredIds.set(meta.id, asset.id)
  }

  // Remap asset references to the freshly stored copies.
  const remapped = {
    ...project,
    photoAssets: project.photoAssets.map((id) => restoredIds.get(id) ?? id),
    videoAssets: project.videoAssets.map((id) => restoredIds.get(id) ?? id),
    id: newId('proj_'),
    name: normalizeProjectName(`${project.name} (imported)`),
    updatedAt: Date.now(),
  }
  await db.projects.put(remapped)
  return remapped.id
}
