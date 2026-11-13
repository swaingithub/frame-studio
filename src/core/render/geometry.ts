import type { EditDoc, GeometryValues } from '../adjustments/edits'

/**
 * Pure geometry math for the render pipeline. Converts an EditDoc's geometry
 * into (a) an affine mapping from output uv (crop space, y-down normalized)
 * back into source uv, and (b) output dimensions. Unit-tested; used by both
 * the WebGL and Canvas 2D backends.
 */

/** x' = a·x + c·y + e ; y' = b·x + d·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Applies t1 first, then t2. */
export function compose(t2: Affine, t1: Affine): Affine {
  return {
    a: t2.a * t1.a + t2.c * t1.b,
    b: t2.b * t1.a + t2.d * t1.b,
    c: t2.a * t1.c + t2.c * t1.d,
    d: t2.b * t1.c + t2.d * t1.d,
    e: t2.a * t1.e + t2.c * t1.f + t2.e,
    f: t2.b * t1.e + t2.d * t1.f + t2.f,
  }
}

export function apply(t: Affine, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]
}

/** Exact affine inverse. */
export function invert(t: Affine): Affine {
  const { a, b, c, d, e, f } = t
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return { ...IDENTITY }
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    e: -(ia * e + ic * f),
    f: -(ib * e + id * f),
  }
}

export function translation(tx: number, ty: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

export function scaleM(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

export function rotationRad(theta: number): Affine {
  const co = Math.cos(theta)
  const si = Math.sin(theta)
  return { a: co, b: si, c: -si, d: co, e: 0, f: 0 }
}

function scaledUniform(t: Affine, sx: number, sy: number): Affine {
  // multiply the linear part by diag(sx, sy) on the right: p → L·S·p + t
  return { a: t.a * sx, b: t.b * sx, c: t.c * sy, d: t.d * sy, e: t.e, f: t.f }
}

export interface GeometryPlan {
  /** Maps normalized output uv (y-down) → normalized source uv (y-down). */
  matrix: Affine
  outW: number
  outH: number
  frameW: number
  frameH: number
}

/**
 * Zoom factor so the source (rotated by θ) covers its original W×H box.
 * The binding constraint is the max() of the two axis requirements —
 * with min(), the rotated source leaves empty corners.
 */
export function coverScale(w: number, h: number, theta: number): number {
  const co = Math.cos(Math.abs(theta))
  const si = Math.sin(Math.abs(theta))
  if (w <= 0 || h <= 0) return 1
  const sx = (w * co + h * si) / w
  const sy = (h * co + w * si) / h
  return Math.max(sx, sy)
}

/** Frame dims after the 90° quarter-turns. */
export function orientedSize(baseW: number, baseH: number, geom: GeometryValues): { w: number; h: number } {
  const swap = geom.rotateQuarter % 2 === 1
  return { w: swap ? baseH : baseW, h: swap ? baseW : baseH }
}

/**
 * Builds the full mapping for a document.
 * Spaces: out uv → crop px (Q frame) → F px (straightened frame) → source px → source uv.
 * The straighten frame F (cover box) equals the base dims; the quarter-rotated
 * frame Q equals F with swapped dims for odd quarters.
 */
export function planGeometry(baseW: number, baseH: number, geom: GeometryValues): GeometryPlan {
  const theta = (geom.straighten * Math.PI) / 180
  const s = coverScale(baseW, baseH, theta)
  const q = orientedSize(baseW, baseH, geom)
  const F = { w: baseW, h: baseH }
  const { crop } = geom

  // 1. out uv → point in Q (px)
  const outToQ = scaledUniform(
    translation(crop.x * q.w, crop.y * q.h),
    crop.w * q.w,
    crop.h * q.h,
  )

  // 2. q px → f px: inverse of the quarter-rotation+flips (about centers).
  //    Forward (f→q): T(Qc)·Fq·R(+k·90°)·T(−Fc)
  //    Inverse  (q→f): T(Fc)·R(−k·90°)·Fq·T(−Qc)
  const radians = (geom.rotateQuarter * Math.PI) / 2
  const flipLinear: Affine = { a: geom.flipH ? -1 : 1, b: 0, c: 0, d: geom.flipV ? -1 : 1, e: 0, f: 0 }
  const qToF = compose(
    translation(F.w / 2, F.h / 2),
    compose(rotationRad(-radians), compose(flipLinear, translation(-q.w / 2, -q.h / 2))),
  )

  // 3. f px → source px: p_a = A_c + R(−θ)·(p_f − F_c)/s
  //    (the inverse of zoom-then-rotate: divide the frame offset by s,
  //     then un-rotate — /s samples closer to center, zooming in to cover)
  const fToSource = compose(
    translation(F.w / 2, F.h / 2),
    compose(scaleM(1 / s, 1 / s), compose(rotationRad(-theta), translation(-F.w / 2, -F.h / 2))),
  )

  // 4. source px → source uv
  const toUv = scaleM(1 / F.w, 1 / F.h)

  const matrix = compose(toUv, compose(fToSource, compose(qToF, outToQ)))

  return {
    matrix,
    outW: Math.max(1, Math.round(crop.w * q.w)),
    outH: Math.max(1, Math.round(crop.h * q.h)),
    frameW: q.w,
    frameH: q.h,
  }
}

/** Plan for a doc that ignores color but keeps orientation + full crop. */
export function planGeometryBase(baseW: number, baseH: number, geom: GeometryValues): GeometryPlan {
  return planGeometry(baseW, baseH, { ...geom, crop: { x: 0, y: 0, w: 1, h: 1 } })
}

/** Docs default to identity → the original pixels. */
export function planForDoc(baseW: number, baseH: number, doc: EditDoc): GeometryPlan {
  return planGeometry(baseW, baseH, doc.geometry)
}
