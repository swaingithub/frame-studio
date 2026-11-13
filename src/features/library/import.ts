import { db } from '../../core/db/schema'
import { putBlob, deleteBlob } from '../../core/db/blobStore'
import { newId } from '../../core/id'
import { probeVideo, probeAudio } from './probe'
import { makeThumbnail } from '../../lib/thumbnailClient'
import type { AssetKind, MediaAsset } from '../../core/db/schema'

/**
 * Import pipeline: validate → probe metadata → store binary → generate
 * thumbnail → insert the asset record. Fully local; no network access ever.
 */

export const ACCEPTED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', // images (HEIC/RAW arrive in Phase 2)
  'mp4', 'm4v', 'mov', 'webm', 'mkv', // video containers
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', // audio
] as const

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'])

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(file: File): AssetKind | null {
  const ext = extensionOf(file.name)
  if (IMAGE_EXT.has(ext) || file.type.startsWith('image/')) {
    if (IMAGE_EXT.has(ext) || [ 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif' ].includes(file.type)) {
      return 'image'
    }
  }
  if (VIDEO_EXT.has(ext) || file.type.startsWith('video/')) return 'video'
  if (AUDIO_EXT.has(ext) || file.type.startsWith('audio/')) return 'audio'
  return null
}

export interface ImportFailure {
  name: string
  reason: string
}

export interface ImportResult {
  imported: MediaAsset[]
  failed: ImportFailure[]
}

export interface ImportProgress {
  total: number
  done: number
  current: string
}

async function importOne(file: File, kind: AssetKind): Promise<MediaAsset> {
  const base: Omit<MediaAsset, 'thumbKey'> = {
    id: newId('asset_'),
    name: file.name,
    kind,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    addedAt: Date.now(),
    modifiedAt: file.lastModified > 0 ? file.lastModified : null,
    width: null,
    height: null,
    duration: null,
    camera: null,
    exif: null,
    rating: 0,
    favorite: false,
    tags: [],
    storage: 'idb',
    storageKey: '',
  }

  let thumb: Blob | null = null

  if (kind === 'image') {
    const bitmap = await createImageBitmap(file)
    base.width = bitmap.width
    base.height = bitmap.height
    try {
      thumb = await makeThumbnail(bitmap)
    } finally {
      bitmap.close()
    }
  } else if (kind === 'video') {
    const meta = await probeVideo(file)
    base.width = meta.width
    base.height = meta.height
    base.duration = meta.duration
    thumb = meta.thumb
  } else {
    const meta = await probeAudio(file)
    base.duration = meta.duration
  }

  const stored = await putBlob(file)
  base.storage = stored.storage
  base.storageKey = stored.key

  let thumbKey: string | null = null
  if (thumb && thumb.size > 0) {
    const storedThumb = await putBlob(thumb)
    thumbKey = storedThumb.key
  }

  const asset: MediaAsset = { ...base, thumbKey }
  await db.assets.put(asset)
  return asset
}

/** Imports many files; individual failures never abort the batch. */
export async function importFiles(
  files: readonly File[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const imported: MediaAsset[] = []
  const failed: ImportFailure[] = []
  let done = 0

  for (const file of files) {
    onProgress?.({ total: files.length, done, current: file.name })
    if (file.size === 0) {
      failed.push({ name: file.name, reason: 'File is empty.' })
      continue
    }
    const kind = kindOf(file)
    if (!kind) {
      failed.push({ name: file.name, reason: 'Unsupported file type for Frame Studio.' })
      continue
    }
    try {
      imported.push(await importOne(file, kind))
    } catch (err) {
      failed.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) })
    }
    done++
  }

  onProgress?.({ total: files.length, done, current: '' })
  return { imported, failed }
}

/** Removes an asset plus its binaries, and detaches it from every project. */
export async function deleteAssetCompletely(id: string): Promise<void> {
  const asset = await db.assets.get(id)
  if (!asset) return

  await db.transaction('rw', db.assets, db.projects, db.files, async () => {
    await db.assets.delete(id)
    await db.files.delete(asset.storageKey)
    if (asset.thumbKey) await db.files.delete(asset.thumbKey)
    const projects = await db.projects.toArray()
    for (const p of projects) {
      const inPhoto = p.photoAssets.includes(id)
      const inVideo = p.videoAssets.includes(id)
      if (!inPhoto && !inVideo) continue
      await db.projects.put({
        ...p,
        photoAssets: p.photoAssets.filter((a) => a !== id),
        videoAssets: p.videoAssets.filter((a) => a !== id),
        activePhotoId: p.activePhotoId === id ? null : p.activePhotoId,
        updatedAt: Date.now(),
      })
    }
  })
  if (asset.storage === 'opfs') {
    await deleteBlob({ key: asset.storageKey, storage: 'opfs' })
  }
}
