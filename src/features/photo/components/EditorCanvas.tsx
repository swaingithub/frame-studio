import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Eye, Download, AlertTriangle } from 'lucide-react'
import { createDefaultEditDoc, type EditDoc, type PhotoTextOverlay } from '../../../core/adjustments/edits'
import { computeHistogram, type Histogram } from '../../../core/render/histogram'
import { isWebGL, renderEdit, renderGeometryBase } from '../../../core/render/pipeline'
import { CropOverlay } from './CropOverlay'
import { drawPhotoOverlays } from '../overlayDraw'
import { useAssetBlob } from '../../library/useAssets'
import { usePhotoEditor } from '../store'
import { Button } from '../../../ui/button'
import { Tooltip } from '../../../ui/tooltip'
import { cn } from '../../../lib/cn'
import type { MediaAsset } from '../../../core/db/schema'

/**
 * The live preview canvas. Owns a small LRU of decoded sources (full-res +
 * ≤2048px preview), re-renders via rAF on every doc change (slider drags cost
 * only a uniform upload + one draw), computes the histogram from a throttled
 * low-res pass, and wires undo/redo/compare keyboard shortcuts.
 */

/**
 * Preview budget adapts to the device: phones (narrow viewport) and
 * low-memory devices decode a smaller preview so the editor stays smooth.
 * Exports are unaffected — they always render from the full-res source.
 */
export function previewBudget(): number {
  if (typeof window === 'undefined') return 2048
  const nav = navigator as Navigator & { deviceMemory?: number }
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2
  if (lowMemory) return 1024
  return window.innerWidth < 1000 ? 1280 : 2048
}

/** Low-memory devices keep fewer decoded sources around. */
function sourceCacheCap(): number {
  if (typeof navigator === 'undefined') return 3
  const nav = navigator as Navigator & { deviceMemory?: number }
  return typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2 ? 2 : 3
}

async function makePreview(blob: Blob, full: ImageBitmap): Promise<ImageBitmap> {
  const longEdge = Math.max(full.width, full.height)
  const scale = Math.min(1, previewBudget() / longEdge)
  if (scale >= 1) return full
  try {
    return await createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(full.width * scale)),
      resizeHeight: Math.max(1, Math.round(full.height * scale)),
      resizeQuality: 'high',
      premultiplyAlpha: 'none',
    })
  } catch {
    return full
  }
}

interface SourceEntry {
  full: ImageBitmap
  preview: ImageBitmap
}

const sourceCache = new Map<string, SourceEntry>()

/** LRU of decoded sources. Evicted bitmaps are closed explicitly. */
export async function loadSource(assetId: string, blob: Blob): Promise<SourceEntry> {
  const cached = sourceCache.get(assetId)
  if (cached) {
    sourceCache.delete(assetId)
    sourceCache.set(assetId, cached)
    return cached
  }
  const full = await createImageBitmap(blob)
  const preview = await makePreview(blob, full)
  const entry: SourceEntry = { full, preview }
  sourceCache.set(assetId, entry)
  notifySourceChanged()
  while (sourceCache.size > sourceCacheCap()) {
    const oldest = sourceCache.keys().next().value
    if (oldest === undefined) break
    const stale = sourceCache.get(oldest)
    if (stale === entry) break
    sourceCache.delete(oldest)
    stale?.full.close()
    if (stale?.preview !== stale?.full) stale?.preview.close()
  }
  return entry
}

/** Access for export: the full-res bitmap for an asset, or null. */
export function getFullSource(assetId: string): ImageBitmap | null {
  return sourceCache.get(assetId)?.full ?? null
}

/** Small preview bitmap for an asset (thumbnails, preset looks), or null. */
export function getPreviewSource(assetId: string): ImageBitmap | null {
  return sourceCache.get(assetId)?.preview ?? null
}

/** Bumped whenever the source cache changes, so subscribers can re-check. */
const sourceListeners = new Set<() => void>()
let sourceVersion = 0
function notifySourceChanged(): void {
  sourceVersion++
  for (const listener of sourceListeners) listener()
}

/** Reactively returns the cached preview bitmap for an asset (or null). */
export function usePreviewSource(assetId: string | null): ImageBitmap | null {
  const [, force] = useState(0)
  useEffect(() => {
    let last = sourceVersion
    const listener = (): void => {
      if (sourceVersion !== last) {
        last = sourceVersion
        force((n) => n + 1)
      }
    }
    sourceListeners.add(listener)
    return () => {
      sourceListeners.delete(listener)
    }
  }, [])
  return assetId ? getPreviewSource(assetId) : null
}

interface EditorCanvasProps {
  asset: MediaAsset
  /** Called with a fresh histogram (throttled) after renders. */
  onHistogram?: (h: Histogram | null) => void
  onExport?: () => void
}

export function EditorCanvas({ asset, onHistogram, onExport }: EditorCanvasProps): ReactNode {
  const blob = useAssetBlob(asset)
  const doc = usePhotoEditor((s) => s.doc)
  const bypass = usePhotoEditor((s) => s.bypass)
  const cropMode = usePhotoEditor((s) => s.crop)
  const setBypass = usePhotoEditor((s) => s.setBypass)
  const undo = usePhotoEditor((s) => s.undo)
  const redo = usePhotoEditor((s) => s.redo)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const histRef = useRef<HTMLCanvasElement>(null)
  const lastHistAt = useRef(0)

  const [source, setSource] = useState<SourceEntry | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [outDims, setOutDims] = useState({ w: 0, h: 0 })
  const [fallback, setFallback] = useState(false)

  // Decode + cache the source when the asset (or its blob) changes.
  useEffect(() => {
    let alive = true
    setSource(null)
    if (!blob) return
    void loadSource(asset.id, blob)
      .then((entry) => {
        if (alive) setSource(entry)
      })
      .catch((err) => console.error('Source decode failed', err))
    return () => {
      alive = false
    }
  }, [asset.id, blob])

  // Measure the stage box for CSS fitting.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => {
      setBox({ w: el.clientWidth, h: el.clientHeight })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isWebGL(document.createElement('canvas'))) setFallback(false)
    else setFallback(true)
  }, [])

  // The effective document: compare bypasses everything.
  const effectiveDoc: EditDoc = useMemo(
    () => (bypass ? createDefaultEditDoc() : (doc ?? createDefaultEditDoc())),
    [doc, bypass],
  )
  const geometryOnly = cropMode !== null

  // Render loop, rAF-coalesced.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!source || !canvas) return
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      if (cancelled) return
      try {
        if (geometryOnly) {
          const plan = renderGeometryBase(source.preview, (doc ?? createDefaultEditDoc()).geometry, canvas, {
            maxSize: previewBudget(),
          })
          setOutDims({ w: plan.outW, h: plan.outH })
        } else {
          const result = renderEdit(source.preview, effectiveDoc, canvas, {
            maxSize: previewBudget(),
          })
          setOutDims({ w: result.plan.outW, h: result.plan.outH })
        }
        // Throttled histogram from a small readback
        const now = performance.now()
        const histCanvas = histRef.current
        if (!geometryOnly && !bypass && histCanvas && now - lastHistAt.current > 160) {
          lastHistAt.current = now
          const ctx = histCanvas.getContext('2d')
          if (ctx) {
            ctx.clearRect(0, 0, histCanvas.width, histCanvas.height)
            ctx.drawImage(canvas, 0, 0, histCanvas.width, histCanvas.height)
            const data = ctx.getImageData(0, 0, histCanvas.width, histCanvas.height)
            onHistogram?.(computeHistogram(data.data, 20000))
          }
        }
      } catch (err) {
        console.error('Render failed', err)
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [source, effectiveDoc, geometryOnly, bypass, doc, onHistogram])

  // Keyboard: ⌘Z undo, ⇧⌘Z redo, hold \ to compare.
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      const tag = el?.tagName ?? ''
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (key === '\\' && !e.metaKey && !e.ctrlKey) {
        setBypass(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === '\\') setBypass(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [undo, redo, setBypass])

  // CSS-fit the canvas in the stage (wrapper then aligns the crop overlay).
  const frameAspect = useMemo(() => {
    if (!source) return 1
    return source.preview.width / source.preview.height
  }, [source])

  const fit = useMemo(() => {
    if (outDims.w === 0 || box.w < 40 || box.h < 40) return { w: 0, h: 0 }
    const scale = Math.min(box.w / outDims.w, box.h / outDims.h, 1)
    return { w: Math.round(outDims.w * scale), h: Math.round(outDims.h * scale) }
  }, [outDims, box])

  const showFallbackNote = fallback === true
  const overlays = effectiveDoc.textOverlays ?? []

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full items-center justify-center p-2 sm:p-4">
      <div style={{ width: fit.w || undefined, height: fit.h || undefined }} className="relative">
        <canvas
          ref={canvasRef}
          width={outDims.w}
          height={outDims.h}
          style={{ width: '100%', height: '100%' }}
          className="block rounded-md bg-black shadow-2xl"
          aria-label={`Preview of ${asset.name}`}
        />
        {/* Text overlay layer: transparent 2D canvas above the graded frame.
            Pointer events are enabled only when overlays exist so crop/zoom
            gestures are never blocked. */}
        <OverlayLayer
          overlays={overlays}
          width={outDims.w}
          height={outDims.h}
          interactive={overlays.length > 0 && !geometryOnly && !bypass}
        />
        <canvas ref={histRef} width={160} height={120} className="hidden" aria-hidden />
        {frameAspect > 0 && geometryOnly ? <CropOverlay frameAspect={frameAspect} /> : null}
      </div>

      {/* Floating stage controls */}
      <div className="absolute bottom-2 right-2 z-30 flex items-center gap-1 sm:bottom-4 sm:right-4">
        {showFallbackNote ? (
          <Tooltip content="WebGL2 unavailable — using the Canvas 2D fallback. Sharpness, clarity, noise reduction and grain are approximate; geometry is exact.">
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
          onPointerDown={() => setBypass(true)}
          onPointerUp={() => setBypass(false)}
          onPointerLeave={() => setBypass(false)}
          className={cn('fs-tool-hit', bypass ? 'ring-1 ring-accent' : undefined)}
        >
          <Eye size={13} />
          {bypass ? 'Original' : 'Compare'}
        </Button>
        {onExport ? (
          <Button size="sm" variant="primary" onClick={onExport} aria-label="Export photo" className="fs-tool-hit">
            <Download size={13} />
            Export
          </Button>
        ) : null}
      </div>

      {!source ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-stage" role="status" aria-busy>
          <span className="text-xs text-lo">Decoding image…</span>
        </div>
      ) : null}
    </div>
  )
}

interface OverlayLayerProps {
  overlays: readonly PhotoTextOverlay[]
  width: number
  height: number
  interactive: boolean
}

/**
 * Transparent 2D canvas above the graded frame: renders text overlays with
 * the exact same pure routine the export uses, and lets the user drag a
 * layer to reposition it (one history entry per gesture).
 */
function OverlayLayer({ overlays, width, height, interactive }: OverlayLayerProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragId = useRef<string | null>(null)
  const setOverlayLive = usePhotoEditor((s) => s.setOverlayLive)
  const commit = usePhotoEditor((s) => s.commit)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < 2 || height < 2) return
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    drawPhotoOverlays(ctx, overlays, width, height)
  }, [overlays, width, height])

  const pick = (px: number, py: number): string | null => {
    // Hit-test topmost-first: a layer's box is its wrapped text block
    // approximated by an ellipse around the anchor point.
    for (let i = overlays.length - 1; i >= 0; i--) {
      const o = overlays[i]
      const fontSize = Math.max(9, height * 0.06 * o.scale)
      const rx = Math.max(fontSize * 1.6, width * 0.2 * o.scale)
      const ry = fontSize * (1.4 * 1.25)
      const dx = (px - o.x * width) / rx
      const dy = (py - o.y * height) / ry
      if (dx * dx + dy * dy <= 1) return o.id
    }
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%' }}
      className={cn(
        'absolute left-0 top-0 h-full w-full touch-none rounded-md',
        interactive ? 'cursor-move' : 'pointer-events-none',
      )}
      aria-label={overlays.length > 0 ? 'Text overlay layer' : undefined}
      onPointerDown={(e) => {
        if (!interactive) return
        const rect = e.currentTarget.getBoundingClientRect()
        const px = ((e.clientX - rect.left) / rect.width) * width
        const py = ((e.clientY - rect.top) / rect.height) * height
        const id = pick(px, py)
        dragId.current = id
        if (id) e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const id = dragId.current
        if (!id || !interactive) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.max(-0.1, Math.min(1.1, ((e.clientX - rect.left) / rect.width)))
        const y = Math.max(-0.1, Math.min(1.1, ((e.clientY - rect.top) / rect.height)))
        setOverlayLive(id, { x, y })
      }}
      onPointerUp={(e) => {
        if (dragId.current) {
          dragId.current = null
          commit('Move text')
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // pointer already released
        }
      }}
    />
  )
}
