/**
 * Meme generator: builds a meme PNG from a photo + two caption lines,
 * classic meme styling — bold white text with a black outline, centered on
 * the top and bottom of the image.
 */

const FONT_STACK = `'Impact', 'Verdana', 'Arial Black', 'Helvetica Neue', sans-serif`

export interface MemeSpec {
  /** Source photo. */
  source: ImageBitmap
  /** Top line (optional). */
  top?: string
  /** Bottom line (optional). */
  bottom?: string
}

/** Greedy word-wrap to `maxWidth` px (no single word exceeds the cap). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  for (const word of words) {
    const candidate = lines.length > 0 ? `${lines[lines.length - 1]} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && lines.length > 0) {
      lines.push(word)
    } else {
      if (lines.length === 0) lines.push(candidate)
      else lines[lines.length - 1] = candidate
    }
  }
  return lines
}

/** Largest font size ≤ cap whose line fits `maxWidth`. */
function fitFontSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, cap: number): number {
  for (let size = cap; size >= 8; size--) {
    ctx.font = `bold ${size}px ${FONT_STACK}`
    if (ctx.measureText(text).width <= maxWidth) return size
  }
  return 8
}

function drawMemeLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  size: number,
  y0: number,
  spacing: number,
  width: number,
): void {
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    if (!text) continue
    ctx.font = `bold ${size}px ${FONT_STACK}`
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.max(2, size * 0.09)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const x = width / 2
    const y = y0 + i * spacing
    ctx.strokeText(text, x, y)
    ctx.fillText(text, x, y)
  }
}

export async function generateMeme(spec: MemeSpec): Promise<Blob> {
  const { source } = spec
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  const top = (spec.top ?? '').trim()
  const bottom = (spec.bottom ?? '').trim()
  const maxW = canvas.width * 0.92
  const cap = Math.min(48, Math.round(canvas.height * 0.055))

  if (top) {
    const lines = wrapText(ctx, top, maxW)
    const size = fitFontSize(ctx, lines[0], maxW, cap)
    const spacing = Math.ceil(size * 1.15)
    drawMemeLines(ctx, lines, size, Math.max(6, Math.round(canvas.height * 0.06)), spacing, canvas.width)
  }

  if (bottom) {
    const lines = wrapText(ctx, bottom, maxW)
    const size = fitFontSize(ctx, lines[0], maxW, cap)
    const spacing = Math.ceil(size * 1.15)
    const groupH = (lines.length - 1) * spacing + Math.ceil(size * 1.1)
    const y0 = Math.max(6, canvas.height - Math.round(canvas.height * 0.06) - groupH)
    drawMemeLines(ctx, lines, size, y0, spacing, canvas.width)
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
  if (!blob) throw new Error('Meme encoding failed')
  canvas.width = 0
  canvas.height = 0
  return blob
}
