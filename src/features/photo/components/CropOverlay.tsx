import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { usePhotoEditor } from '../store'
import { Button } from '../../../ui/button'
import { cn } from '../../../lib/cn'

/**
 * Interactive crop overlay over the geometry-only backdrop.
 * Move the rectangle, resize with the 8 handles, optional aspect lock.
 * All coordinates are normalized (0..1) in backdrop-frame space, so the
 * aspect multiplier between normalized and pixel space is 1 (the backdrop
 * canvas matches the frame exactly).
 */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Dir = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragState {
  dir: Dir
  startX: number
  startY: number
  start: Rect
  aspect: number | null
}

const MIN = 0.05

const HANDLES: Array<{ dir: Dir; cursor: string; style: CSSProperties }> = [
  { dir: 'nw', cursor: 'nwse-resize', style: { left: '0%', top: '0%' } },
  { dir: 'n', cursor: 'ns-resize', style: { left: '50%', top: '0%' } },
  { dir: 'ne', cursor: 'nesw-resize', style: { left: '100%', top: '0%' } },
  { dir: 'e', cursor: 'ew-resize', style: { left: '100%', top: '50%' } },
  { dir: 'se', cursor: 'nwse-resize', style: { left: '100%', top: '100%' } },
  { dir: 's', cursor: 'ns-resize', style: { left: '50%', top: '100%' } },
  { dir: 'sw', cursor: 'nesw-resize', style: { left: '0%', top: '100%' } },
  { dir: 'w', cursor: 'ew-resize', style: { left: '0%', top: '50%' } },
]

const ASPECTS: Array<{ label: string; ratio: number | null; kind: 'ratio' | 'frame' }> = [
  { label: 'Free', ratio: null, kind: 'ratio' },
  { label: 'Frame', ratio: 0, kind: 'frame' },
  { label: '1:1', ratio: 1, kind: 'ratio' },
  { label: '4:3', ratio: 4 / 3, kind: 'ratio' },
  { label: '3:4', ratio: 3 / 4, kind: 'ratio' },
  { label: '3:2', ratio: 3 / 2, kind: 'ratio' },
  { label: '2:3', ratio: 2 / 3, kind: 'ratio' },
  { label: '16:9', ratio: 16 / 9, kind: 'ratio' },
  { label: '9:16', ratio: 9 / 16, kind: 'ratio' },
]

export function CropOverlay({ frameAspect }: { frameAspect: number }): ReactNode {
  const crop = usePhotoEditor((s) => s.crop)
  const setCropDraft = usePhotoEditor((s) => s.setCropDraft)
  const setCropAspect = usePhotoEditor((s) => s.setCropAspect)
  const applyCrop = usePhotoEditor((s) => s.applyCrop)
  const cancelCrop = usePhotoEditor((s) => s.cancelCrop)

  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [aspectLabel, setAspectLabel] = useState('Free')

  if (!crop) return null
  const rect = crop.draft
  const aspectLock = crop.aspect

  function pickAspect(label: string, ratio: number | null, kind: 'ratio' | 'frame'): void {
    const value = kind === 'frame' ? frameAspect : ratio
    setAspectLabel(label)
    setCropAspect(value)
  }

  function beginDrag(dir: Dir, e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...rect },
      aspect: aspectLock,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stopDrag, { once: true })
  }

  const commitTweak = (r: Rect): void => {
    if (dragRef.current) setCropDraft({ x: clamp01(r.x), y: clamp01(r.y), w: clamp01(r.w), h: clamp01(r.h) })
  }

  function onMove(e: PointerEvent): void {
    const d = dragRef.current
    const box = boxRef.current?.getBoundingClientRect()
    if (!d || !box) return
    const dx = (e.clientX - d.startX) / Math.max(1, box.width)
    const dy = (e.clientY - d.startY) / Math.max(1, box.height)
    const s = d.start
    const aspect = d.aspect

    if (d.dir === 'move') {
      const nx = clamp01(s.x + dx)
      const ny = clamp01(s.y + dy)
      const x = Math.min(nx, 1 - s.w)
      const y = Math.min(ny, 1 - s.h)
      commitTweak({ x, y, w: s.w, h: s.h })
      return
    }

    // --- resize ---
    let x = s.x
    let y = s.y
    let w = s.w
    let h = s.h
    const hasN = d.dir.includes('n') && d.dir !== 'e' && d.dir !== 'w'
    const hasS = d.dir.includes('s')
    const hasW = d.dir.includes('w') && d.dir !== 'n' && d.dir !== 's'
    const hasE = d.dir.includes('e')
    const horizontal = hasW || hasE
    const vertical = hasN || hasS

    if (hasW) {
      const left = clamp(s.x + dx, 0, s.x + s.w - MIN)
      w = s.x + s.w - left
      x = left
    }
    if (hasE) {
      const right = clamp(s.x + s.w + dx, s.x + MIN, 1)
      x = s.x
      w = right - s.x
    }
    if (hasN) {
      const top = clamp(s.y + dy, 0, s.y + s.h - MIN)
      h = s.y + s.h - top
      y = top
    }
    if (hasS) {
      const bottom = clamp(s.y + s.h + dy, s.y + MIN, 1)
      y = s.y
      h = bottom - s.y
    }

    // Aspect lock
    if (aspect !== null && aspect > 0) {
      if (vertical && horizontal) {
        // corner: pick the edited axis as primary, derive the other from the
        // anchor (opposite corner), then clamp inside bounds.
        const anchorX = hasW ? s.x + s.w : s.x
        const anchorY = hasN ? s.y + s.h : s.y
        if (horizontal) {
          const mw = aspect * h
          if (mw < MIN) return
          const mw2 = Math.min(mw, hasW ? anchorX : 1 - anchorX)
          const mh2 = mw2 / aspect
          if (mh2 < MIN) return
          x = hasW ? anchorX - mw2 : anchorX
          w = mw2
          y = hasN ? anchorY - mh2 : anchorY
          h = mh2
        } else {
          const mh = w / aspect
          if (mh < MIN) return
          const mh2 = Math.min(mh, hasN ? anchorY : 1 - anchorY)
          const mw2 = mh2 * aspect
          if (mw2 < MIN) return
          y = hasN ? anchorY - mh2 : anchorY
          h = mh2
          x = hasW ? anchorX - mw2 : anchorX
          w = mw2
        }
      } else if (vertical && !horizontal) {
        // edge: keep horizontal center, derive width from aspect
        const cx = s.x + s.w / 2
        const mw = aspect * h
        if (mw < MIN) return
        const mw2 = Math.min(mw, Math.min(1, Math.min(cx, 1 - cx) * 2))
        x = cx - mw2 / 2
        w = mw2
      } else if (horizontal && !vertical) {
        const cy = s.y + s.h / 2
        const mh = w / aspect
        if (mh < MIN) return
        const mh2 = Math.min(mh, Math.min(1, Math.min(cy, 1 - cy) * 2))
        y = cy - mh2 / 2
        h = mh2
      }
      // final safety clamps
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      if (w / h > aspect * 1.001) w = h * aspect
      if (h / w > 1 / (aspect * 0.999)) h = w / aspect
    }

    commitTweak({ x, y, w, h })
  }

  function stopDrag(): void {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
  }

  const asPercent = (n: number): string => `${(Math.max(0, n) * 100).toFixed(3)}%`

  return (
    <>
      {/* Scrim with the crop cut out (giant box-shadow = classic cutout) */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        aria-hidden
      >
        <div
          className="absolute"
          style={{
            left: asPercent(rect.x),
            top: asPercent(rect.y),
            width: asPercent(rect.w),
            height: asPercent(rect.h),
            boxShadow: '0 0 0 10000px rgba(0,0,0,0.55)',
          }}
        />
      </div>

      {/* Crop rect + handles + rules-of-thirds */}
      <div
        className="absolute z-20 cursor-move"
        role="application"
        aria-label="Crop area"
        style={{
          left: asPercent(rect.x),
          top: asPercent(rect.y),
          width: asPercent(rect.w),
          height: asPercent(rect.h),
        }}
        onPointerDown={(e) => beginDrag('move', e)}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={cn('border-black/30', i % 3 === 1 && 'border-x', Math.floor(i / 3) === 1 && 'border-y')} />
          ))}
        </div>

        {HANDLES.map((h) => (
          <div
            key={h.dir}
            role="button"
            aria-label={`Handle ${h.dir}`}
            onPointerDown={(e) => beginDrag(h.dir, e)}
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-sm border border-white bg-white/20 backdrop-blur-[1px] transition-colors hover:bg-accent"
            style={{ ...h.style, cursor: h.cursor }}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-panel/95 p-1.5 shadow-xl backdrop-blur">
        <select
          value={aspectLabel}
          onChange={(e) => {
            const entry = ASPECTS.find((a) => a.label === e.target.value)
            if (!entry) return
            pickAspect(entry.label, entry.ratio, entry.kind)
          }}
          aria-label="Aspect ratio"
          className="h-7 rounded-md border border-line bg-elevated px-2 text-xs text-hi outline-none"
        >
          {ASPECTS.map((a) => (
            <option key={a.label} value={a.label}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="px-1 text-[10px] tabular-nums text-lo">
          {Math.round(rect.w * 1000) / 10}% × {Math.round(rect.h * 1000) / 10}%
        </span>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={cancelCrop} aria-label="Cancel crop">
          <X size={13} />
        </Button>
        <Button size="sm" variant="primary" onClick={applyCrop} aria-label="Apply crop">
          <Check size={13} />
          Apply
        </Button>
      </div>
    </>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}
