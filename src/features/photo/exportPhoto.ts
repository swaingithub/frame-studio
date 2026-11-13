import { defaultAdjustments } from '../../core/adjustments/registry'
import { planForDoc } from '../../core/render/geometry'
import { sourceHeight, sourceWidth, type TexSource } from '../../core/render/webgl'
import { draw2dFallback } from '../../core/render/canvas2d'
import { renderEdit } from '../../core/render/pipeline'
import { newId } from '../../core/id'
import { type EditDoc } from '../../core/adjustments/edits'
import { drawPhotoOverlays } from './overlayDraw'

/**
 * Full-resolution export. Renders source + EditDoc into a fresh canvas at
 * optional resize, then encodes via canvas. Canvas re-encoding always drops
 * EXIF etc. — metadata stripping is therefore inherent (documented in UI).
 * Runs on the main thread in Phase 2 (WebGL contexts don't survive transfer
 * everywhere); moves to a worker with OffscreenCanvas GL in Phase 3/4.
 */

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ExportOptions {
  format: ExportFormat
  /** 0..100, used for jpeg/webp. */
  quality: number
  /** Cap on longest edge in px (null = original size). */
  maxEdge: number | null
  baseName: string
}

export interface ExportResult {
  name: string
  blob: Blob
}

const EXT: Record<ExportFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function toBlob(canvas: HTMLCanvasElement, options: ExportOptions): Promise<Blob | null> {
  const type = options.format
  const quality = options.quality / 100
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => resolve(b), type, type === 'image/png' ? undefined : quality)
    } catch (err) {
      reject(err)
    }
  })
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.addEventListener('click', () => {
    // Revoke after the click cycle for memory hygiene.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  })
  a.click()
  a.remove()
}

export function sanitizeFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, '_')
}

/** Renders one photo to a Blob (no download). Throws on failure. */
export async function renderPhotoBlob(source: TexSource, doc: EditDoc, options: ExportOptions): Promise<ExportResult> {
  const { w: baseW, h: baseH } = { w: sourceWidth(source), h: sourceHeight(source) }
  const plan = planForDoc(baseW, baseH, doc)
  let outW = plan.outW
  let outH = plan.outH
  if (options.maxEdge !== null && options.maxEdge > 0) {
    const scale = Math.min(1, options.maxEdge / Math.max(outW, outH))
    outW = Math.max(1, Math.round(outW * scale))
    outH = Math.max(1, Math.round(outH * scale))
  }

  const canvas: HTMLCanvasElement = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH

  let useGL = false
  try {
    const probe = document.createElement('canvas')
    probe.width = 1
    useGL = probe.getContext('webgl2') !== null
  } catch {
    useGL = false
  }

  try {
    // Render through the shared pipeline so the export matches the preview
    // exactly (curves, HSL, chroma key, shape masks) — never re-implement.
    if (useGL) {
      renderEdit(source, doc, canvas, options.maxEdge !== null ? { maxSize: options.maxEdge } : {})
    } else {
      draw2dFallback(canvas, source, {
        matrix: plan.matrix,
        outW,
        outH,
        adjustments: { ...defaultAdjustments(), ...doc.adjustments },
      })
    }

    // Text layers composite on top, same geometry as the live preview.
    const overlays = doc.textOverlays ?? []
    if (overlays.length > 0) {
      const ctx = canvas.getContext('2d')
      if (ctx) drawPhotoOverlays(ctx, overlays, canvas.width, canvas.height)
    }

    const blob = await toBlob(canvas, options)
    if (!blob) throw new Error('Encoding produced no data')

    const name = `${sanitizeFileName(options.baseName)}-edited-${outW}x${outH}-${newId('').slice(0, 8)}.${EXT[options.format]}`
    return { name, blob }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Renders + downloads one photo. Throws on failure (caller toasts). */
export async function exportPhoto(source: TexSource, doc: EditDoc, options: ExportOptions): Promise<string> {
  const { name, blob } = await renderPhotoBlob(source, doc, options)
  download(blob, name)
  return name
}

/** Renders one photo as PNG (for clipboard copies; ignores format/quality). */
export async function toPngBlob(source: TexSource, doc: EditDoc, options: { quality: number; maxEdge: number | null }): Promise<Blob> {
  const { blob } = await renderPhotoBlob(source, doc, {
    format: 'image/png',
    quality: options.quality,
    maxEdge: options.maxEdge,
    baseName: 'clipboard',
  })
  return blob
}

/** Saves a blob to the user's downloads (used by share fallbacks). */
export function downloadBlob(blob: Blob, name: string): void {
  download(blob, name)
}
