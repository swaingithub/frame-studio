import { useCallback, useRef, type ReactNode } from 'react'
import { Volume2, VolumeX, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { MIN_OVERLAY_OUT, type OverlayClip } from '../sequenceModel'

/**
 * One overlay track lane: a scrub bar holding one or more layer blocks.
 * The base-track overlays render in a single text lane; each media layer
 * gets its own lane — real stacked video/image tracks (CapCut-style).
 * On touch devices all rows share one pan/zoom viewport (fixed center
 * playhead in the parent), so positions map through px-per-second.
 */

export interface OverlayLaneRowProps {
  laneLabel: string
  overlays: readonly OverlayClip[]
  total: number
  currentTime: number
  onSeek: (t: number) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onTiming: (id: string, start: number, duration: number) => void
  onToggleMute?: (id: string) => void
  /** Z-order: move a layer earlier/later in the overlay stack. */
  onMoveOverlay?: (id: string, dir: -1 | 1) => void
  /** Touch px-viewport mapping shared with the base track (null = desktop). */
  mobile?: { pxPerSec: number; viewStart: number } | null
  /** Shared pan/pinch gesture handlers (touch only). */
  onPanDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPanMove?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPanUp?: (e: React.PointerEvent<HTMLDivElement>) => void
  /** Optional thumbnail element for a media layer's chip. */
  chipThumb?: (o: OverlayClip) => ReactNode
}

export function OverlayLaneRow({
  laneLabel,
  overlays,
  total,
  currentTime,
  onSeek,
  selectedId,
  onSelect,
  onRemove,
  onTiming,
  onToggleMute,
  onMoveOverlay,
  mobile = null,
  onPanDown,
  onPanMove,
  onPanUp,
  chipThumb,
}: OverlayLaneRowProps): ReactNode {
  const laneRef = useRef<HTMLDivElement>(null)
  const ovDrag = useRef<{ id: string; mode: 'move' | 'start' | 'end'; startX: number; grabOffset: number; origStart: number; origDur: number; moved: boolean } | null>(null)

  const laneTime = useCallback(
    (clientX: number): number => {
      const el = laneRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      if (mobile && mobile.pxPerSec > 0) return mobile.viewStart + (clientX - rect.left) / mobile.pxPerSec
      if (total <= 0) return 0
      return Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * total)
    },
    [mobile, total],
  )

  const snapTime = useCallback(
    (t: number): number => {
      if (Math.abs(t - currentTime) < 0.18) return currentTime > 0 ? currentTime : 0
      if (Math.abs(t) < 0.18) return 0
      return Math.round(t * 20) / 20
    },
    [currentTime],
  )

  return (
    <div
      ref={laneRef}
      className="relative h-6 min-w-0 touch-none select-none overflow-hidden rounded-md bg-elevated/60"
      role="slider"
      aria-label={`${laneLabel} playhead`}
      aria-valuemin={0}
      aria-valuemax={Math.round(total * 100) / 100}
      aria-valuenow={Math.round(Math.min(currentTime, total) * 10) / 10}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (onPanDown) {
          // Touch: pan the shared viewport (seek follows the center playhead).
          onSelect('')
          onPanDown(e)
          return
        }
        onSelect('')
        onSeek(laneTime(e.clientX))
      }}
      onPointerMove={(e) => {
        if (onPanMove && mobile) onPanMove(e)
      }}
      onPointerUp={(e) => {
        if (onPanUp && mobile) onPanUp(e)
      }}
      onPointerCancel={(e) => {
        if (onPanUp && mobile) onPanUp(e)
      }}
      aria-orientation="horizontal"
    >
      {overlays.map((o, index) => {
        const selected = o.id === selectedId
        return (
          <div
            key={o.id}
            className={cn(
              'group absolute inset-y-0 z-10 flex items-center gap-1 overflow-hidden rounded border px-1.5',
              selected ? 'border-accent ring-1 ring-accent bg-accent/20' : 'border-line bg-panel/85',
              'cursor-move',
            )}
            style={{
              left: mobile ? (o.start - mobile.viewStart) * mobile.pxPerSec : `${(o.start / total) * 100}%`,
              width: mobile
                ? `${Math.max(3, o.duration * mobile.pxPerSec)}px`
                : `${Math.max(0.8, (o.duration / total) * 100)}%`,
              zIndex: 10 + index,
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // synthetic or already-released pointers
              }
              onSelect(o.id)
              ovDrag.current = {
                id: o.id,
                mode: 'move',
                startX: e.clientX,
                grabOffset: laneTime(e.clientX) - o.start,
                origStart: o.start,
                origDur: o.duration,
                moved: false,
              }
            }}
            onPointerMove={(e) => {
              const d = ovDrag.current
              if (!d || d.id !== o.id) return
              if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return
              d.moved = true
              const t = laneTime(e.clientX)
              if (d.mode === 'move') {
                onTiming(o.id, snapTime(Math.max(0, t - d.grabOffset)), d.origDur)
              } else if (d.mode === 'end') {
                onTiming(o.id, d.origStart, Math.max(MIN_OVERLAY_OUT, snapTime(t - d.origStart)))
              } else {
                const end = d.origStart + d.origDur
                const newStart = Math.max(0, Math.min(snapTime(t), end - MIN_OVERLAY_OUT))
                onTiming(o.id, newStart, end - newStart)
              }
            }}
            onPointerUp={(e) => {
              const d = ovDrag.current
              ovDrag.current = null
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                // synthetic or already-released pointers
              }
              if (!d || !d.moved) onSeek(Math.min(Math.max(o.start, currentTime), o.start + o.duration))
            }}
            role="button"
            aria-label={`Layer: ${o.kind === 'text' ? o.text : o.kind}${selected ? ' (selected)' : ''}`}
            title={o.kind === 'text' ? o.text : o.kind}
          >
            {/* Edge handles: drag to trim the layer's window */}
            <span
              data-overlay-handle="start"
              className="fs-trim-handle absolute inset-y-0 left-0 w-1.5 cursor-ew-resize touch-none bg-white/0 group-hover:bg-white/30"
              aria-hidden
              onPointerDown={(e) => {
                e.stopPropagation()
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  // ignore — segment handlers still see moves via bubbling
                }
                onSelect(o.id)
                ovDrag.current = { id: o.id, mode: 'start', startX: e.clientX, grabOffset: 0, origStart: o.start, origDur: o.duration, moved: false }
              }}
            />
            <span
              data-overlay-handle="end"
              className="fs-trim-handle absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none bg-white/0 group-hover:bg-white/30"
              aria-hidden
              onPointerDown={(e) => {
                e.stopPropagation()
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  // ignore — segment handlers still see moves via bubbling
                }
                onSelect(o.id)
                ovDrag.current = { id: o.id, mode: 'end', startX: e.clientX, grabOffset: 0, origStart: o.start, origDur: o.duration, moved: false }
              }}
            />
            {chipThumb ? chipThumb(o) : null}
            <span className="truncate text-[9px] font-medium text-hi" aria-hidden>
              {o.kind === 'text' ? o.text : o.kind === 'video' ? '▶ Video' : '🖼 Image'}
            </span>
            {o.kind === 'video' && onToggleMute ? (
              <button
                type="button"
                className="absolute right-0.5 top-0 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-black/60 text-hi/90 hover:bg-black/80"
                aria-label={o.muted ? 'Unmute layer audio' : 'Mute layer audio'}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onToggleMute(o.id)
                }}
              >
                {o.muted ? <VolumeX size={8} /> : <Volume2 size={8} />}
              </button>
            ) : null}
            {onMoveOverlay ? (
              <>
                <button
                  type="button"
                  className={cn(
                    'absolute right-3.5 top-0 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-black/60 text-hi/90 hover:bg-black/80',
                    o.kind === 'video' && onToggleMute ? 'top-4' : 'top-0',
                  )}
                  aria-label="Bring layer forward"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onMoveOverlay(o.id, 1)
                  }}
                >
                  <ArrowUp size={8} />
                </button>
                <button
                  type="button"
                  className={cn(
                    'absolute right-7 top-0 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-black/60 text-hi/90 hover:bg-black/80',
                    o.kind === 'video' && onToggleMute ? 'top-4' : 'top-0',
                  )}
                  aria-label="Send layer backward"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onMoveOverlay(o.id, -1)
                  }}
                >
                  <ArrowDown size={8} />
                </button>
              </>
            ) : null}
            {selected ? (
              <button
                type="button"
                className={cn(
                  'absolute right-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-black/60 text-hi/90 hover:bg-black/80',
                  o.kind === 'video' && onToggleMute ? 'top-4' : 'top-0',
                )}
                aria-label="Delete overlay"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onRemove(o.id)
                }}
              >
                <Trash2 size={8} />
              </button>
            ) : null}
          </div>
        )
      })}
      {/* Playhead (desktop; touch uses the parent's shared fixed center one) */}
      {!mobile ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-white/90"
          style={{ left: `${(Math.min(currentTime, total) / total) * 100}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}
