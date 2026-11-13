/**
 * One-shot capability detection. The app queries this to pick a rendering
 * path (WebGL2 → Canvas 2D), an import path (WebCodecs → media elements),
 * and a storage path (OPFS → IndexedDB). Everything degrades gracefully.
 */
export interface Capabilities {
  webgl2: boolean
  webcodecs: boolean
  opfs: boolean
  offscreenCanvas: boolean
  webpEncode: boolean
  fileSystemAccess: boolean
}

function detectWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    return false
  }
}

function detectWebpEncode(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

let cached: Capabilities | null = null

export function detectCapabilities(): Capabilities {
  if (cached) return cached
  cached = {
    webgl2: detectWebGL2(),
    webcodecs: typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window,
    opfs: typeof navigator !== 'undefined' && !!navigator.storage && 'getDirectory' in navigator.storage,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    webpEncode: detectWebpEncode(),
    fileSystemAccess: typeof window !== 'undefined' && 'showOpenFilePicker' in window,
  }
  return cached
}

/** Short human-readable summary used by the header status badge. */
export function capabilitySummary(c: Capabilities): string {
  return [
    `WebGL2 ${c.webgl2 ? 'supported' : 'unsupported — Canvas 2D fallback will be used'}`,
    `WebCodecs ${c.webcodecs ? 'supported' : 'unsupported — media-element decode will be used'}`,
    `OPFS ${c.opfs ? 'available' : 'unavailable — large files will be stored in IndexedDB'}`,
  ].join('\n')
}
