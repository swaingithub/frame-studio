/// <reference lib="dom" />
/**
 * Worker: draws an incoming ImageBitmap into an OffscreenCanvas scaled to
 * at most 480px on the long edge and encodes it as a WebP thumbnail.
 * Falls back to JPEG bytes when WebP encoding is unavailable.
 */

const MAX_EDGE = 480

const scope: { addEventListener: typeof self.addEventListener; postMessage: (data: unknown) => void } = self

scope.addEventListener('message', async (event) => {
  const { uid, bitmap } = (event as MessageEvent<{ uid: number; bitmap: ImageBitmap }>).data
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    let blob: Blob
    try {
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
    } catch {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    }
    scope.postMessage({ uid, blob })
  } catch (err) {
    scope.postMessage({ uid, blob: null, error: String(err) })
  }
})
