import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Camera, Download, Eye, Pause, Play, ShieldQuestion } from 'lucide-react'
import { createDefaultEditDoc, defaultGeometry, type GeometryValues } from '../../../core/adjustments/edits'
import { computeHistogram, type Histogram } from '../../../core/render/histogram'
import { containRect, coverRect } from '../../../core/render/fit'
import { isWebGL, renderEdit } from '../../../core/render/pipeline'
import { disposeGL } from '../../../core/render/webgl'
import { getBlob } from '../../../core/db/blobStore'
import { useAssets } from '../../library/useAssets'
import { useCurrentProject } from '../../projects/store'
import { useVideoEditor, layoutOf } from '../store'
import { audioGainAt, videoDocToEditDoc } from '../model'
import { ensureSegmenter, segmentSubjectMask } from '../bgRemove'
import { baseAnimAt, canvasOutputSize, clipOutDuration, clipSrcAt, isOverlapTransition, locateTime, overlaysAt, overlayVisual, type SequenceLayout, type VideoClip, type LocatedTime } from '../sequenceModel'
import { animAt, outFractionAt, shapeAt } from '../sequenceAnim'
import { downloadBlob, exportSequenceName, recordStream, seeked } from '../exportVideo'
import { pickWcFormat, recordWebCodecs } from '../webcodecsExport'
import { Button } from '../../../ui/button'
import { Tooltip } from '../../../ui/tooltip'
import { cn } from '../../../lib/cn'
import { VideoTimeline } from './VideoTimeline'

/**
 * The video stage engine: plays the WHOLE SEQUENCE — switching, dissolving
 * and fading across clips — while every frame runs through the same WebGL
 * grade pipeline as the photo editor. Titles are drawn onto the composited
 * canvas so they appear in both preview and export. Music plays under the
 * clips. Export records this canvas plus the mixed audio in real time.
 */

const PREVIEW_MAX_EDGE = 1280
const COMPACT_PREVIEW_MAX_EDGE = 960
const HIST_INTERVAL_MS = 160
const COMPACT_HIST_INTERVAL_MS = 260

/** Phones/tablets and low-memory devices get a smaller preview. */
function previewMaxEdge(): number {
  if (typeof window === 'undefined') return PREVIEW_MAX_EDGE
  const nav = navigator as Navigator & { deviceMemory?: number }
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2
  if (lowMemory) return COMPACT_PREVIEW_MAX_EDGE
  return window.innerWidth < 1000 ? COMPACT_PREVIEW_MAX_EDGE : PREVIEW_MAX_EDGE
}

function histogramInterval(): number {
  if (typeof window === 'undefined') return HIST_INTERVAL_MS
  return window.innerWidth < 1000 ? COMPACT_HIST_INTERVAL_MS : HIST_INTERVAL_MS
}
const PROGRESS_INTERVAL_MS = 250
const PRELOAD_LEAD_S = 2.0

type Slot = 'A' | 'B'
const other = (slot: Slot): Slot => (slot === 'A' ? 'B' : 'A')

export function VideoStage({ onHistogram }: { onHistogram?: (h: Histogram | null) => void }): ReactNode {
  const project = useCurrentProject()
  const assets = useAssets()

  const clips = useVideoEditor((s) => s.sequence)
  const overlays = useVideoEditor((s) => s.overlays)
  const music = useVideoEditor((s) => s.music)
  const durations = useVideoEditor((s) => s.durations)
  const playing = useVideoEditor((s) => s.playing)
  const bypass = useVideoEditor((s) => s.bypass)
  const activeClipId = useVideoEditor((s) => s.activeClipId)
  const doc = useVideoEditor((s) => s.doc)
  const canvasSettings = useVideoEditor((s) => s.canvas)

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])

  const containerRef = useRef<HTMLDivElement>(null)
  const stageAreaRef = useRef<HTMLDivElement>(null)
  const outCanvasRef = useRef<HTMLCanvasElement>(null)
  const glMainRef = useRef<HTMLCanvasElement | null>(null)
  const glSecondRef = useRef<HTMLCanvasElement | null>(null)
  const histRef = useRef<HTMLCanvasElement>(null)
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const musicRef = useRef<HTMLAudioElement>(null)

  const [box, setBox] = useState({ w: 0, h: 0 })
  const [outDims, setOutDims] = useState({ w: 0, h: 0 })
  const [fallback, setFallback] = useState(false)
  const [recording, setRecording] = useState<{ done: number; total: number } | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [showSafeZones, setShowSafeZones] = useState(false)
  // Bumped when the background-removal model finishes loading so paused
  // frames repaint with their new mask.
  const [segVersion, setSegVersion] = useState(0)
  const ctrlSeg = useRef(segVersion)
  ctrlSeg.current = segVersion
  const recordingRef = useRef(false)
  recordingRef.current = recording !== null

  // Lazily load the segmentation model the first time a clip uses background
  // removal; when it lands, paused frames repaint with their new mask.
  const wantsSegmenter = useVideoEditor((s) => s.sequence.some((c) => c.edit.bgRemove) || s.doc?.bgRemove === true)
  useEffect(() => {
    if (!wantsSegmenter) return
    let alive = true
    ensureSegmenter()
      .then(() => {
        if (alive) setSegVersion((v) => v + 1)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [wantsSegmenter])

  // --- slot + asset-url management -----------------------------------------
  const slotEl = (slot: Slot): HTMLVideoElement | null => (slot === 'A' ? videoARef.current : videoBRef.current)
  const slotClip = useRef<Record<Slot, string | null>>({ A: null, B: null })
  const main = useRef<Slot>('A')
  const flipBusy = useRef<string | null>(null)
  const globalT = useRef(0)
  const lastHistAt = useRef(0)
  const lastPreloadAt = useRef(0)
  /** Throttles paused-scrub loads of the incoming overlap clip. */
  const lastPartnerLoadAt = useRef(0)
  const lastProgressAt = useRef(0)
  const lastRenderKey = useRef('')
  const ctrlCanvas = useRef(canvasSettings)
  ctrlCanvas.current = canvasSettings
  // Volatile engine inputs read through refs: changing a slider, toggling
  // Play or switching presets must not restart the render loop.
  const ctrlDoc = useRef(doc)
  ctrlDoc.current = doc
  const ctrlBypass = useRef(bypass)
  ctrlBypass.current = bypass
  const ctrlActiveClipId = useRef(activeClipId)
  ctrlActiveClipId.current = activeClipId
  const ctrlHistogram = useRef(onHistogram)
  ctrlHistogram.current = onHistogram
  const lastPaintedT = useRef(-1)
  // Fixed output-canvas dims per clip (crop-independent; see paint block).
  const baseDimsRef = useRef<{ id: string; w: number; h: number } | null>(null)
  const exportDone = useRef<(() => void) | null>(null)
  const urlCache = useRef(new Map<string, string>())
  const urlPending = useRef(new Map<string, Promise<string>>())

  const assetMap = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a] as const)), [assets])
  const assetMapRef = useRef(assetMap)
  assetMapRef.current = assetMap

  // Overlay layer sources: hidden <video>/<img> per media overlay, keyed by id.
  const overlayEls = useRef(new Map<string, HTMLVideoElement | HTMLImageElement>())
  // Where each overlay was painted last (canvas px) — used for hit-testing drags.
  const overlayRects = useRef(new Map<string, { x: number; y: number; w: number; h: number }>())
  const registerOverlayEl = useCallback((id: string, el: HTMLVideoElement | HTMLImageElement | null): void => {
    if (el) overlayEls.current.set(id, el)
    else overlayEls.current.delete(id)
  }, [])

  // Fresh engine inputs each render (loop reads through this ref).
  const storeFns = useRef({
    setTime: useVideoEditor.getState().setTime,
    setPlaying: useVideoEditor.getState().setPlaying,
    setHistogram: useVideoEditor.getState().setHistogram,
  })
  storeFns.current.setTime = useVideoEditor.getState().setTime
  storeFns.current.setPlaying = useVideoEditor.getState().setPlaying
  storeFns.current.setHistogram = useVideoEditor.getState().setHistogram

  useEffect(() => {
    if (!isWebGL(document.createElement('canvas'))) setFallback(true)
  }, [])

  // Offscreen WebGL render targets for compositing.
  useEffect(() => {
    glMainRef.current = document.createElement('canvas')
    glSecondRef.current = document.createElement('canvas')
    return () => {
      // Free the GL contexts: without this, every workspace visit (and every
      // HMR remount) leaks one, and the browser eventually kills them all.
      disposeGL(glMainRef.current!)
      disposeGL(glSecondRef.current!)
      glMainRef.current = null
      glSecondRef.current = null
    }
  }, [])

  useEffect(() => {
    const el = stageAreaRef.current
    if (!el) return
    const update = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const getAssetUrl = useCallback((assetId: string): Promise<string> => {
    const cached = urlCache.current.get(assetId)
    if (cached) return Promise.resolve(cached)
    let pending = urlPending.current.get(assetId)
    if (!pending) {
      const asset = assetMapRef.current.get(assetId)
      if (!asset) return Promise.reject(new Error('Asset not found'))
      pending = getBlob({ key: asset.storageKey, storage: asset.storage })
        .then((blobOrNull) => {
          if (!blobOrNull) throw new Error('Asset file is missing')
          const url = URL.createObjectURL(blobOrNull)
          urlCache.current.set(assetId, url)
          urlPending.current.delete(assetId)
          return url
        })
        .catch((err) => {
          urlPending.current.delete(assetId)
          throw err
        })
      urlPending.current.set(assetId, pending)
    }
    return pending
  }, [])

  // Assign blob URLs to overlay media elements as overlays come and go.
  // Depends on assetMap too: on a fresh load the library can arrive after the
  // overlays do, and the first attempt would otherwise reject ("Asset not
  // found") and never be retried, leaving the media layer permanently blank.
  useEffect(() => {
    for (const o of overlays) {
      if (o.kind === 'text' || !o.assetId) continue
      const assetId = o.assetId
      void getAssetUrl(assetId)
        .then((url) => {
          const el = overlayEls.current.get(o.id)
          if (!el || el.getAttribute('data-asset-id') === assetId) return
          el.setAttribute('data-asset-id', assetId)
          el.src = url
        })
        .catch(() => undefined)
    }
  }, [overlays, getAssetUrl, assetMap])

  /** Loads `clip` into `slot`, seeks to source time `src`, optionally plays. */
  const assignSlot = useCallback(
    async (slot: Slot, clip: VideoClip, src: number, andPlay: boolean): Promise<void> => {
      const el = slotEl(slot)
      if (!el) return
      if (slotClip.current[slot] !== clip.id) {
        const url = await getAssetUrl(clip.assetId).catch(() => null)
        if (!url || slotEl(slot) !== el) return
        if (el.getAttribute('data-asset-id') !== clip.assetId) {
          el.src = url
          el.setAttribute('data-asset-id', clip.assetId)
        }
        slotClip.current[slot] = clip.id
      }
      el.playbackRate = clip.edit.speed
      const baseVolume = Math.min(1, clip.edit.volume / 100)
      // Audio fade envelope: map the element's source time to clip-local
      // output time and multiply the base volume (preview + export agree).
      const outDur = Math.max(
        0.01,
        ((clip.edit.trimEnd ?? (Number.isFinite(el.duration) ? el.duration : 0)) - clip.edit.trimStart) / Math.max(0.05, clip.edit.speed),
      )
      const localOut = Math.max(0, (src - clip.edit.trimStart) / Math.max(0.05, clip.edit.speed))
      el.volume = Math.max(0, Math.min(1, baseVolume * audioGainAt(clip.edit, localOut, outDur)))
      el.muted = clip.edit.muted
      if (Number.isFinite(src) && Math.abs(el.currentTime - src) > 0.04) {
        el.currentTime = Math.max(0, src)
        await seeked(el, 3000)
      }
      if (andPlay) await el.play().catch(() => undefined)
    },
    [getAssetUrl],
  )

  /** Doc the pipeline should use for `clip` right now (bypass + live edits). */
  const gradeFor = useCallback((clip: VideoClip): VideoClip['edit'] => {
    const base = clip.id === activeClipId && doc ? doc : clip.edit
    if (bypass) return { ...base, adjustments: createDefaultEditDoc().adjustments }
    return base
  }, [activeClipId, doc, bypass])
  // The engine loop reads the latest grade through this ref, so slider drags
  // don't tear down and restart the animation loop.
  const gradeForRef = useRef(gradeFor)
  gradeForRef.current = gradeFor

  /** Renders `video` graded into the offscreen canvas. Returns canvas dims. */
  const renderInto = useCallback(
    (video: HTMLVideoElement | null, canvas: HTMLCanvasElement, clip: VideoClip, geometry?: GeometryValues): { w: number; h: number } | null => {
      if (!video || video.videoWidth === 0) return null
      try {
        // AI background removal: the segmenter loads lazily; until it is ready
        // the frame renders unmasked and a state bump repaints once loaded.
        const bgMask = clip.edit.bgRemove ? segmentSubjectMask(video) : null
        const result = renderEdit(video, videoDocToEditDoc(gradeForRef.current(clip), geometry), canvas, { maxSize: previewMaxEdge(), bgMask })
        return { w: result.plan.outW, h: result.plan.outH }
      } catch (err) {
        console.error('Video render failed', err)
        return null
      }
    },
    [],
  )

  /**
   * Geometry crop for the keyframed base-track camera at `localOut` seconds:
   * scale 1 = fit (no crop), >1 crops a centered-on-(x,y) window. A w==h crop
   * (in frame-relative units) keeps the frame aspect ratio.
   */
  const geometryFor = useCallback((clip: VideoClip, localOut: number): GeometryValues => {
    const anim = baseAnimAt(clip, localOut)
    const cropW = Math.min(1, 1 / Math.max(0.1, anim.scale))
    const cropX = Math.max(0, Math.min(1 - cropW, anim.x * (1 - cropW)))
    const cropY = Math.max(0, Math.min(1 - cropW, anim.y * (1 - cropW)))
    return { ...defaultGeometry(), crop: { x: cropX, y: cropY, w: cropW, h: cropW } }
  }, [])

  /** Draws active overlays (text or the composite rect of media layers). */
  const drawOverlays = useCallback((ctx: CanvasRenderingContext2D, t: number): void => {
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    if (w === 0 || h === 0) return
    const painted: string[] = []
    for (const o of overlaysAt(overlaysRef.current, t)) {
      painted.push(o.id)
      const anim = animAt(o.keyframes, Math.max(0, t - o.start), o.base)
      const vis = overlayVisual(o, t, w, h)
      const scale = anim.scale * vis.scale
      const cx = w * anim.x + vis.dx
      const cy = h * anim.y + vis.dy
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, anim.opacity * vis.alpha))
      if (vis.rot !== 0) {
        // Rotate the whole layer around its own anchor point.
        ctx.translate(cx, cy)
        ctx.rotate(vis.rot)
        ctx.translate(-cx, -cy)
      }
      if (o.kind === 'text' && o.text) {
        const fullText = vis.reveal < 1
          ? o.text.slice(0, Math.ceil(o.text.length * vis.reveal))
          : o.text
        if (!fullText) {
          ctx.restore()
          continue
        }
        const fontSize = Math.max(9, Math.round(h * 0.085 * scale))
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.65)'
        ctx.shadowBlur = fontSize * 0.35
        ctx.fillStyle = '#ffffff'
        const words = fullText.split(/\s+/)
        const maxWidth = w * 0.86
        const lines: string[] = []
        let line = ''
        for (const word of words) {
          const test = line ? `${line} ${word}` : word
          if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line)
            line = word
          } else {
            line = test
          }
        }
        if (line) lines.push(line)
        const leading = fontSize * 1.2
        const startY = Math.max(leading / 2 + 6, Math.min(h - leading / 2 - 6, cy)) - ((lines.length - 1) * leading) / 2
        lines.forEach((text, i) => ctx.fillText(text, cx, startY + i * leading))
        // Hit-test rect: centered on the text block.
        const lineW = lines.reduce((max, ln) => Math.max(max, ctx.measureText(ln).width), 0)
        overlayRects.current.set(o.id, { x: cx - lineW / 2 - 8, y: startY - leading * 0.75 - 4, w: lineW + 16, h: leading * lines.length + 10 })
      } else if (o.kind !== 'text') {
        const el = overlayEls.current.get(o.id)
        const loaded = el instanceof HTMLVideoElement ? el.videoWidth > 0 : el instanceof HTMLImageElement && el.naturalWidth > 0
        if (el && loaded) {
          const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
          const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
          let dw = w * scale
          let dh = sw > 0 ? (dw * sh) / sw : dw
          const boxH = h * scale
          if (dh > boxH) {
            dh = boxH
            dw = sh > 0 ? (dh * sw) / sh : dh
          }
          if (dw > 2 && dh > 2) {
            ctx.drawImage(el, cx - dw / 2, cy - dh / 2, dw, dh)
            overlayRects.current.set(o.id, { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh })
          }
        }
      }
      ctx.restore()
    }
    // Stale rects (overlays that left the window) must not be hit-testable.
    for (const id of Array.from(overlayRects.current.keys())) {
      if (!painted.includes(id)) overlayRects.current.delete(id)
    }
  }, [])

  /** Draws the active title overlay for `clip` at `localOut` seconds in. */
  const drawTitle = useCallback((ctx: CanvasRenderingContext2D, clip: VideoClip, localOut: number): void => {
    const title = clip.title
    if (!title || localOut > title.show) return
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    if (w === 0 || h === 0) return
    const fontSize = Math.round(h * 0.075)
    ctx.save()
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.65)'
    ctx.shadowBlur = fontSize * 0.35
    ctx.fillStyle = '#ffffff'
    const words = title.text.split(/\s+/)
    const maxWidth = w * 0.9
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    const baseline = title.position === 'center' ? h * 0.5 : h * 0.82
    const leading = fontSize * 1.25
    const startY = baseline - ((lines.length - 1) * leading) / 2
    lines.forEach((text, i) => ctx.fillText(text, w / 2, startY + i * leading))
    ctx.restore()
  }, [])

  /** Paints titles + overlay layers on top of an already-composited frame. */
  const paintTopLayers = useCallback((ctx: CanvasRenderingContext2D, layoutNow: SequenceLayout, located: LocatedTime): void => {
    const entry = layoutNow.entries[located.index]
    if (!entry) return
    if (entry.clip.title) drawTitle(ctx, entry.clip, located.localOut)
    if (located.overlapWith !== null) {
      const partner = layoutNow.entries[located.overlapWith]
      if (partner?.clip.title) drawTitle(ctx, partner.clip, located.overlapLocalOut)
    }
    drawOverlays(ctx, globalT.current)
  }, [drawOverlays, drawTitle])

  /** Composite base + overlap transition + colour dips onto the visible canvas. */
  const composite = useCallback(
    (layoutNow: SequenceLayout, located: LocatedTime): void => {
      const out = outCanvasRef.current
      const glMain = glMainRef.current
      const glSecond = glSecondRef.current
      const ctx = out?.getContext('2d')
      if (!ctx || !glMain) return
      // Keyed pixels leave transparent holes — every composite starts clean so
      // stale frames never accumulate under them.
      const settings = ctrlCanvas.current
      const outW = ctx.canvas.width
      const outH = ctx.canvas.height
      const fixed = settings.aspect !== 'original'
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, outW, outH)
      if (fixed && outW > 0 && outH > 0) {
        if (settings.background === 'blur' && glMain.width > 0 && glMain.height > 0) {
          // Blurred cover copy behind the sharp, contained clip.
          ctx.fillStyle = '#000000'
          ctx.fillRect(0, 0, outW, outH)
          const cover = coverRect(glMain.width, glMain.height, outW, outH)
          const blur = Math.max(6, Math.round(Math.min(outW, outH) / 36))
          ctx.save()
          ctx.filter = `blur(${blur}px)`
          ctx.globalAlpha = 0.9
          ctx.drawImage(glMain, cover.x, cover.y, cover.w, cover.h)
          ctx.restore()
        } else {
          ctx.fillStyle = settings.color
          ctx.fillRect(0, 0, outW, outH)
        }
      }

      // Both sources are fitted the same way the normal frame is; effects then
      // translate / scale / clip them within the output canvas.
      const full = { x: 0, y: 0, w: outW, h: outH }
      const mainFit = fixed ? containRect(glMain.width, glMain.height, outW, outH) : full
      const secondFit =
        fixed && glSecond && glSecond.width > 0 && glSecond.height > 0
          ? containRect(glSecond.width, glSecond.height, outW, outH)
          : full

      interface LayerOptions {
        dx?: number
        dy?: number
        scale?: number
        /** Rotation in radians around the canvas center. */
        rot?: number
        alpha?: number
        blur?: number
        clip?: () => void
      }
      const drawLayer = (src: HTMLCanvasElement, fit: typeof full, opts: LayerOptions = {}): void => {
        if (src.width <= 0 || src.height <= 0) return
        const alpha = opts.alpha ?? 1
        if (alpha <= 0.001) return
        const scale = opts.scale ?? 1
        ctx.save()
        if (opts.rot) {
          ctx.translate(outW / 2, outH / 2)
          ctx.rotate(opts.rot)
          ctx.translate(-outW / 2, -outH / 2)
        }
        if (opts.clip) {
          ctx.beginPath()
          opts.clip()
          ctx.clip()
        }
        ctx.globalAlpha = alpha
        if (opts.blur && opts.blur > 0.3) ctx.filter = `blur(${opts.blur.toFixed(1)}px)`
        if (scale !== 1) {
          ctx.translate(fit.x + fit.w / 2 + (opts.dx ?? 0), fit.y + fit.h / 2 + (opts.dy ?? 0))
          ctx.scale(scale, scale)
          ctx.drawImage(src, -fit.w / 2, -fit.h / 2, fit.w, fit.h)
        } else {
          ctx.drawImage(src, fit.x + (opts.dx ?? 0), fit.y + (opts.dy ?? 0), fit.w, fit.h)
        }
        ctx.restore()
      }

      const entry = layoutNow.entries[located.index]
      const partner = located.overlapWith !== null ? layoutNow.entries[located.overlapWith] : undefined
      const overlap = entry?.overlapAfter ?? 0
      const type = partner?.clip.transition ?? 'cut'
      const active = partner !== undefined && overlap > 0 && isOverlapTransition(type)
      const p = active ? Math.max(0, Math.min(1, located.overlapLocalOut / Math.max(0.001, overlap))) : 0

      if (!active || !glSecond) {
        drawLayer(glMain, mainFit)
      } else {
        switch (type) {
          case 'slideLeft':
            drawLayer(glMain, mainFit, { dx: -p * outW })
            drawLayer(glSecond, secondFit, { dx: (1 - p) * outW })
            break
          case 'slideRight':
            drawLayer(glMain, mainFit, { dx: p * outW })
            drawLayer(glSecond, secondFit, { dx: -(1 - p) * outW })
            break
          case 'slideUp':
            drawLayer(glMain, mainFit, { dy: -p * outH })
            drawLayer(glSecond, secondFit, { dy: (1 - p) * outH })
            break
          case 'slideDown':
            drawLayer(glMain, mainFit, { dy: p * outH })
            drawLayer(glSecond, secondFit, { dy: -(1 - p) * outH })
            break
          case 'wipeRight':
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { clip: () => ctx.rect(0, 0, p * outW, outH) })
            break
          case 'wipeLeft':
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { clip: () => ctx.rect((1 - p) * outW, 0, p * outW, outH) })
            break
          case 'wipeDown':
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { clip: () => ctx.rect(0, 0, outW, p * outH) })
            break
          case 'wipeUp':
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { clip: () => ctx.rect(0, (1 - p) * outH, outW, p * outH) })
            break
          case 'circle':
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, {
              clip: () => ctx.arc(outW / 2, outH / 2, (p * Math.hypot(outW, outH)) / 2, 0, Math.PI * 2),
            })
            break
          case 'zoom':
            // Outgoing pushes in while fading; incoming settles from 86 %.
            drawLayer(glMain, mainFit, { scale: 1 + 0.12 * p, alpha: 1 - p })
            drawLayer(glSecond, secondFit, { scale: 0.86 + 0.14 * p, alpha: p })
            break
          case 'blur': {
            // Both sides defocus through the middle of the crossfade.
            const maxBlur = Math.max(8, Math.min(outW, outH) / 40)
            drawLayer(glMain, mainFit, { blur: p * maxBlur })
            drawLayer(glSecond, secondFit, { alpha: p, blur: (1 - p) * maxBlur })
            break
          }
          case 'spin':
            // Outgoing whirls out; incoming whirls in from the other way.
            drawLayer(glMain, mainFit, { rot: p * 0.5, scale: 1 + 0.15 * p, alpha: 1 - p })
            drawLayer(glSecond, secondFit, { rot: -(1 - p) * 0.5, scale: 1.15 - 0.15 * p, alpha: p })
            break
          case 'zoomBlur': {
            // Zoom and defocus together — the punch-in feel.
            const maxBlur = Math.max(8, Math.min(outW, outH) / 40)
            drawLayer(glMain, mainFit, { scale: 1 + 0.25 * p, blur: p * maxBlur, alpha: 1 - p })
            drawLayer(glSecond, secondFit, { scale: 1.25 - 0.25 * p, blur: (1 - p) * maxBlur, alpha: p })
            break
          }
          case 'barnDoor':
            // Incoming revealed as two panels closing in from the sides.
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, {
              clip: () => {
                ctx.rect(0, 0, (p * outW) / 2, outH)
                ctx.rect(outW - (p * outW) / 2, 0, (p * outW) / 2, outH)
              },
            })
            break
          case 'flash': {
            // Quick dissolve under a white flash peaking mid-transition.
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { alpha: p })
            ctx.globalAlpha = Math.min(1, Math.sin(p * Math.PI))
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, outW, outH)
            ctx.globalAlpha = 1
            break
          }
          default:
            // Dissolve: the incoming clip fades in over the outgoing one.
            drawLayer(glMain, mainFit)
            drawLayer(glSecond, secondFit, { alpha: p })
        }
      }
      if (!entry) return
      // Boundary dips to black/white (sequential halves, no overlap).
      const clip = entry.clip
      let fade = 0
      let fadeColor = '#000000'
      if (clip.transition === 'fadeBlack' || clip.transition === 'fadeWhite') {
        const half = Math.max(0.001, Math.min(clip.transitionDuration, entry.out) / 2)
        if (located.localOut < half) {
          fade = 1 - located.localOut / half
          fadeColor = clip.transition === 'fadeBlack' ? '#000000' : '#ffffff'
        }
      }
      const nextEntry = layoutNow.entries[located.index + 1]
      if (nextEntry && (nextEntry.clip.transition === 'fadeBlack' || nextEntry.clip.transition === 'fadeWhite')) {
        const tail = Math.max(0.001, Math.min(nextEntry.clip.transitionDuration, entry.out) / 2)
        const remaining = entry.out - located.localOut
        if (remaining < tail) {
          const tailFade = 1 - remaining / tail
          if (tailFade > fade) {
            fade = tailFade
            fadeColor = nextEntry.clip.transition === 'fadeBlack' ? '#000000' : '#ffffff'
          }
        }
      }
      if (fade > 0.001) {
        ctx.globalAlpha = Math.min(1, fade)
        ctx.fillStyle = fadeColor
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.globalAlpha = 1
      }
    },
    [],
  )

  // Fresh values for the otherwise effect-stable loop.
  const ctrlMusic = useRef(music)
  ctrlMusic.current = music
  const stSetPlayingFalse = useRef((): void => undefined)
  stSetPlayingFalse.current = () => useVideoEditor.getState().setPlaying(false)
  const recordingTotal = useRef(0)

  // --- the engine loop ------------------------------------------------------
  useEffect(() => {
    let raf = 0
    let frameErrorLogged = false
    const tick = (): void => {
      try {
        const layoutNow = ctrlLayout.current
        const isActive = ctrlPlaying.current
        const durationsNow = ctrlDurations.current
        const outOf = (clip: VideoClip): number => clipOutDuration(clip, durationsNow[clip.assetId] ?? 0)
        const srcAt = (clip: VideoClip, localOut: number): number => clipSrcAt(clip, localOut, durationsNow[clip.assetId] ?? 0)
        const dim = { setTime: storeFns.current.setTime, setPlaying: storeFns.current.setPlaying }
        if (layoutNow.entries.length > 0) {
          const located = locateTime(layoutNow, globalT.current)
          const entry = layoutNow.entries[located.index]
          const mainEl = slotEl(main.current)
          const mainClipId = slotClip.current[main.current]

          // 1. While playing, the assigned video element is the clock. With a
          //    speed ramp the element plays at a varying rate, so output time is
          //    recovered by inverting the ramp's source integral.
          if (isActive && mainEl && entry && mainClipId === entry.clip.id) {
            const clip = entry.clip
            const speed = clip.edit.speed > 0 ? clip.edit.speed : 1
            const clipOut = Math.max(0.0001, outOf(clip))
            let localOut: number
            if (clip.edit.speedCurve !== 'none') {
              const end = clip.edit.trimEnd ?? durationsNow[clip.assetId] ?? 0
              const span = Math.max(0.0001, end - clip.edit.trimStart)
              const f = Math.max(0, Math.min(1, (mainEl.currentTime - clip.edit.trimStart) / span))
              localOut = outFractionAt(clip.edit.speedCurve, f) * clipOut
              const rate = speed * shapeAt(clip.edit.speedCurve, Math.max(0, Math.min(1, (localOut / clipOut))))
              if (Number.isFinite(rate) && rate > 0.05 && Math.abs(mainEl.playbackRate - rate) > 0.02) {
                try {
                  mainEl.playbackRate = rate
                } catch {
                  // some browsers reject extreme rates
                }
              }
            } else {
              localOut = (mainEl.currentTime - clip.edit.trimStart) / speed
            }
            globalT.current = entry.globalStart + localOut
            if (Number.isFinite(localOut)) dim.setTime(Math.min(layoutNow.total, globalT.current))
            // Crossfade audio envelopes during an overlap transition.
            if (located.overlapWith !== null && entry.overlapAfter > 0) {
              const partner = layoutNow.entries[located.overlapWith]
              const p = Math.max(0, Math.min(1, (globalT.current - partner.globalStart) / entry.overlapAfter))
              const inEl = slotEl(other(main.current))
              mainEl.volume = Math.min(1, (clip.edit.volume / 100) * (1 - p))
              if (inEl) inEl.volume = Math.min(1, (partner.clip.edit.volume / 100) * p)
            }
            // End of the whole sequence: stop (and release an awaiting export).
            if (globalT.current >= layoutNow.total - 0.06 || mainEl.ended) {
              mainEl.pause()
              const finished = exportDone.current
              if (finished) {
                exportDone.current = null
                stSetPlayingFalse.current()
                finished()
              } else {
                stSetPlayingFalse.current()
                dim.setTime(layoutNow.total)
              }
            }
          }

          if (entry) {
            const nowMs = performance.now()
            // 2. Keep the overlap partner in the free slot: parked on its frame
            //    while paused (so scrubbing previews the transition), playing
            //    once the overlap window opens.
            const partner = located.overlapWith !== null ? layoutNow.entries[located.overlapWith] : undefined
            if (partner) {
              const free = other(main.current)
              const inEl = slotEl(free)
              const holds = slotClip.current[free] === partner.clip.id && inEl !== null
              if (holds && inEl) {
                if (isActive) {
                  if (inEl.paused) {
                    inEl.playbackRate = partner.clip.edit.speed
                    void inEl.play().catch(() => undefined)
                  }
                } else {
                  // A paused scrub paints the partner at the exact overlap frame.
                  const partnerSrc = srcAt(partner.clip, located.overlapLocalOut)
                  if (Math.abs(inEl.currentTime - partnerSrc) > 0.1) {
                    try {
                      inEl.currentTime = Math.max(0, partnerSrc)
                      void seeked(inEl, 2000).then(() => {
                        lastRenderKey.current = ''
                      })
                    } catch {
                      // not seekable yet
                    }
                  }
                  if (!inEl.paused) inEl.pause()
                }
              } else if (!isActive && flipBusy.current === null && nowMs - lastPartnerLoadAt.current > 150) {
                lastPartnerLoadAt.current = nowMs
                const partnerSrc = srcAt(partner.clip, located.overlapLocalOut)
                void assignSlot(free, partner.clip, partnerSrc, false)
                  .then(() => {
                    lastRenderKey.current = ''
                  })
                  .catch(() => undefined)
              }
            }
            // 3. Flip the main slot when the playhead scope outgrew its clip.
            const holdsNow = slotClip.current[main.current] === entry.clip.id
            if (!holdsNow && flipBusy.current !== entry.clip.id) {
              const target = entry.clip
              const src = srcAt(target, located.localOut)
              const otherEl = slotEl(other(main.current))
              if (slotClip.current[other(main.current)] === target.id && otherEl) {
                // Preloaded — synchronous flip.
                if (Math.abs(otherEl.currentTime - src) > 0.04) otherEl.currentTime = Math.max(0, src)
                main.current = other(main.current)
                if (isActive) void otherEl.play().catch(() => undefined)
              } else {
                flipBusy.current = target.id
                const wasMain = main.current
                void assignSlot(other(wasMain), target, src, isActive)
                  .then(() => {
                    if (slotClip.current[other(wasMain)] === target.id) main.current = other(wasMain)
                  })
                  .catch(() => undefined)
                  .finally(() => {
                    flipBusy.current = null
                  })
              }
            }
            // 4. Preload the next clip into the free slot (throttled).
            const nextEntry = layoutNow.entries[located.index + 1]
            if (
              isActive &&
              nextEntry &&
              nowMs - lastPreloadAt.current > 400 &&
              flipBusy.current === null &&
              slotClip.current[other(main.current)] !== nextEntry.clip.id &&
              located.overlapWith === null
            ) {
              const timeToBoundary = nextEntry.globalStart - globalT.current
              if (timeToBoundary < PRELOAD_LEAD_S) {
                lastPreloadAt.current = nowMs
                void assignSlot(other(main.current), nextEntry.clip, nextEntry.clip.edit.trimStart, false).catch(() => undefined)
              }
            }
            // 5. Pause the stray slot when nothing needs it.
            if (located.overlapWith === null && flipBusy.current === null) {
              const idleEl = slotEl(other(main.current))
              const idleIsPreload = nextEntry !== undefined && slotClip.current[other(main.current)] === nextEntry.clip.id && isActive && nextEntry.globalStart - globalT.current < PRELOAD_LEAD_S
              if (idleEl && !idleEl.paused && !idleIsPreload) {
                idleEl.pause()
              }
            }
          }

          // 6. Render (always while playing; on change while paused).
          const mainEl2 = slotEl(main.current)
          const ready = entry !== undefined && slotClip.current[main.current] === entry.clip.id
          const docNow = ctrlDoc.current
          // While playing the frame is repainted unconditionally, so the
          // (allocation-heavy) change key is only needed for paused updates.
          const renderKey = ready && !isActive
            ? [
                entry.clip.id,
                slotClip.current[main.current],
                ctrlActiveClipId.current,
                ctrlBypass.current,
                docNow ? docNow.speed : '',
                docNow ? docNow.trimStart : '',
                docNow ? docNow.trimEnd : '',
                docNow ? docNow.volume : '',
                docNow ? docNow.muted : '',
                docNow ? docNow.speedCurve : '',
                docNow ? Object.keys(docNow.adjustments).length : '',
                docNow ? (docNow.adjustments as Record<string, number>)[Object.keys(docNow.adjustments)[0] ?? ''] : '',
                docNow?.chromaKey?.enabled
                  ? `key:${docNow.chromaKey.color.map((v) => v.toFixed(2)).join(',')}:${docNow.chromaKey.similarity.toFixed(3)}:${docNow.chromaKey.smoothness.toFixed(3)}:${docNow.chromaKey.spill.toFixed(3)}`
                  : 'nokey',
                docNow?.mask && docNow.mask.shape !== 'none'
                  ? `mask:${docNow.mask.shape}:${docNow.mask.x.toFixed(3)}:${docNow.mask.y.toFixed(3)}:${docNow.mask.w.toFixed(3)}:${docNow.mask.h.toFixed(3)}:${docNow.mask.rotation.toFixed(1)}:${docNow.mask.feather.toFixed(3)}:${docNow.mask.invert ? 1 : 0}`
                  : 'nomask',
                `bg:${entry.clip.edit.bgRemove ? 1 : 0}:${ctrlSeg.current}`,
                `canvas:${ctrlCanvas.current.aspect}:${ctrlCanvas.current.background}:${ctrlCanvas.current.color}`,
                located.overlapWith !== null
                  ? `overlap:${layoutNow.entries[located.overlapWith].clip.id}:${slotClip.current[other(main.current)] === layoutNow.entries[located.overlapWith].clip.id ? 1 : 0}`
                  : '',
                entry.clip.keyframes
                  ? `${entry.clip.keyframes.scale.length},${entry.clip.keyframes.x.length},${entry.clip.keyframes.y.length},${entry.clip.keyframes.scale.map((k) => k.v.toFixed(2)).join('')},${entry.clip.keyframes.x.map((k) => k.v.toFixed(2)).join('')},${entry.clip.keyframes.y.map((k) => k.v.toFixed(2)).join('')}`
                  : '',
                overlaysRef.current.map((o) => `${o.id}:${o.start.toFixed(2)}:${o.duration.toFixed(2)}:${o.base.scale.toFixed(2)}:${o.base.x.toFixed(2)}:${o.base.y.toFixed(2)}:${o.base.opacity.toFixed(2)}:${o.animIn ?? ''}:${o.animOut ?? ''}:${o.text ?? o.assetId ?? ''}`).join('|'),
                // Media layers load async — include readiness so a layer that
                // finishes decoding repaints immediately instead of waiting for
                // the next seek/keyframe change.
                overlaysRef.current
                  .filter((o) => o.kind !== 'text')
                  .map((o) => {
                    const el = overlayEls.current.get(o.id)
                    const ok = el instanceof HTMLVideoElement ? el.videoWidth > 0 : el instanceof HTMLImageElement && el.naturalWidth > 0
                    return ok ? '1' : '0'
                  })
                  .join(''),
                recordingRef.current ? 'rec' : '',
              ].join('|')
            : ''
          if (ready && entry && (isActive || renderKey !== lastRenderKey.current || Math.abs(globalT.current - lastPaintedT.current) > 0.015)) {
            if (!isActive) lastRenderKey.current = renderKey
            const geom = geometryFor(entry.clip, located.localOut)
            const dims = renderInto(mainEl2, glMainRef.current as HTMLCanvasElement, entry.clip, geom)
            if (dims && dims.w > 0 && dims.h > 0) {
              // The output canvas keeps a FIXED size per clip (the uncropped frame
              // size, capped to the preview edge) — it must not follow the camera
              // crop. Resizing it every zoom step clears the canvas, jitters the
              // layout and re-renders React; the GL layer is cropped anyway and
              // simply stretches into the fixed frame.
              const cachedDims = baseDimsRef.current
              const fixedDims = canvasOutputSize(ctrlCanvas.current)
              const baseDims = fixedDims
                ? { id: `canvas:${ctrlCanvas.current.aspect}`, w: fixedDims.w, h: fixedDims.h }
                : cachedDims && cachedDims.id === entry.clip.id
                  ? cachedDims
                  : { id: entry.clip.id, w: Math.min(4096, Math.round(dims.w / Math.max(0.05, geom.crop.w))), h: Math.min(4096, Math.round(dims.h / Math.max(0.05, geom.crop.h))) }
              baseDimsRef.current = baseDims
              const out = outCanvasRef.current
              if (out && (out.width !== baseDims.w || out.height !== baseDims.h)) {
                out.width = baseDims.w
                out.height = baseDims.h
                setOutDims({ w: baseDims.w, h: baseDims.h })
              }
              // Dissolve partner layer (with its own camera state if animated).
              if (located.overlapWith !== null) {
                const partner = layoutNow.entries[located.overlapWith]
                const partnerEl = slotEl(other(main.current))
                if (partnerEl && slotClip.current[other(main.current)] === partner.clip.id) {
                  renderInto(partnerEl, glSecondRef.current as HTMLCanvasElement, partner.clip, geometryFor(partner.clip, located.overlapLocalOut))
                }
              }
              composite(layoutNow, located)
              lastPaintedT.current = globalT.current
              const ctx = outCanvasRef.current?.getContext('2d')
              // Titles + overlay layers above everything.
              if (ctx) paintTopLayers(ctx, layoutNow, located)
              // Histogram (throttled).
              const histCanvas = histRef.current
              if (!ctrlBypass.current && histCanvas && performance.now() - lastHistAt.current > histogramInterval()) {
                lastHistAt.current = performance.now()
                const hctx = histCanvas.getContext('2d', { willReadFrequently: true })
                const out = outCanvasRef.current
                if (hctx && out && out.width > 0) {
                  hctx.clearRect(0, 0, histCanvas.width, histCanvas.height)
                  hctx.drawImage(out, 0, 0, histCanvas.width, histCanvas.height)
                  const data = hctx.getImageData(0, 0, histCanvas.width, histCanvas.height)
                  const histogram = computeHistogram(data.data, 12000)
                  storeFns.current.setHistogram(histogram)
                  ctrlHistogram.current?.(histogram)
                }
              }
            }
          }
        }

        // 7. Export progress.
        if (recordingRef.current && performance.now() - lastProgressAt.current > PROGRESS_INTERVAL_MS) {
          lastProgressAt.current = performance.now()
          setRecording({ done: Math.min(recordingTotal.current, globalT.current), total: recordingTotal.current })
        }

        // 8. Overlay media layers follow the playhead in their own windows.
        for (const o of overlaysRef.current) {
          if (o.kind !== 'video') continue
          const el = overlayEls.current.get(o.id)
          if (!(el instanceof HTMLVideoElement) || !el.currentSrc) continue
          const active = globalT.current >= o.start && globalT.current < o.start + o.duration
          if (active) {
            const local = globalT.current - o.start
            const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : o.duration
            const seekTarget = dur > 0 ? local % dur : 0
            const tolerance = isActive ? 0.3 : 0.06
            el.muted = o.muted === true
            if (Math.abs(el.currentTime - seekTarget) > tolerance) {
              try {
                el.currentTime = Math.max(0, seekTarget)
              } catch {
                // not seekable yet
              }
            }
            if (isActive && el.paused) void el.play().catch(() => undefined)
            if (!isActive && !el.paused) el.pause()
          } else if (!el.paused) {
            el.pause()
          }
        }

        // 9. Music follows the sequence.
        const musicEl = musicRef.current
        const m = ctrlMusic.current
        if (musicEl && m) {
          const activeEntry = ctrlLayout.current.entries[locateTime(ctrlLayout.current, globalT.current).index]
          const talking = activeEntry !== undefined && activeEntry.clip.edit.muted === false && activeEntry.clip.edit.volume > 0
          const target = (m.volume / 100) * (talking && m.duck !== false ? 0.25 : 1)
          if (Math.abs(musicEl.volume - target) > 0.01) musicEl.volume = Math.min(1, target)
          musicEl.loop = true
        }
      } catch (err) {
        // One bad frame (a decoder hiccup, a zero-size canvas) must not kill
        // the whole playback engine. Log once and keep the loop alive.
        if (!frameErrorLogged) {
          frameErrorLogged = true
          console.error('Video engine frame failed', err)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [assignSlot, composite, paintTopLayers, geometryFor, renderInto])

  // Fresh values for the otherwise effect-stable loop.
  const ctrlLayout = useRef(layout)
  ctrlLayout.current = layout
  const ctrlPlaying = useRef(playing)
  ctrlPlaying.current = playing
  const overlaysRef = useRef(overlays)
  overlaysRef.current = overlays
  const ctrlDurations = useRef(durations)
  ctrlDurations.current = durations

  // Music element source: assign the cached blob URL reactively.
  const musicAssetId = music?.assetId ?? null
  const musicAsset = musicAssetId ? assetMap.get(musicAssetId) ?? null : null
  useEffect(() => {
    const el = musicRef.current
    if (!el) return
    if (!musicAsset) {
      el.pause()
      el.removeAttribute('src')
      return
    }
    if (el.getAttribute('data-asset-id') === musicAsset.id) return
    let cancelled = false
    void getAssetUrl(musicAsset.id)
      .then((url) => {
        if (cancelled) return
        if (el.getAttribute('data-asset-id') === musicAsset.id) return
        el.src = url
        el.setAttribute('data-asset-id', musicAsset.id)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [musicAsset, getAssetUrl])

  // Play/pause drives the currently assigned decoders + music.
  useEffect(() => {
    const mainEl = slotEl(main.current)
    const musicEl = musicRef.current
    if (playing) {
      if (mainEl && mainEl.currentSrc && mainEl.paused) {
        void mainEl.play().catch(() => undefined)
      }
      if (musicEl && music) {
        try {
          if (Number.isFinite(musicEl.duration) && musicEl.duration > 0) {
            musicEl.currentTime = globalT.current % musicEl.duration
          }
          void musicEl.play().catch(() => undefined)
        } catch {
          // ignore
        }
      }
    } else {
      musicEl?.pause()
      videoARef.current?.pause()
      videoBRef.current?.pause()
    }
  }, [playing, music])

  const togglePlay = useCallback(async (): Promise<void> => {
    const st = useVideoEditor.getState()
    if (st.playing) {
      st.setPlaying(false)
      return
    }
    if (st.sequence.length === 0) return
    if (globalT.current >= (ctrlLayout.current.total - 0.05)) globalT.current = 0
    st.setPlaying(true)
  }, [])

  const seekTo = useCallback(
    (t: number): void => {
      const layoutNow = ctrlLayout.current
      if (layoutNow.entries.length === 0) return
      const clamped = Math.max(0, Math.min(layoutNow.total, t))
      const located = locateTime(layoutNow, clamped)
      const entry = layoutNow.entries[located.index]
      if (!entry) return
      globalT.current = clamped
      storeFns.current.setTime(clamped)
      const src = clipSrcAt(entry.clip, located.localOut, ctrlDurations.current[entry.clip.assetId] ?? 0)
      const wantsClip = entry.clip.id
      // A paused seek can paint before the decoder delivers the requested
      // frame. Invalidate the cache once the seek settles so the engine
      // repaints the true frame instead of leaving a stale one on screen.
      const invalidateFrame = (): void => {
        lastRenderKey.current = ''
        lastPaintedT.current = -1
      }
      if (slotClip.current[main.current] !== wantsClip) {
        const otherEl = slotEl(other(main.current))
        if (slotClip.current[other(main.current)] === wantsClip && otherEl) {
          const prevMain = main.current
          if (Math.abs(otherEl.currentTime - src) > 0.04) {
            otherEl.currentTime = Math.max(0, src)
            void seeked(otherEl, 2000).then(invalidateFrame)
          } else {
            invalidateFrame()
          }
          main.current = other(main.current)
          void assignSlot(prevMain, entry.clip, src, false).catch(() => undefined)
        } else if (flipBusy.current !== wantsClip) {
          flipBusy.current = wantsClip
          const wasMain = main.current
          void assignSlot(other(wasMain), entry.clip, src, false)
            .then(() => {
              if (slotClip.current[other(wasMain)] === wantsClip) main.current = other(wasMain)
              invalidateFrame()
            })
            .catch(() => undefined)
            .finally(() => {
              flipBusy.current = null
            })
        }
      } else {
        const el = slotEl(main.current)
        if (el) {
          el.currentTime = Math.max(0, src)
          void seeked(el, 2000).then(invalidateFrame)
        }
      }
      requestAnimationFrame(() => {
        composite(layoutNow, located)
        // A seek's partial repaint must not wipe titles/overlays off the frame.
        const ctx = outCanvasRef.current?.getContext('2d')
        if (ctx) paintTopLayers(ctx, layoutNow, located)
      })
    },
    [assignSlot, composite, paintTopLayers],
  )

  // Keyboard: space to play/pause, hold \ to compare, ⌘Z undo.
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      const tag = el?.tagName ?? ''
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      const key = e.key.toLowerCase()
      const { undo, redo, setBypass } = useVideoEditor.getState()
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        void togglePlay()
      } else if (e.key === '\\' && !e.metaKey && !e.ctrlKey) {
        setBypass(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === '\\') useVideoEditor.getState().setBypass(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [togglePlay])

  /** Saves the current preview frame as the Reel cover / YouTube thumbnail. */
  const saveCoverFrame = useCallback(async (): Promise<void> => {
    const out = outCanvasRef.current
    if (!out || out.width === 0) return
    try {
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) return
      await downloadBlob(blob, exportSequenceName('cover', 'jpg'))
    } catch {
      // canvas tainted or download blocked — silently skip
    }
  }, [])

  const startExport = useCallback(async (): Promise<void> => {    const out = outCanvasRef.current
    if (!out || recordingRef.current) return
    if (ctrlLayout.current.entries.length === 0) return
    setRecordError(null)
    const total = ctrlLayout.current.total
    recordingTotal.current = total
    setRecording({ done: 0, total })
    const started = useVideoEditor.getState()
    started.setPlaying(false)
    seekTo(0)
    const audioElements = [
      videoARef.current,
      videoBRef.current,
      musicRef.current,
      // Multi-track: unmuted overlay video layers contribute their own audio.
      ...overlaysRef.current
        .filter((o) => o.kind === 'video' && o.muted !== true)
        .map((o) => overlayEls.current.get(o.id))
        .filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement),
    ].filter((el): el is HTMLMediaElement => el !== null && el !== undefined)
    const run = (): Promise<void> =>
      new Promise<void>((resolve) => {
        exportDone.current = resolve
        void togglePlay()
      })
    try {
      // Prefer the WebCodecs path (MP4, precise frames, hardware encoders);
      // fall back to MediaRecorder when unavailable or it fails early.
      let blob: Blob | null = null
      try {
        const format = await pickWcFormat()
        if (format) {
          blob = await recordWebCodecs({ canvas: out, audioElements, seconds: total, run, format })
        }
      } catch (wcError) {
        console.warn('WebCodecs export failed, falling back to MediaRecorder', wcError)
      }
      if (!blob) {
        seekTo(0)
        blob = await recordStream({ canvas: out, audioElements, seconds: total, run })
      }
      downloadBlob(blob, exportSequenceName(project?.name ?? 'sequence', blob.type.includes('mp4') ? 'mp4' : 'webm'))
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err))
    } finally {
      exportDone.current = null
      recordingTotal.current = 0
      setRecording(null)
      started.setPlaying(false)
      started.setExporting(false)
    }
  }, [project?.name, seekTo, togglePlay])

  const fit = useCallback((): { w: number; h: number } => {
    if (outDims.w === 0 || box.w < 40 || box.h < 40) return { w: 0, h: 0 }
    const scale = Math.min(box.w / outDims.w, box.h / outDims.h, 1)
    return { w: Math.round(outDims.w * scale), h: Math.round(outDims.h * scale) }
  }, [outDims, box])

  const size = fit()

  // --- Direct overlay dragging on the preview (grab the layer to move it) ---
  const dragState = useRef<{ id: string; offX: number; offY: number } | null>(null)
  const suppressStageClick = useRef(false)

  const stagePoint = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const out = outCanvasRef.current
    if (!out || out.width === 0) return null
    const rect = out.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: ((e.clientX - rect.left) / rect.width) * out.width, y: ((e.clientY - rect.top) / rect.height) * out.height }
  }

  const hitOverlayAt = (e: { clientX: number; clientY: number }): { id: string; grabX: number; grabY: number } | null => {
    const p = stagePoint(e)
    const out = outCanvasRef.current
    if (!p || !out) return null
    // Paint order is stacking order — the last hit wins (topmost layer).
    const ids = Array.from(overlayRects.current.keys())
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = overlayRects.current.get(ids[i])
      if (!r) continue
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        return { id: ids[i], grabX: p.x - (r.x + r.w / 2), grabY: p.y - (r.y + r.h / 2) }
      }
    }
    return null
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const hit = hitOverlayAt(e)
    if (!hit) {
      dragState.current = null
      return
    }
    // Grabbing a layer must not also toggle play/pause.
    e.preventDefault()
    e.stopPropagation()
    const st = useVideoEditor.getState()
    st.setActiveOverlay(hit.id)
    dragState.current = { id: hit.id, offX: hit.grabX, offY: hit.grabY }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
  }

  const onStagePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragState.current
    if (!drag) return
    const p = stagePoint(e)
    const out = outCanvasRef.current
    if (!p || !out) return
    const v = (v: number): number => Math.max(0, Math.min(1, v))
    useVideoEditor.getState().setOverlayProps({
      x: v((p.x - drag.offX) / out.width),
      y: v((p.y - drag.offY) / out.height),
    })
  }

  const onStagePointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (dragState.current) {
      useVideoEditor.getState().commitOverlayProps()
      dragState.current = null
      suppressStageClick.current = true
      window.setTimeout(() => {
        suppressStageClick.current = false
      }, 150)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
  }

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full flex-col p-2 sm:p-4">
      <div ref={stageAreaRef} className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <div style={{ width: size.w || undefined, height: size.h || undefined }} className="relative min-h-0">
          {/* Width/height are managed imperatively in the render loop (they
              change per-frame with the camera crop). Binding them here makes
              React "correct" the attribute after each paint, which resizes the
              canvas and wipes the frame just composited. */}
          {/* Grab an overlay layer directly on the preview to reposition it. */}
          <canvas
            ref={outCanvasRef}
            style={{ width: '100%', height: '100%' }}
            className="block cursor-pointer rounded-md bg-black shadow-2xl"
            aria-label="Graded sequence preview"
            onClick={() => {
              if (!suppressStageClick.current) void togglePlay()
            }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
          />
          <canvas ref={histRef} width={120} height={90} className="hidden" aria-hidden />
          {/* Platform safe-zone guides (Reels/TikTok/Shorts UI areas). */}
          {showSafeZones ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md" aria-hidden>
              <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-center bg-black/45 pt-1 text-[9px] font-medium text-white/80" style={{ height: '14%' }}>
                progress bar / profile row
              </div>
              <div className="absolute inset-y-0 right-0 z-10 flex w-[12%] items-center justify-center bg-black/45 text-center text-[8px] leading-tight text-white/80">
                buttons
              </div>
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-start bg-black/45 pb-1 pl-1.5 text-[9px] font-medium text-white/80" style={{ height: '20%' }}>
                caption / audio
              </div>
              <div className="absolute left-[3%] top-[16%] text-[9px] font-semibold uppercase tracking-wide text-white/70">
                Safe for text
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Hidden decoders: two slots for clip switching + music */}
      <video ref={videoARef} className="pointer-events-none absolute left-0 top-0 h-1 w-1 opacity-0" playsInline preload="auto" aria-hidden />
      <video ref={videoBRef} className="pointer-events-none absolute left-0 top-0 h-1 w-1 opacity-0" playsInline preload="auto" aria-hidden />
      <audio ref={musicRef} preload="auto" aria-hidden />

      {/* Hidden decoders for overlay media layers (composited each frame). */}
      {overlays.map((o) => {
        if (o.kind === 'text' || !o.assetId) return null
        if (o.kind === 'video') {
          return (
            <video
              key={o.id}
              ref={(el) => {
                registerOverlayEl(o.id, el)
              }}
              className="pointer-events-none absolute left-0 top-0 h-1 w-1 opacity-0"
              playsInline
              muted={o.muted === true}
              loop
              preload="auto"
              aria-hidden
            />
          )
        }
        return (
          <img
            key={o.id}
            ref={(el) => {
              registerOverlayEl(o.id, el)
            }}
            className="pointer-events-none absolute left-0 top-0 h-1 w-1 opacity-0"
            alt=""
            draggable={false}
            aria-hidden
          />
        )
      })}

      {/* Stage controls (in flow so they never cover the timeline on phones) */}
      <div className="z-30 mt-2 flex w-full max-w-3xl items-center justify-end gap-1 self-center sm:mt-3">
        {fallback ? (
          <Tooltip content="WebGL2 unavailable — Canvas 2D fallback (color approximate).">
            <Button size="icon" variant="ghost" aria-label="Renderer info">
              <AlertTriangle size={14} className="text-amber-400" />
            </Button>
          </Tooltip>
        ) : null}
        <Button
          size="sm"
          variant="subtle"
          aria-label="Hold to compare with original"
          title="Hold to compare (or hold \\)"
          onPointerDown={() => useVideoEditor.getState().setBypass(true)}
          onPointerUp={() => useVideoEditor.getState().setBypass(false)}
          onPointerLeave={() => useVideoEditor.getState().setBypass(false)}
          className={cn('fs-tool-hit', bypass ? 'ring-1 ring-accent' : undefined)}
        >
          <Eye size={13} />
          <span className="hidden sm:inline">Compare</span>
        </Button>
        <Button
          size="sm"
          variant="subtle"
          aria-label="Toggle platform safe-zone guides"
          aria-pressed={showSafeZones}
          title="Show where Reels/TikTok/Shorts UI covers the frame"
          onClick={() => setShowSafeZones((v) => !v)}
          className={cn('fs-tool-hit', showSafeZones && 'ring-1 ring-accent')}
        >
          <ShieldQuestion size={13} />
          <span className="hidden sm:inline">Safe zones</span>
        </Button>
        <Button size="sm" variant="subtle" aria-label="Save cover frame" title="Save the current frame as a cover image (JPEG)" onClick={() => void saveCoverFrame()}>
          <Camera size={13} />
          <span className="hidden sm:inline">Cover</span>
        </Button>
        <Button size="sm" variant="primary" onClick={() => void startExport()} disabled={recording !== null} className="fs-tool-hit">
          <Download size={13} />
          <span className="sm:hidden">Export</span>
          <span className="hidden sm:inline">Export video</span>
        </Button>
      </div>

      {/* Playback + sequence timeline */}
      <div className="z-20 mt-2 w-full max-w-3xl self-center sm:mt-3">
        {recording ? (
          <div className="mb-2 rounded-md bg-accent-soft px-3 py-1.5 text-[11px] text-accent" role="status">
            Recording {recording.done.toFixed(1)}s / {recording.total.toFixed(1)}s — export plays the sequence once…
          </div>
        ) : null}
        {recordError ? (
          <div className="mb-2 rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400" role="alert">
            {recordError}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button size="icon" variant="subtle" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void togglePlay()} className="fs-tool-hit">
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </Button>
          <VideoTimeline onSeek={seekTo} />
        </div>
      </div>
    </div>
  )
}

