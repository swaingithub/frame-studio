import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader'
import type { Affine } from './geometry'
import { MASK_SHAPE_IDS, type ChromaKey, type Mask } from '../adjustments/edits'
import { defaultHslMixer, defaultToneCurve, HSL_CHANNELS, type HslMixer, type ToneCurve } from '../adjustments/color'

/**
 * Low-level WebGL2 backend with per-context caches: one program, one quad
 * (bufferless triangle), and an LRU of source textures so slider drags never
 * re-upload the image. Texture cache is capped and explicitly disposed —
 * no leaks by design.
 */

export type TexSource =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLVideoElement

interface GLState {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
  /** LRU of uploaded source textures (cap 4). */
  cache: { source: TexSource; tex: WebGLTexture; size: number }[]
}

const stateByCanvas = new WeakMap<HTMLCanvasElement | OffscreenCanvas, GLState>()
const MAX_TEXTURES = 4

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Cannot create shader')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
  if (!ok) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log'
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return shader
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Cannot create program')
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!ok) {
    const log = gl.getProgramInfoLog(program) ?? 'no log'
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${log}`)
  }
  return program
}

const UNIFORM_NAMES = [
  'uUVMatrix', 'uInvSource', 'uOutSize', 'uTex',
  'uExposure', 'uContrast', 'uHighlights', 'uShadows', 'uWhites', 'uBlacks',
  'uTemperature', 'uTint', 'uSaturation', 'uVibrance',
  'uSharpness', 'uClarity', 'uNoiseReduction', 'uVignette', 'uGrain',
  'uCurveY', 'uCurveY4', 'uParametric',
  'uHslHue0', 'uHslHue1', 'uHslSat0', 'uHslSat1', 'uHslLum0', 'uHslLum1',
  'uKeyEnabled', 'uKeyColor', 'uKeySimilarity', 'uKeySmoothness', 'uKeySpill',
  'uMaskShape', 'uMaskX', 'uMaskY', 'uMaskW', 'uMaskH', 'uMaskRotation', 'uMaskFeather', 'uMaskInvert',
  'uBgTex', 'uBgEnabled',
] as const

function init(canvas: HTMLCanvasElement | OffscreenCanvas): GLState {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    // Video chroma keying needs an alpha channel for 2D compositing; grade
    // output always stays opaque (a=1) so photos/old behavior are unchanged.
    alpha: true,
    // Histogram readbacks read this canvas right after each draw.
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('WebGL2 unavailable')
  const program = buildProgram(gl)
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name)
  const state: GLState = { gl, program, uniforms, cache: [] }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  stateByCanvas.set(canvas, state)
  return state
}

/** Deletes the oldest cached texture when the LRU is over capacity. */
function evict(state: GLState): void {
  while (state.cache.length >= MAX_TEXTURES) {
    const oldest = state.cache.shift()
    if (oldest) state.gl.deleteTexture(oldest.tex)
  }
}

function sourceWidth(s: TexSource): number {
  if ('naturalWidth' in s) return s.naturalWidth
  if ('videoWidth' in s) return s.videoWidth
  return (s as ImageBitmap | HTMLCanvasElement | OffscreenCanvas).width
}

function sourceHeight(s: TexSource): number {
  if ('naturalHeight' in s) return s.naturalHeight
  if ('videoHeight' in s) return s.videoHeight
  return (s as ImageBitmap | HTMLCanvasElement | OffscreenCanvas).height
}

function uploadTexture(state: GLState, source: TexSource): WebGLTexture {
  const existing = state.cache.find((e) => e.source === source)
  if (existing && !('videoWidth' in source)) {
    // Still image (or canvas) — immutable pixels; reuse the cached texture.
    // move to MRU position
    state.cache = state.cache.filter((e) => e !== existing)
    state.cache.push(existing)
    return existing.tex
  }
  if (existing) {
    // An HTMLVideoElement *is* the same object every frame but its pixels
    // move — refresh the cached texture in place (params are retained).
    state.cache = state.cache.filter((e) => e !== existing)
    state.cache.push(existing)
    const gl = state.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, existing.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    return existing.tex
  }
  evict(state)
  const gl = state.gl
  const tex = gl.createTexture()
  if (!tex) throw new Error('Cannot create texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  state.cache.push({ source, tex, size: sourceWidth(source) * sourceHeight(source) })
  return tex
}

export interface GLDrawOptions {
  matrix: Affine
  outW: number
  outH: number
  adjustments: Record<string, number>
  /** Chroma key state; null/omitted = no keying (all pixels opaque). */
  chromaKey?: ChromaKey | null
  /** Shape mask; null/omitted = full frame. */
  mask?: Mask | null
  /** Tone curve; null/omitted = identity. */
  curves?: ToneCurve | null
  /** HSL mixer; null/omitted = no-op. */
  hsl?: HslMixer | null
  /** AI background removal mask canvas (alpha = subject). Omitted = keep all. */
  bgMask?: TexSource | null
}

/** Renders one pass. Throws when WebGL2 is unavailable — callers fall back. */
export function drawGL(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  source: TexSource,
  opts: GLDrawOptions,
): void {
  let state = stateByCanvas.get(canvas)
  if (!state) state = init(canvas)
  const { gl, program, uniforms } = state

  if (gl.drawingBufferWidth !== opts.outW || gl.drawingBufferHeight !== opts.outH) {
    canvas.width = opts.outW
    canvas.height = opts.outH
  }
  gl.viewport(0, 0, opts.outW, opts.outH)
  gl.useProgram(program)

  const tex = uploadTexture(state, source)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (uniforms.uTex) gl.uniform1i(uniforms.uTex, 0)

  if (uniforms.uUVMatrix) {
    // column-major mat3 for x' = a·x + c·y + e
    gl.uniformMatrix3fv(uniforms.uUVMatrix, false, [
      opts.matrix.a, opts.matrix.b, 0,
      opts.matrix.c, opts.matrix.d, 0,
      opts.matrix.e, opts.matrix.f, 1,
    ])
  }
  if (uniforms.uOutSize) gl.uniform2f(uniforms.uOutSize, opts.outW, opts.outH)
  if (uniforms.uInvSource) {
    gl.uniform2f(uniforms.uInvSource, 1 / Math.max(1, sourceWidth(source)), 1 / Math.max(1, sourceHeight(source)))
  }

  for (const [name, value] of Object.entries(opts.adjustments)) {
    if (name === 'uTex') continue
    const loc = uniforms[name]
    if (loc) gl.uniform1f(loc, value)
  }

  const curve = opts.curves ?? defaultToneCurve()
  if (uniforms.uCurveY) gl.uniform4f(uniforms.uCurveY, curve.master[0], curve.master[1], curve.master[2], curve.master[3])
  if (uniforms.uCurveY4) gl.uniform1f(uniforms.uCurveY4, curve.master[4])
  if (uniforms.uParametric) {
    gl.uniform4f(
      uniforms.uParametric,
      curve.shadows / 100,
      curve.darks / 100,
      curve.lights / 100,
      curve.highlights / 100,
    )
  }

  const hsl = opts.hsl ?? defaultHslMixer()
  const hue = HSL_CHANNELS.map((ch) => hsl[ch].hue / 100)
  const sat = HSL_CHANNELS.map((ch) => hsl[ch].sat / 100)
  const lum = HSL_CHANNELS.map((ch) => hsl[ch].lum / 100)
  if (uniforms.uHslHue0) gl.uniform4f(uniforms.uHslHue0, hue[0], hue[1], hue[2], hue[3])
  if (uniforms.uHslHue1) gl.uniform4f(uniforms.uHslHue1, hue[4], hue[5], hue[6], hue[7])
  if (uniforms.uHslSat0) gl.uniform4f(uniforms.uHslSat0, sat[0], sat[1], sat[2], sat[3])
  if (uniforms.uHslSat1) gl.uniform4f(uniforms.uHslSat1, sat[4], sat[5], sat[6], sat[7])
  if (uniforms.uHslLum0) gl.uniform4f(uniforms.uHslLum0, lum[0], lum[1], lum[2], lum[3])
  if (uniforms.uHslLum1) gl.uniform4f(uniforms.uHslLum1, lum[4], lum[5], lum[6], lum[7])

  const key = opts.chromaKey
  if (key && key.enabled) {
    if (uniforms.uKeyEnabled) gl.uniform1f(uniforms.uKeyEnabled, 1)
    if (uniforms.uKeyColor) gl.uniform3f(uniforms.uKeyColor, key.color[0], key.color[1], key.color[2])
    if (uniforms.uKeySimilarity) gl.uniform1f(uniforms.uKeySimilarity, key.similarity)
    if (uniforms.uKeySmoothness) gl.uniform1f(uniforms.uKeySmoothness, key.smoothness)
    if (uniforms.uKeySpill) gl.uniform1f(uniforms.uKeySpill, key.spill)
  } else if (uniforms.uKeyEnabled) {
    gl.uniform1f(uniforms.uKeyEnabled, 0)
  }

  const mask = opts.mask
  if (mask && mask.shape !== 'none') {
    if (uniforms.uMaskShape) gl.uniform1f(uniforms.uMaskShape, MASK_SHAPE_IDS[mask.shape])
    if (uniforms.uMaskX) gl.uniform1f(uniforms.uMaskX, mask.x)
    if (uniforms.uMaskY) gl.uniform1f(uniforms.uMaskY, mask.y)
    if (uniforms.uMaskW) gl.uniform1f(uniforms.uMaskW, mask.w)
    if (uniforms.uMaskH) gl.uniform1f(uniforms.uMaskH, mask.h)
    if (uniforms.uMaskRotation) gl.uniform1f(uniforms.uMaskRotation, mask.rotation)
    if (uniforms.uMaskFeather) gl.uniform1f(uniforms.uMaskFeather, mask.feather)
    if (uniforms.uMaskInvert) gl.uniform1f(uniforms.uMaskInvert, mask.invert ? 1 : 0)
  } else if (uniforms.uMaskShape) {
    gl.uniform1f(uniforms.uMaskShape, 0)
  }

  if (opts.bgMask && uniforms.uBgEnabled && uniforms.uBgTex) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, uploadTexture(state, opts.bgMask))
    gl.uniform1i(uniforms.uBgTex, 1)
    gl.uniform1f(uniforms.uBgEnabled, 1)
    gl.activeTexture(gl.TEXTURE0)
  } else if (uniforms.uBgEnabled) {
    gl.uniform1f(uniforms.uBgEnabled, 0)
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

/** Frees every cached texture for a canvas (call on unmount). */
export function disposeGL(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  const state = stateByCanvas.get(canvas)
  if (!state) return
  for (const entry of state.cache) state.gl.deleteTexture(entry.tex)
  state.cache = []
  stateByCanvas.delete(canvas)
}

export { sourceWidth, sourceHeight }
