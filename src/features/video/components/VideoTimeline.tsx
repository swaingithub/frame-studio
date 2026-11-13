import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Copy, Scissors, Square, Sun, Trash2, Blend, Type, Move, Circle, ZoomIn, Droplets } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../core/format'
import { useVideoEditor, layoutOf } from '../store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { MIN_OVERLAY_OUT, TRANSITION_LABELS, type VideoClip, type VideoTransition } from '../sequenceModel'
import { Tooltip } from '../../../ui/tooltip'

/**
 * The sequence timeline: each clip is a proportional segment (trimmed length
 * at its speed) laid the way playback flows — dissolve overlaps shrink the
 * total. Drag anywhere to scrub; drag the selected clip's edges to trim it;
 * the toolbar splits/moves/duplicates/deletes the selection.
 */

const HANDLE_GRAB_PX =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 18 : 10
const MIN_TRIM_SRC = 0.1

export function VideoTimeline({ onSeek }: { onSeek: (t: number) => void }): ReactNode {
  const clips = useVideoEditor((s) => s.sequence)
  const overlays = useVideoEditor((s) => s.overlays)
  const activeOverlayId = useVideoEditor((s) => s.activeOverlayId)
  const setActiveOverlay = useVideoEditor((s) => s.setActiveOverlay)
  const removeOverlay = useVideoEditor((s) => s.removeOverlay)
  const setOverlayTiming = useVideoEditor((s) => s.setOverlayTiming)
  const durations = useVideoEditor((s) => s.durations)
  const activeClipId = useVideoEditor((s) => s.activeClipId)
  const currentTime = useVideoEditor((s) => s.currentTime)
  const setTrimLive = useVideoEditor((s) => s.setTrimLive)
  const commitTrim = useVideoEditor((s) => s.commitTrim)
  const splitAtPlayhead = useVideoEditor((s) => s.splitAtPlayhead)
  const moveClip = useVideoEditor((s) => s.moveClip)
  const duplicateClip = useVideoEditor((s) => s.duplicateClip)
  const removeClip = useVideoEditor((s) => s.removeClip)
  const setActiveClip = useVideoEditor((s) => s.setActiveClip)
  const reorderClip = useVideoEditor((s) => s.reorderClip)
  const assets = useAssets()

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])
  const total = Math.max(0.0001, layout.total)
  const trackRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const dragMode = useRef<'scrub' | 'start' | 'end'>('scrub')
  // Overlay block drag: move / trims committed continuously, one undo per gesture.
  const ovDrag = useRef<{ id: string; mode: 'move' | 'start' | 'end'; startX: number; grabOffset: number; origStart: number; origDur: number; moved: boolean } | null>(null)
  // Clip drag-reorder on the base track (grab the block and move it).
  const segDrag = useRef<{ id: string; grabOffset: number; mids: { id: string; mid: number }[]; moved: boolean; lastTo: number } | null>(null)

  const onSegmentGrab = useCallback(
    (entry: { clip: VideoClip; globalStart: number; out: number }, t: number): void => {
      setActiveClip(entry.clip.id)
      segDrag.current = {
        id: entry.clip.id,
        grabOffset: (entry.globalStart + entry.out / 2) - t,
        // Insertion slot is measured against the layout frozen at grab time.
        mids: layout.entries
          .filter((en) => en.clip.id !== entry.clip.id)
          .map((en) => ({ id: en.clip.id, mid: en.globalStart + en.out / 2 })),
        moved: false,
        lastTo: layout.entries.findIndex((en) => en.clip.id === entry.clip.id),
      }
    },
    [layout.entries, setActiveClip],
  )

  const onSegmentDrag = useCallback(
    (entry: { clip: VideoClip; globalStart: number; out: number }, t: number): void => {
      const d = segDrag.current
      if (!d || d.id !== entry.clip.id) return
      if (!d.moved && Math.abs(t + d.grabOffset - (entry.globalStart + entry.out / 2)) < total * 0.01) return
      d.moved = true
      // Insert before the first frozen midpoint right of the dragged center.
      const center = t + d.grabOffset
      const to = d.mids.filter((m) => m.mid < center).length
      if (to !== d.lastTo) {
        d.lastTo = to
        reorderClip(d.id, to)
      }
    },
    [reorderClip, total],
  )

  const onSegmentRelease = useCallback(
    (entry: { clip: VideoClip; globalStart: number; out: number }): void => {
      const d = segDrag.current
      segDrag.current = null
      if (d && d.id === entry.clip.id && !d.moved) setActiveClip(entry.clip.id)
    },
    [setActiveClip],
  )

  const laneTime = useCallback(
    (clientX: number): number => {
      const el = laneRef.current
      if (!el || total <= 0) return 0
      const rect = el.getBoundingClientRect()
      return Math.max(0, ((clientX - rect.left) / Math.max(1, rect.width)) * total)
    },
    [total],
  )

  const snapTime = useCallback(
    (t: number): number => {
      // Magnetic targets: the playhead and the sequence start.
      if (Math.abs(t - currentTime) < 0.18) return currentTime > 0 ? currentTime : 0
      if (Math.abs(t) < 0.18) return 0
      return Math.round(t * 20) / 20
    },
    [currentTime],
  )

  const timeAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * total
    },
    [total],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const el = trackRef.current
      if (!el || e.button !== 0) return
      const rect = el.getBoundingClientRect()
      const t = timeAt(e.clientX)
      // Selected clip's edges trim; anything else scrubs.
      const index = layout.entries.findIndex((entry) => entry.clip.id === activeClipId)
      if (index >= 0) {
        const entry = layout.entries[index]
        const leftPx = (entry.globalStart / total) * rect.width
        const rightPx = ((entry.globalStart + entry.out) / total) * rect.width
        if (Math.abs(e.clientX - rect.left - leftPx) <= HANDLE_GRAB_PX) dragMode.current = 'start'
        else if (Math.abs(e.clientX - rect.left - rightPx) <= HANDLE_GRAB_PX) dragMode.current = 'end'
        else dragMode.current = 'scrub'
      } else {
        dragMode.current = 'scrub'
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
      if (dragMode.current === 'scrub') onSeek(t)
    },
    [activeClipId, layout.entries, onSeek, timeAt, total],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      // No pressed pointer = hover over the track; scrubbing requires a gesture.
      if (e.buttons === 0) return
      const el = trackRef.current
      if (!el) return
      const mode = dragMode.current
      if (mode === 'scrub') {
        onSeek(timeAt(e.clientX))
        return
      }
      const index = layout.entries.findIndex((entry) => entry.clip.id === activeClipId)
      if (index < 0) return
      const entry = layout.entries[index]
      const clip = entry.clip
      const speed = clip.edit.speed > 0 ? clip.edit.speed : 1
      const found = assets?.find((a) => a.id === clip.assetId)
      const assetDuration = Math.max(0, found?.duration ?? durations[clip.assetId] ?? 0)
      const currentEnd = clip.edit.trimEnd ?? assetDuration
      const t = timeAt(e.clientX)
      if (mode === 'start') {
        // Anchor the right edge: source time counted back from the right edge.
        const rightGlobal = entry.globalStart + entry.out
        const src = currentEnd - Math.max(0, rightGlobal - t) * speed
        const clamped = Math.max(0, Math.min(src, currentEnd - MIN_TRIM_SRC))
        setTrimLive(clamped, currentEnd)
      } else {
        const src = clip.edit.trimStart + Math.max(0, t - entry.globalStart) * speed
        const clamped = Math.min(assetDuration > 0 ? assetDuration : src + MIN_TRIM_SRC, Math.max(src, clip.edit.trimStart + MIN_TRIM_SRC))
        setTrimLive(clip.edit.trimStart, clamped)
      }
    },
    [activeClipId, assets, durations, layout.entries, onSeek, setTrimLive, timeAt],
  )

  const finish = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const el = trackRef.current
      if (!el) return
      if (dragMode.current !== 'scrub') commitTrim()
      dragMode.current = 'scrub'
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
    },
    [commitTrim],
  )

  if (clips.length === 0) {
    return (
      <div
        className="flex h-16 min-w-0 flex-1 items-center justify-center rounded-md bg-elevated text-xs text-lo"
        role="status"
      >
        Empty timeline — add clips from the library above.
      </div>
    )
  }

  const canOperate = activeClipId !== null

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {/* Clip operations toolbar */}
      <div className="flex items-center gap-1">
        <Tooltip content="Split the selected clip at the playhead (Scissors)">
          <button type="button" onClick={splitAtPlayhead} disabled={!canOperate} className={toolBtn} aria-label="Split clip at playhead">
            <Scissors size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Move clip earlier">
          <button type="button" onClick={() => activeClipId && moveClip(activeClipId, -1)} disabled={!canOperate} className={toolBtn} aria-label="Move clip earlier">
            <ArrowLeft size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Move clip later">
          <button type="button" onClick={() => activeClipId && moveClip(activeClipId, 1)} disabled={!canOperate} className={toolBtn} aria-label="Move clip later">
            <ArrowRight size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Duplicate clip">
          <button type="button" onClick={() => activeClipId && duplicateClip(activeClipId)} disabled={!canOperate} className={toolBtn} aria-label="Duplicate clip">
            <Copy size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Delete clip">
          <button type="button" onClick={() => activeClipId && removeClip(activeClipId)} disabled={!canOperate} className={cn(toolBtn, 'text-danger')} aria-label="Delete clip">
            <Trash2 size={12} />
          </button>
        </Tooltip>
        <span className="ml-auto pr-1 text-[10px] tabular-nums text-lo" aria-hidden>
          {formatDuration(total)}
        </span>
      </div>

      {/* The track */}
      <div
        ref={trackRef}
        data-sequence-track
        className="relative h-14 min-w-0 touch-none select-none rounded-md bg-elevated outline-none focus-visible:ring-2 focus-visible:ring-accent"
        role="slider"
        aria-label="Sequence playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 100) / 100}
        aria-valuenow={Math.round(Math.min(currentTime, total) * 10) / 10}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {layout.entries.map((entry, index) => (
          <TimelineSegment
            key={entry.clip.id}
            entry={entry}
            index={index}
            total={total}
            selected={entry.clip.id === activeClipId}
            onGrab={onSegmentGrab}
            onDrag={onSegmentDrag}
            onRelease={onSegmentRelease}
          />
        ))}
        {/* Beat grid (from the music track's local analysis). */}
        <BeatMarkers total={total} />
        {/* Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-white/90"
          style={{ left: `${(Math.min(currentTime, total) / total) * 100}%` }}
          aria-hidden
        />
      </div>

      {/* Overlay lane: layers above the base track (same time scale). */}
      {overlays.length > 0 ? (
        <div
          ref={laneRef}
          className="relative h-6 min-w-0 touch-none select-none rounded-md bg-elevated/60"
          role="slider"
          aria-label="Overlay layers playhead"
          aria-valuemin={0}
          aria-valuemax={Math.round(total * 100) / 100}
          aria-valuenow={Math.round(Math.min(currentTime, total) * 10) / 10}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            setActiveOverlay(null)
            onSeek(timeAt(e.clientX))
          }}
          aria-orientation="horizontal"
        >
          {overlays.map((o, index) => {
            const selected = o.id === activeOverlayId
            return (
              <div
                key={o.id}
                className={cn(
                  'group absolute inset-y-0 z-10 flex items-center gap-1 overflow-hidden rounded border px-1.5',
                  selected ? 'border-accent ring-1 ring-accent bg-accent/20' : 'border-line bg-panel/85',
                  'cursor-move',
                )}
                style={{
                  left: `${(o.start / total) * 100}%`,
                  width: `${Math.max(0.8, (o.duration / total) * 100)}%`,
                  zIndex: 10 + index,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId)
                  } catch {
                    // synthetic or already-released pointers
                  }
                  setActiveOverlay(o.id)
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
                    setOverlayTiming(o.id, snapTime(Math.max(0, t - d.grabOffset)), d.origDur)
                  } else if (d.mode === 'end') {
                    setOverlayTiming(o.id, d.origStart, Math.max(MIN_OVERLAY_OUT, snapTime(t - d.origStart)))
                  } else {
                    const end = d.origStart + d.origDur
                    const newStart = Math.max(0, Math.min(snapTime(t), end - MIN_OVERLAY_OUT))
                    setOverlayTiming(o.id, newStart, end - newStart)
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
                aria-label={`Overlay ${index + 1}: ${o.kind === 'text' ? o.text : o.kind}${selected ? ' (selected)' : ''}`}
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
                    setActiveOverlay(o.id)
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
                    setActiveOverlay(o.id)
                    ovDrag.current = { id: o.id, mode: 'end', startX: e.clientX, grabOffset: 0, origStart: o.start, origDur: o.duration, moved: false }
                  }}
                />
                <span className="truncate text-[9px] font-medium text-hi" aria-hidden>
                  {o.kind === 'text' ? o.text : o.kind === 'video' ? '▶ Video' : '🖼 Image'}
                </span>
                {selected ? (
                  <button
                    type="button"
                    className="absolute right-0.5 top-0 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-black/60 text-hi/90 hover:bg-black/80"
                    aria-label="Delete overlay"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      removeOverlay(o.id)
                    }}
                  >
                    <Trash2 size={8} />
                  </button>
                ) : null}
              </div>
            )
          })}
          {/* Playhead (mirrors the base track) */}
          <div
            className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-white/90"
            style={{ left: `${(Math.min(currentTime, total) / total) * 100}%` }}
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  )
}

const toolBtn =
  'fs-tool-hit flex h-6 w-6 items-center justify-center rounded-md text-hi/80 text-lo hover:bg-hover hover:text-hi disabled:opacity-30'

/** Family glyph shown on the clip's transition badge. */
function TransitionIcon({ type }: { type: VideoTransition }): ReactNode {
  if (type === 'dissolve') return <Blend size={8} />
  if (type === 'fadeBlack') return <Square size={8} />
  if (type === 'fadeWhite') return <Sun size={8} />
  if (type === 'circle') return <Circle size={8} />
  if (type === 'zoom') return <ZoomIn size={8} />
  if (type === 'blur') return <Droplets size={8} />
  return <Move size={8} />
}

interface SegmentProps {
  entry: { clip: VideoClip; globalStart: number; out: number; overlapAfter: number }
  index: number
  total: number
  selected: boolean
  /** Drag-reorder hooks (sequence time under the pointer is passed in). */
  onGrab: (entry: SegmentProps['entry'], t: number) => void
  onDrag: (entry: SegmentProps['entry'], t: number) => void
  onRelease: (entry: SegmentProps['entry']) => void
}

const TimelineSegment = memo(function TimelineSegment({
  entry,
  index,
  total,
  selected,
  onGrab,
  onDrag,
  onRelease,
}: SegmentProps): ReactNode {
  const assetId = entry.clip.assetId
  const asset = useAssets()?.find((a) => a.id === assetId)
  const thumb = useThumbnail(asset)
  const left = (entry.globalStart / total) * 100
  const width = (entry.out / total) * 100
  const transition = entry.clip.transition

  /** Sequence-time under the pointer (same mapping the scrub lane uses). */
  const pointerTime = (e: { target: EventTarget | null; clientX: number }): number => {
    const track = (e.target as HTMLElement)?.closest('[data-sequence-track]')
    if (!track) return entry.globalStart
    const rect = track.getBoundingClientRect()
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
        left: `${left}%`,
        width: `${Math.max(0.4, width)}%`,
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
        <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" aria-hidden />
      ) : null}
      <div className={cn('absolute inset-0', selected ? 'bg-accent/15' : 'bg-black/30')} aria-hidden />
      <div className="absolute inset-x-1 top-0.5 flex items-center gap-1">
        <span className="truncate text-[10px] font-medium text-hi" aria-hidden>
          {asset?.name ?? 'Clip'}
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

/** Faint ticks along the track showing the music track's detected beats. */
function BeatMarkers({ total }: { total: number }): ReactNode {
  const music = useVideoEditor((s) => s.music)
  const beats = music?.beats
  if (!beats || beats.length === 0 || total <= 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden>
      {beats
        .filter((b) => b >= 0 && b < total)
        .slice(0, 400)
        .map((beat) => (
          <div
            key={beat}
            className="absolute inset-y-0 w-px bg-accent/25"
            style={{ left: `${(beat / total) * 100}%` }}
          />
        ))}
    </div>
  )
}
