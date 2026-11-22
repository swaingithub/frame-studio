/**
 * Poster maker: draws caption lines onto a photo (title, subtitle, tagline
 * with independent sizes), with a bold font + black outline for readability
 * over the image. All on-device.
 */

export interface PosterLine {
  /** Text of the line (empty = skipped). */
  text: string
  /** Anchor Y in 0..1 output coordinates — where the text line starts (top). */
  y: number
  /** Font size relative to the canvas height (0.01..0.25). */
  fontSize: number
}

export interface PosterOptions {
  source: ImageBitmap
  lines: readonly PosterLine[]
}

const FONT_STACK = `'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`

export async function makePoster(options: PosterOptions): Promise<Blob> {
  const { source, lines } = options
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  for (const line of lines) {
    const text = line.text.trim()
    if (!text) continue
    const size = Math.max(10, Math.round(canvas.height * line.fontSize))
    ctx.font = `bold ${size}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.max(2, size * 0.08)
    // Anchor the text center-X and near `line.y` (clamped into bounds).
    const cx = canvas.width / 2
    const ty = Math.max(2, Math.min(canvas.height - size - 2, (line.y * canvas.height) - size / 2))
    ctx.strokeText(text, cx, ty)
    ctx.fillText(text, cx, ty)
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
  })
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Encoding failed')
  return blob
}
