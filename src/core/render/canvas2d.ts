import { invert, type Affine } from './geometry'
import type { TexSource } from './webgl'
import type { AdjustValues } from '../adjustments/registry'
import { defaultAdjustments } from '../adjustments/registry'

/**
 * Canvas 2D fallback backend. Geometry (rotate/flip/straighten/crop) is
 * exact; color adjustments are approximated with CSS filter functions and a
 * gradient vignette. Sharpness/clarity/noise/grain are unavailable here and
 * the UI surfaces that limitation via detectCapabilities().
 */

function filterString(a: AdjustValues): string {
  // This backend is only used when AdjustValues ≠ defaults; skip work otherwise.
  const parts: string[] = []
  const exposureFactor = Math.pow(2, (a.exposure / 100) * 1.1)
  if (Math.abs(exposureFactor - 1) > 0.005) {
    parts.push(`brightness(${format(exposureFactor)})`)
  }
  if (a.contrast !== 0) {
    parts.push(`contrast(${format(1 + (a.contrast / 100) * 0.6)})`)
  }
  if (a.saturation !== 0 || a.vibrance !== 0) {
    parts.push(`saturate(${format(1 + ((a.saturation + a.vibrance * 0.6) / 100) * 0.85)})`)
  }
  if (a.temperature !== 0) {
    // Warmth approximated by a subtle sepia wash for positive temperature
    if (a.temperature > 0) {
      parts.push(`sepia(${format(0.25 * (a.temperature / 100))})`)
    } else {
      parts.push(`hue-rotate(${format(a.temperature * 0.06)}deg)`)
    }
  }
  return parts.length > 0 ? parts.join(' ') : 'none'
}

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

export interface Canvas2DOptions {
  matrix: Affine
  outW: number
  outH: number
  adjustments: AdjustValues
}

export function draw2dFallback(
  canvas: HTMLCanvasElement,
  source: TexSource,
  opts: Canvas2DOptions,
): void {
  canvas.width = opts.outW
  canvas.height = opts.outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, opts.outW, opts.outH)

  // Geometry: invert the out→source mapping (canvas wants source→out)
  const forward = invert(opts.matrix)
  ctx.setTransform(forward.a, forward.b, forward.c, forward.d, forward.e, forward.f)

  const defaults = defaultAdjustments()
  const nonDefault = Object.keys(defaults).some(
    (k) => (opts.adjustments[k as keyof AdjustValues] ?? 0) !== defaults[k as keyof AdjustValues],
  )
  if (nonDefault) ctx.filter = filterString(opts.adjustments)

  const sw = 'naturalWidth' in source ? source.naturalWidth : (source as HTMLCanvasElement).width
  const sh = 'naturalHeight' in source ? source.naturalHeight : (source as HTMLCanvasElement).height
  ctx.drawImage(source, 0, 0, sw, sh)
  ctx.filter = 'none'
  ctx.restore()

  if (opts.adjustments.vignette !== 0) {
    const g = ctx.createRadialGradient(
      opts.outW / 2, opts.outH / 2, Math.min(opts.outW, opts.outH) * 0.35,
      opts.outW / 2, opts.outH / 2, Math.max(opts.outW, opts.outH) * 0.75,
    )
    const strength = Math.abs(opts.adjustments.vignette / 100) * 0.75
    const inner = `rgba(0,0,0,0)`
    const outer = opts.adjustments.vignette > 0
      ? `rgba(0,0,0,${strength})`
      : `rgba(255,255,255,${strength})`
    g.addColorStop(0, inner)
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, opts.outW, opts.outH)
  }
}
