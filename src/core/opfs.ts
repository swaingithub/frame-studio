/**
 * Origin Private File System helpers. Used for large media blobs ( videos )
 * so we do not blow IndexedDB quota. All functions are safe to call in any
 * browser — when OPFS is unavailable the callers fall back to IndexedDB.
 */

const MEDIA_DIR = 'media'

function root(): Promise<FileSystemDirectoryHandle> | null {
  if (typeof navigator === 'undefined' || !navigator.storage || !('getDirectory' in navigator.storage)) {
    return null
  }
  return navigator.storage.getDirectory()
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const base = await root()
  if (!base) return null
  try {
    return await base.getDirectoryHandle(MEDIA_DIR, { create })
  } catch {
    return null
  }
}

export function opfsAvailable(): boolean {
  return root() !== null
}

export async function opfsPut(key: string, blob: Blob): Promise<void> {
  const dir = await mediaDir(true)
  if (!dir) throw new Error('OPFS unavailable')
  const handle = await dir.getFileHandle(key, { create: true })
  const writable = await handle.createWritable()
  try {
    await blob.stream().pipeTo(writable)
  } catch {
    // `writable` is already closed/errored by pipeTo in most failure modes;
    // close defensively for browsers that keep it open.
    try {
      await writable.close()
    } catch {
      /* ignore */
    }
    throw new Error(`OPFS write failed for ${key}`)
  }
}

export async function opfsGet(key: string): Promise<Blob | null> {
  try {
    const dir = await mediaDir(false)
    if (!dir) return null
    const handle = await dir.getFileHandle(key)
    const file = await handle.getFile()
    return file
  } catch {
    return null
  }
}

export async function opfsDelete(key: string): Promise<void> {
  try {
    const dir = await mediaDir(false)
    if (!dir) return
    await dir.removeEntry(key)
  } catch {
    /* already gone */
  }
}
