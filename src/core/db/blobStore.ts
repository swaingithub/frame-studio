import { db, type BlobStorage } from './schema'
import { opfsAvailable, opfsPut, opfsGet, opfsDelete } from '../opfs'
import { newId } from '../id'

/**
 * Blob storage with automatic routing:
 *  - small/medium blobs → IndexedDB (`files` table), fast and reliable
 *  - large blobs (videos) → OPFS when available, to protect IDB quota
 * Callers remember the returned {key, storage} pair; reads use the same
 * accessor so the storage backend is invisible to the rest of the app.
 */

/** Files above this threshold prefer OPFS when it exists. ~160 MB. */
const OPFS_THRESHOLD = 160 * 1024 * 1024

export interface BlobRef {
  key: string
  storage: BlobStorage
}

export async function putBlob(blob: Blob): Promise<BlobRef> {
  if (blob.size > OPFS_THRESHOLD && opfsAvailable()) {
    const key = newId('blob_')
    try {
      await opfsPut(key, blob)
      return { key, storage: 'opfs' }
    } catch {
      // fall through to IndexedDB
    }
  }
  const key = newId('blob_')
  await db.files.put({ key, blob })
  return { key, storage: 'idb' }
}

export async function getBlob(ref: BlobRef): Promise<Blob | null> {
  if (ref.storage === 'opfs') {
    return (await opfsGet(ref.key)) ?? null
  }
  const record = await db.files.get(ref.key)
  return record?.blob ?? null
}

export async function deleteBlob(ref: BlobRef): Promise<void> {
  if (ref.storage === 'opfs') {
    await opfsDelete(ref.key)
    return
  }
  await db.files.delete(ref.key)
}
