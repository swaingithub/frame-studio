/**
 * Local project backup.
 *
 * v2 (current): a `.framestudio.zip` — a ZIP archive (fflate, raw bytes, no
 * base64) containing the project document (`manifest.json`) and every
 * referenced asset's media + thumbnail (`assets/<id>.bin`). v1 was a single
 * `.framestudio.json` whose assets were base64 data URLs inside one big JSON
 * string — a project with a few large videos could exhaust memory and `atob`
 * on the way back in was slow. Import still accepts the v1 JSON format.
 *
 * The privacy model is unchanged — the file is generated and saved entirely
 * by the user; nothing is uploaded anywhere.
 */

import { unzipSync, Zip, ZipPassThrough } from 'fflate'
import { db } from '../../core/db/schema'
import { getBlob, putBlob } from '../../core/db/blobStore'
import { newId } from '../../core/id'
import { normalizeProjectName, sanitizeProject } from '../projects/model'
import type { MediaAsset, ProjectDoc } from '../../core/db/schema'
import { downloadBlob } from '../../lib/download'

export const BACKUP_FORMAT = 'frame-studio-backup'
export const BACKUP_VERSION = 2

/** One asset inside the v2 ZIP archive. */
interface ZipAssetEntry {
  /** Original asset meta — re-keyed with fresh ids on import. */
  meta: MediaAsset
}

/** `manifest.json` inside the v2 archive. */
interface ZipManifest {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  project: ProjectDoc
  assets: ZipAssetEntry[]
}

const ZIP_EXT = '.framestudio.zip'
const assetEntry = (id: string): string => `assets/${id}.bin`
const thumbEntry = (id: string): string => `assets/${id}.thumb.bin`

/** ZIP files start with the bytes "PK\x03\x04"; JSON backups do not. */
function isZip(head: Uint8Array): boolean {
  return head[0] === 0x50 && head[1] === 0x4b
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

/**
 * v2 export: one ZIP holding the manifest and the raw asset bytes. Peak
 * memory is roughly the largest single asset instead of the whole project
 * (no base64, no giant JSON string).
 */
export async function exportProjectBackup(projectId: string): Promise<void> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('Project not found')
  const ids = referencedIds(project)

  // Stream the zip with fflate's Zip class: media goes in via ZipPassThrough
  // (store-only — compressed media rarely shrinks further, and deflate on
  // already-compressed bytes just wastes CPU), so peak memory is one asset
  // plus the emitted zip bytes instead of every asset in the project.
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let failure: unknown = null
  const zip = new Zip((err, data) => {
    if (err) failure = err
    else if (data) chunks.push(data)
  })
  const addStored = (name: string, bytes: Uint8Array): void => {
    const entry = new ZipPassThrough(name)
    zip.add(entry)
    entry.push(bytes, true)
  }

  const entries: ZipAssetEntry[] = []
  for (const id of ids) {
    const asset = await db.assets.get(id)
    if (!asset) continue
    const file = await getBlob({ key: asset.storageKey, storage: asset.storage })
    if (!file) continue
    addStored(assetEntry(asset.id), new Uint8Array(await file.arrayBuffer()))
    if (asset.thumbKey) {
      const thumb = await getBlob({ key: asset.thumbKey, storage: asset.storage })
      if (thumb) addStored(thumbEntry(asset.id), new Uint8Array(await thumb.arrayBuffer()))
    }
    entries.push({ meta: asset })
  }
  const manifest: ZipManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    project,
    assets: entries,
  }
  addStored('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
  zip.end()
  if (failure) throw failure

  const name = normalizeProjectName(project.name).replace(/[\\/:*?"<>|]+/g, '_')
  await downloadBlob(new Blob(chunks, { type: 'application/zip' }), `${name}${ZIP_EXT}`)
}

/** Restores the assets in a v2 manifest and installs the project. */
async function importZipBackup(arrayBuffer: ArrayBuffer): Promise<string> {
  const files = unzipSync(new Uint8Array(arrayBuffer))
  const manifestRaw = files['manifest.json']
  if (!manifestRaw) throw new Error('Backup is missing its manifest')
  let manifest: ZipManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw))
  } catch {
    throw new Error('Backup manifest is unreadable')
  }
  if (!manifest || manifest.format !== BACKUP_FORMAT) throw new Error('Not a Frame Studio backup')
  const project = sanitizeProject(manifest.project)
  if (!project) throw new Error('Backup contains no valid project')

  const restoredIds = new Map<string, string>()
  for (const entry of Array.isArray(manifest.assets) ? manifest.assets : []) {
    const meta = entry?.meta
    if (!meta || typeof meta.id !== 'string') continue
    const bytes = files[assetEntry(meta.id)]
    if (!bytes) continue
    const stored = await putBlob(new Blob([bytes], { type: meta.mimeType || 'application/octet-stream' }))
    let thumbKey: string | null = null
    const thumbBytes = files[thumbEntry(meta.id)]
    if (thumbBytes) thumbKey = (await putBlob(new Blob([thumbBytes]))).key
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
  return finishImport(project, restoredIds)
}

/** Legacy v1 import — reads the base64-JSON backup format. */
async function importJsonBackup(raw: unknown): Promise<string> {
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
  return finishImport(project, restoredIds)
}

/** Dispatches on the file: ZIP (v2) or legacy JSON (v1). Returns the new project id. */
export async function importProjectBackup(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (isZip(head)) return importZipBackup(await file.arrayBuffer())
  return importJsonBackup(JSON.parse(await file.text()))
}

/** Remaps asset references to the freshly stored copies and installs the project. */
async function finishImport(project: ProjectDoc, restoredIds: Map<string, string>): Promise<string> {
  const remapped: ProjectDoc = {
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

function fromDataUrl(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
