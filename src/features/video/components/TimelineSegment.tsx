import { memo, useMemo, useRef, type ReactNode } from 'react'
import { Type } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../core/format'
import { useVideoEditor } from '../store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { TRANSITION_LABELS, type VideoClip } from '../sequenceModel'
import { ClipWaveform } from './ClipWaveform'
import { TransitionIcon } from './TransitionIcon'

interface SegmentProps {
  entry: { clip: VideoClip; globalStart: number; out: number; overlapAfter: number }
  index: number
  total: number
  selected: boolean
  /** Touch px-viewport mapping (null on desktop: fit-to-lane percentages). */
  mobile: { pxPerSec: number; viewStart: number } | null
  /** Per-clip audio fade lengths in seconds + whether they're live-draggable. */
  fade: { in: number; out: number; live: boolean }
  onFadeDown: (edge: 'in' | 'out', e: React.PointerEvent<HTMLDivElement>) => void
  onFadeMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onFadeUp: (e: React.PointerEvent<HTMLDivElement>) => void
  /** Drag-reorder hooks (sequence time under the pointer is passed in). */
  onGrab: (entry: SegmentProps['entry'], t: number) => void
  onDrag: (entry: SegmentProps['entry'], t: number) => void
  onRelease: (entry: SegmentProps['entry']) => void
}

/**
 * Draggable keyframe diamonds along the clip's top edge. Each diamond stands
 * for a time instant (across all tracks); dragging it retimes every key at
 * that instant. One history entry per gesture, via the store's phase API.
 */
const KeyframeDiamonds = memo(function KeyframeDiamonds({
  clip,
  out,
  mobile,
}: {
  clip: VideoClip
  out: number
  mobile: { pxPerSec: number } | null
}): ReactNode {
  const drag = useRef<{ from: number; last: number; startX: number; started: boolean; pps: number } | null>(null)
  // One diamond per time instant; keyed by a representative keyframe id so a
  // dragged diamond does NOT remount mid-gesture (remounting drops the
  // pointer capture and kills the drag).
  const groups = useMemo(() => {
    const map = new Map<number, string>()
    for (const track of [clip.keyframes?.scale, clip.keyframes?.x, clip.keyframes?.y, clip.keyframes?.opacity]) {
      for (const k of track ?? []) {
        const bucket = Math.round(k.t * 20) / 20
        if (!map.has(bucket)) map.set(bucket, k.id)
      }
    }
    return Array.from(map.entries())
      .map(([t, id]) => ({ t, id }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 24)
  }, [clip.keyframes])

  const onDown = (t: number, e: React.PointerEvent<HTMLSpanElement>): void => {
    e.stopPropagation()
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
    const parent = e.currentTarget.offsetParent as HTMLElement | null
    const rect = parent?.getBoundingClientRect()
    const pps = mobile?.pxPerSec ?? (rect && rect.width > 0 ? rect.width / Math.max(0.05, out) : 100)
    drag.current = { from: t, last: t, startX: e.clientX, started: false, pps }
  }
  const onMove = (e: React.PointerEvent<HTMLSpanElement>): void => {
    const d = drag.current
    if (!d || e.buttons === 0) return
    const t = Math.max(0, Math.min(out, d.from + (e.clientX - d.startX) / d.pps))
    if (Math.abs(t - d.last) < 0.05) return
    // Move relative to the last landed position — keys move away from `from`
    // on the first step, so every later step drags from there.
    const phase = d.started ? 'move' : 'start'
    d.started = true
    useVideoEditor.getState().moveClipKeyframe(clip.id, d.last, t, phase)
    d.last = t
  }
  const onUp = (e: React.PointerEvent<HTMLSpanElement>): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    useVideoEditor.getState().moveClipKeyframe(clip.id, d.last, d.last, 'end')
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
  }

  return (
    <div className="absolute inset-x-0 top-0 z-[7] h-3" aria-hidden={false}>
      {groups.map(({ t, id }) => (
        <span
          key={id}
          role="slider"
          aria-label={`Keyframe at ${t.toFixed(1)} seconds — drag to retime`}
          aria-valuemin={0}
          aria-valuemax={Math.round(out * 10) / 10}
          aria-valuenow={Math.round(t * 10) / 10}
          tabIndex={0}
          className="absolute top-0.5 h-2.5 w-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize touch-none rounded-[2px] bg-amber-300 transition-transform hover:scale-125"
          style={{ left: `${Math.min(100, Math.max(0, (t / Math.max(0.01, out)) * 100))}%` }}
          onPointerDown={(e) => onDown(t, e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      ))}
    </div>
  )
})

export const TimelineSegment = memo(function TimelineSegment({
  entry,
  index,
  total,
  selected,
  mobile,
  fade,
  onFadeDown,
  onFadeMove,
  onFadeUp,
  onGrab,
  onDrag,
  onRelease,
}: SegmentProps): ReactNode {
  const assetId = entry.clip.assetId
  const asset = useAssets()?.find((a) => a.id === assetId)
  const thumb = useThumbnail(asset)
  const left = mobile ? (entry.globalStart - mobile.viewStart) * mobile.pxPerSec : (entry.globalStart / total) * 100
  const width = mobile ? entry.out * mobile.pxPerSec : (entry.out / total) * 100
  const transition = entry.clip.transition

  /** Sequence-time under the pointer (same mapping the scrub lane uses). */
  const pointerTime = (e: { target: EventTarget | null; clientX: number }): number => {
    const track = (e.target as HTMLElement)?.closest('[data-sequence-track]')
    if (!track) return entry.globalStart
    const rect = track.getBoundingClientRect()
    if (mobile) return mobile.viewStart + (e.clientX - rect.left) / mobile.pxPerSec
    return ((e.clientX - rect.left) / Math.max(1, rect.width)) * total
  }

  return (
    <div
      className={cn(
        'absolute inset-y-1 z-10 overflow-hidden rounded border',
        selected ? 'border-accent ring-1 ring-accent' : 'border-line',
        'bg-panel/85',
        'cursor-grab touch-none',
      )}
      style={{
        left: mobile ? left : `${left}%`,
        width: Math.max(mobile ? 3 : 0.4, width) + (mobile ? 'px' : '%'),
        zIndex: 10 + index,
      }}
      aria-label={`Clip ${index + 1}${selected ? ' (selected)' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        // Let the track's own pointerdown own trimming when grabbing the
        // selected clip's edges (it measures HANDLE_GRAB_PX proximity).
        if (selected) {
          const track = (e.target as HTMLElement)?.closest('[data-sequence-track]')
          const rect = track?.getBoundingClientRect()
          if (rect) {
            const leftPx = (entry.globalStart / total) * rect.width
            const rightPx = ((entry.globalStart + entry.out) / total) * rect.width
            const at = e.clientX - rect.left
            if (Math.abs(at - leftPx) <= 10 || Math.abs(at - rightPx) <= 10) return
          }
        }
        e.stopPropagation()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // synthetic or already-released pointers
        }
        onGrab(entry, pointerTime(e))
      }}
      onPointerMove={(e) => {
        // While a segment drag is captured here, bubbling would let the track
        // treat the moves as a scrub — swallow them.
        e.stopPropagation()
        onDrag(entry, pointerTime(e))
      }}
      onPointerUp={(e) => {
        onRelease(entry)
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // synthetic or already-released pointers
        }
      }}
    >
      {thumb ? (
        <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" aria-hidden />
      ) : null}
      <div className="absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/55 to-transparent" aria-hidden />
      <ClipWaveform asset={asset} />
      {/* Audio fade visualization: gradient along the bottom edge + drag
          handles on the selected clip (drag horizontally to change length). */}
      {fade.in > 0 ? (
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-4"
          style={{ width: `${Math.min(100, (fade.in / Math.max(0.01, entry.out)) * 100)}%`, background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.55) 100%)' }}
          aria-hidden
        />
      ) : null}
      {fade.out > 0 ? (
        <div
          className="pointer-events-none absolute bottom-0 right-0 h-4"
          style={{ width: `${Math.min(100, (fade.out / Math.max(0.01, entry.out)) * 100)}%`, background: 'linear-gradient(to left, transparent 0%, rgba(255,255,255,0.55) 100%)' }}
          aria-hidden
        />
      ) : null}
      {fade.live ? (
        <>
          <div
            className="fs-fade-handle absolute bottom-0 left-0 z-10 flex h-4 w-4 cursor-ew-resize touch-none items-end justify-start rounded-sm"
            role="slider"
            aria-label={`Audio fade in: ${fade.in.toFixed(1)} seconds`}
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={Math.round(fade.in * 10) / 10}
            onPointerDown={(e) => onFadeDown('in', e)}
            onPointerMove={onFadeMove}
            onPointerUp={onFadeUp}
            onPointerCancel={onFadeUp}
          >
            <span className="mb-0.5 ml-0.5 h-2.5 w-0.5 rounded-full bg-accent" aria-hidden />
          </div>
          <div
            className="fs-fade-handle absolute bottom-0 right-0 z-10 flex h-4 w-4 cursor-ew-resize touch-none items-end justify-end rounded-sm"
            role="slider"
            aria-label={`Audio fade out: ${fade.out.toFixed(1)} seconds`}
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={Math.round(fade.out * 10) / 10}
            onPointerDown={(e) => onFadeDown('out', e)}
            onPointerMove={onFadeMove}
            onPointerUp={onFadeUp}
            onPointerCancel={onFadeUp}
          >
            <span className="mb-0.5 mr-0.5 h-2.5 w-0.5 rounded-full bg-accent" aria-hidden />
          </div>
        </>
      ) : null}
      {/* Keyframe diamonds: position marks along the clip's top. On the
          selected clip they're draggable — move a diamond to retime every
          key at that instant (one history entry per gesture). */}
      {selected && entry.clip.keyframes ? (
        <KeyframeDiamonds clip={entry.clip} out={entry.out} mobile={mobile} />
      ) : null}
      <div className="absolute inset-x-1 top-0.5 z-40 flex items-center gap-1 rounded bg-black/35 px-1">
        <span className="hidden truncate text-[10px] font-medium text-hi sm:inline" aria-hidden>
          {asset?.name ?? `Clip ${index + 1}`}
        </span>
        <span className="truncate text-[10px] font-medium text-hi sm:hidden" aria-hidden>
          {`Clip ${index + 1}`}
        </span>
        {entry.clip.title ? <Type size={9} className="shrink-0 text-hi/80" aria-hidden /> : null}
        <span className="ml-auto shrink-0 text-[9px] tabular-nums text-hi/70" aria-hidden>
          {formatDuration(entry.out)}
        </span>
      </div>
      {transition !== 'cut' ? (
        <div
          className="absolute bottom-0.5 left-1 flex items-center gap-0.5 rounded-sm bg-black/60 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-hi/80"
          aria-label={`${TRANSITION_LABELS[transition]} (${entry.clip.transitionDuration.toFixed(1)}s)`}
        >
          <TransitionIcon type={transition} />
          <span className="hidden sm:inline">{TRANSITION_LABELS[transition]}</span>
        </div>
      ) : null}
      {/* Trim handles (selected only) */}
      {selected ? (
        <>
          <div className="fs-trim-handle absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize items-center justify-start" aria-label="Trim clip start">
            <div className="h-4 w-1 rounded-full bg-accent" />
          </div>
          <div className="fs-trim-handle absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize items-center justify-end" aria-label="Trim clip end">
            <div className="h-4 w-1 rounded-full bg-accent" />
          </div>
        </>
      ) : null}
    </div>
  )
})
