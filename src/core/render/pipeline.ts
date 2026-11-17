import { defaultAdjustments, type AdjustValues } from '../adjustments/registry'
import { createDefaultEditDoc, type EditDoc } from '../adjustments/edits'
import { planForDoc, planGeometryBase, type GeometryPlan } from './geometry'
import { drawGL, sourceHeight, sourceWidth, type TexSource } from './webgl'
import { draw2dFallback } from './canvas2d'

/**
 * The edit render pipeline: (source pixels + EditDoc) → pixels.
 * Geometry is exact on both backends; color uses WebGL2 when available and a
 * reduced approximation on Canvas 2D (see canvas2d.ts).
 */

export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas

export interface RenderOptions {
  /** Cap for the output's longest edge (preview passes use this). */
  maxSize?: number
  /** AI background-removal mask (alpha = subject); omitted = keep all pixels. */
  bgMask?: TexSource | null
  /** Override source texture orientation. Video textures are already y-down. */
  flipY?: boolean
}

export interface RenderResult {
  backend: 'webgl2' | 'canvas2d'
  plan: GeometryPlan
}

function dimsOf(source: TexSource): { w: number; h: number } {
  return { w: sourceWidth(source), h: sourceHeight(source) }
}

/** Uniform floats for the shader; neutral values keep cache reuse simple. */
export function shaderFloats(values: AdjustValues): Record<string, number> {
  const floats: Record<string, number> = {}
  for (const [k, v] of Object.entries(values)) {
    floats['u' + k.charAt(0).toUpperCase() + k.slice(1)] = v / 100
  }
  return floats
}

function cappedDims(plan: GeometryPlan, maxSize?: number): { outW: number; outH: number } {
  let outW = plan.outW
  let outH = plan.outH
  if (maxSize) {
    const scale = Math.min(1, maxSize / Math.max(outW, outH))
    outW = Math.max(1, Math.round(outW * scale))
    outH = Math.max(1, Math.round(outH * scale))
  }
  return { outW, outH }
}

/** Detect WebGL2 support once per canvas ( getContext returns null after try). */
export function isWebGL(target: RenderCanvas): boolean {
  try {
    return 'getContext' in target && (target as HTMLCanvasElement).getContext('webgl2') !== null
  } catch {
    return false
  }
}

/**
 * Core entry point. Synchronous; source textures are cached per canvas so
 * slider drags cost only uniform uploads + one draw call.
 */
export function renderEdit(
  source: TexSource,
  doc: EditDoc,
  target: RenderCanvas,
  options: RenderOptions = {},
): RenderResult {
  const { w: baseW, h: baseH } = dimsOf(source)
  const plan = planForDoc(baseW, baseH, doc)
  const { outW, outH } = cappedDims(plan, options.maxSize)

  if (isWebGL(target)) {
    drawGL(target, source, {
      matrix: plan.matrix,
      outW,
      outH,
      flipY: options.flipY ?? !('videoWidth' in source),
      adjustments: shaderFloats(doc.adjustments),
      chromaKey: doc.chromaKey ?? null,
      mask: doc.mask ?? null,
      curves: doc.curves ?? null,
      hsl: doc.hsl ?? null,
      bgMask: options.bgMask ?? null,
    })
    return { backend: 'webgl2', plan }
  }

  draw2dFallback(target as HTMLCanvasElement, source, {
    matrix: plan.matrix,
    outW,
    outH,
    adjustments: { ...defaultAdjustments(), ...doc.adjustments },
  })
  return { backend: 'canvas2d', plan }
}

/** Renders orientation only (neutral color, full-frame crop) — crop tool backdrop. */
export function renderGeometryBase(
  source: TexSource,
  geometry: EditDoc['geometry'],
  target: RenderCanvas,
  options: RenderOptions = {},
): GeometryPlan {
  const { w: baseW, h: baseH } = dimsOf(source)
  const plan = planGeometryBase(baseW, baseH, geometry)
  const { outW, outH } = cappedDims(plan, options.maxSize)

  if (isWebGL(target)) {
    drawGL(target, source, {
      matrix: plan.matrix,
      outW,
      outH,
      adjustments: shaderFloats(createDefaultEditDoc().adjustments),
    })
  } else {
    draw2dFallback(target as HTMLCanvasElement, source, {
      matrix: plan.matrix,
      outW,
      outH,
      adjustments: defaultAdjustments(),
    })
  }
  return plan
}
