/**
 * AI background removal (MediaPipe selfie segmentation, WASM/GPU).
 *
 * Runs fully in-browser: the ~250 KB segmentation model downloads once from
 * the CDN (opt-in, clearly labelled in the UI) and is then cached by the
 * browser. Every frame is segmented on this device — no upload, no server.
 *
 * The model is the MediaPipe "selfie segmenter": it separates PEOPLE from
 * their background. That matches the CapCut use case (talking-head vlogs,
 * green-screen-free cutouts) — for solid-colour backdrops the chroma key is
 * still the right tool.
 */
import { FilesetResolver, ImageSegmenter, type ImageSegmenterResult } from '@mediapipe/tasks-vision'

/** Pinned CDN paths — first use downloads, then the browser cache serves them. */
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

let loading: Promise<ImageSegmenter> | null = null
let segmenter: ImageSegmenter | null = null

/**
 * Loads the segmenter (idempotent). `onProgress` receives a 0..1 estimate
 * while the wasm + model download; there is no fine-grained event, so it
 * animates the UI bar rather than reporting exact bytes.
 */
export function ensureSegmenter(onProgress?: (fraction: number) => void): Promise<ImageSegmenter> {
  if (segmenter) return Promise.resolve(segmenter)
  if (loading) return loading
  let done = 0
  onProgress?.(0.05)
  const tick = setInterval(() => {
    done = Math.min(done + 1, 9)
    onProgress?.(done / 10)
  }, 250)
  loading = (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
      const seg = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
      segmenter = seg
      onProgress?.(1)
      return seg
    } finally {
      clearInterval(tick)
    }
  })()
  loading.catch(() => {
    loading = null // allow a retry after a transient failure
  })
  return loading
}

/** Whether the model finished loading (UI can switch from note to toggle). */
export function segmenterReady(): boolean {
  return segmenter !== null
}

/** Frees the WASM/GPU resources (called on page unload / full reset). */
export function disposeSegmenter(): void {
  segmenter?.close()
  segmenter = null
  loading = null
}

/**
 * One shared mask canvas. drawGL uploads it as a texture inside the same
 * synchronous call that produced it, so reuse across frames is safe.
 */
const maskCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
let maskCtx: CanvasRenderingContext2D | null = null

/**
 * Paints one confidence mask (alpha = subject confidence) into the shared
 * mask canvas (256×256 — the shader samples by UV, so low resolution is fine
 * and keeps per-frame cost tiny). Returns the mask canvas.
 */
function paintConfidenceMask(data: Float32Array, w: number, h: number): HTMLCanvasElement | null {
  if (!maskCanvas) return null
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w
    maskCanvas.height = h
    maskCtx = maskCanvas.getContext('2d')
  }
  const ctx = maskCtx
  if (!ctx) return null
  const image = ctx.createImageData(w, h)
  for (let i = 0; i < data.length; i++) {
    const alpha = Math.max(0, Math.min(1, data[i]))
    image.data[i * 4] = 255
    image.data[i * 4 + 1] = 255
    image.data[i * 4 + 2] = 255
    image.data[i * 4 + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(image, 0, 0)
  return maskCanvas
}

/**
 * Segments `video`'s current frame and paints the subject as WHITE with
 * alpha = confidence into the shared mask canvas.
 * Returns the mask canvas, or null when segmentation is unavailable yet.
 */
export function segmentSubjectMask(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (!segmenter) return null
  let result: ImageSegmenterResult | null = null
  try {
    result = segmenter.segment(video)
  } catch {
    return null
  }
  const masks = result?.confidenceMasks
  if (!masks || masks.length === 0) {
    result?.close()
    return null
  }
  // The selfie model's last confidence mask is the foreground subject.
  const mask = masks[masks.length - 1]
  const data = mask.getAsFloat32Array()
  const w = mask.width
  const h = mask.height
  result.close()
  return paintConfidenceMask(data, w, h)
}

/**
 * Same as segmentSubjectMask, but for a photo: runs the segmenter on the
 * bitmap directly (IMAGE running mode). Awaits the segmenter so the first
 * call after a model download reports progress through the UI.
 */
export async function segmentImageBitmap(bitmap: ImageBitmap): Promise<HTMLCanvasElement | null> {
  const seg = await ensureSegmenter()
  let result: ImageSegmenterResult | null = null
  try {
    result = seg.segment(bitmap)
  } catch {
    return null
  }
  const masks = result?.confidenceMasks
  if (!masks || masks.length === 0) {
    result?.close()
    return null
  }
  const mask = masks[masks.length - 1]
  const data = mask.getAsFloat32Array()
  const w = mask.width
  const h = mask.height
  result.close()
  return paintConfidenceMask(data, w, h)
}
