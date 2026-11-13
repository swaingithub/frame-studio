/**
 * Photo text overlays — pure Canvas 2D drawing shared by the live preview
 * and the full-res export, so what you see is exactly what you export.
 * Geometry mirrors the video stage's title renderer (font = height-relative,
 * soft shadow for readability) so both editors feel like one product.
 */
import type { PhotoTextOverlay } from '../../core/adjustments/edits'

/** Default font size at scale 1, relative to output height. */
const BASE_FONT_RATIO = 0.06

/** Draws the overlays bottom→top (array order). No-op on an empty list. */
export function drawPhotoOverlays(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, overlays: readonly PhotoTextOverlay[], w: number, h: number): void {
  if (overlays.length === 0 || w < 2 || h < 2) return
  for (const overlay of overlays) {
    const fontSize = Math.max(9, Math.round(h * BASE_FONT_RATIO * overlay.scale))
    ctx.save()
    ctx.globalAlpha = Math.max(0.05, Math.min(1, overlay.opacity))
    ctx.fillStyle = overlay.color
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = fontSize * 0.3
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(overlay.x * w, overlay.y * h)
    if (overlay.rotation !== 0) ctx.rotate((overlay.rotation * Math.PI) / 180)
    // Word-wrap long text to 86% of the frame, like the video stage.
    const maxWidth = w * 0.86
    const lines = wrapText(ctx, overlay.text, maxWidth)
    const leading = fontSize * 1.25
    const startY = -((lines.length - 1) * leading) / 2
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, startY + i * leading)
    })
    ctx.restore()
  }
}

function wrapText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text]
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}
