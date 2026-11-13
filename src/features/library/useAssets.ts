import { useLiveQuery } from 'dexie-react-hooks'
import { db, type MediaAsset } from '../../core/db/schema'
import { getBlob } from '../../core/db/blobStore'
import { useObjectUrl } from '../../lib/hooks'

/**
 * Reactively loads an asset thumbnail blob. IndexedDB reads are debounced by
 * Dexie's cache, so grids stay smooth with hundreds of assets.
 */
export function useThumbnail(asset: MediaAsset | null | undefined): string | null {
  const key = asset?.thumbKey ?? null
  const blob = useLiveQuery(async () => {
    if (!key) return undefined
    const record = await db.files.get(key)
    return record?.blob
  }, [key])
  return useObjectUrl(blob)
}

/** Loads the full-resolution media blob of an asset. */
export function useAssetBlob(asset: MediaAsset | null | undefined): Blob | null {
  const id = asset?.id
  const storage = asset?.storage
  const storageKey = asset?.storageKey
  const blob = useLiveQuery(async () => {
    if (!id || !storageKey) return undefined
    return getBlob({ key: storageKey, storage: storage ?? 'idb' })
  }, [id])
  return blob ?? null
}

export function useAssets(): MediaAsset[] | undefined {
  return useLiveQuery(() => db.assets.toArray(), [])
}
