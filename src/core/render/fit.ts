/**
 * Aspect-fit helpers for compositing a graded clip inside a fixed output
 * frame. Pure math shared by the preview stage and export.
 */

export interface FitRect {
  x: number
  y: number
  w: number
  h: number
}

/** Largest rect with the source's aspect ratio that fits inside the frame. */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): FitRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h }
}

/** Smallest rect with the source's aspect ratio that covers the frame. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): FitRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h }
}
