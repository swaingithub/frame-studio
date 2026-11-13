/**
 * Image thumbnail generation. Runs off the main thread in a module worker so
 * importing dozens of photos never blocks the UI.
 */

interface ThumbnailRequest {
  uid: number
  bitmap: ImageBitmap
}

interface ThumbnailResponse {
  uid: number
  blob: Blob | null
  error?: string
}

const pending = new Map<number, { resolve: (b: Blob | null) => void; reject: (e: Error) => void }>()
let uid = 0
let worker: Worker | null = null

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (typeof window === 'undefined') return null
  try {
    worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), {
      type: 'module',
      name: 'fs-thumbnails',
    })
    worker.addEventListener('message', (event: MessageEvent<ThumbnailResponse>) => {
      const { uid: responseUid, blob, error } = event.data
      const job = pending.get(responseUid)
      if (!job) return
      pending.delete(responseUid)
      if (error) job.reject(new Error(error))
      else job.resolve(blob)
    })
    return worker
  } catch {
    return null
  }
}

/** Downscales to a ≤480px webp thumbnail; returns null when unsupported. */
export async function makeThumbnail(bitmap: ImageBitmap): Promise<Blob | null> {
  const w = ensureWorker()
  if (!w) return null
  const id = ++uid
  return new Promise<Blob | null>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ uid: id, bitmap } satisfies ThumbnailRequest, [bitmap])
  })
}
