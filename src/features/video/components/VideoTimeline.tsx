import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Copy, Scissors, Trash2 } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../core/format'
import { useVideoEditor, layoutOf } from '../store'
import { useAssets } from '../../library/useAssets'
import type { OverlayClip, VideoClip } from '../sequenceModel'
import { Tooltip } from '../../../ui/tooltip'
import { OverlayLaneRow } from './OverlayLaneRow'
import { TimelineRuler } from './TimelineRuler'
import { TimelineSegment } from './TimelineSegment'
import { VoiceoverRow } from './VoiceoverRow'
import { LaneThumb } from './LaneThumb'
import { BeatMarkers } from './BeatMarkers'

/**
 * The sequence timeline: each clip is a proportional segment (trimmed length
 * at its speed) laid the way playback flows — dissolve overlaps shrink the
 * total. Drag anywhere to scrub; drag the selected clip's edges to trim it;
 * the toolbar splits/moves/duplicates/deletes the selection.
 */

const HANDLE_GRAB_PX =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 18 : 10
const MIN_TRIM_SRC = 0.1
const ZOOM_MAX = 12

/** Touch devices get the CapCut-style timeline: pinch-zoom + fixed center playhead. */
const IS_TOUCH =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const toolBtn =
  'fs-tool-hit flex h-6 items-center justify-center gap-1 rounded-md px-1 text-hi/80 text-lo hover:bg-hover hover:text-hi disabled:opacity-30 max-[767px]:h-10 max-[767px]:min-w-10 max-[767px]:px-2'

export function VideoTimeline({ onSeek }: { onSeek: (t: number) => void }): ReactNode {
  const clips = useVideoEditor((s) => s.sequence)
  const voiceovers = useVideoEditor((s) => s.voiceovers)
  const removeVoiceover = useVideoEditor((s) => s.removeVoiceover)
  const overlays = useVideoEditor((s) => s.overlays)
  const activeOverlayId = useVideoEditor((s) => s.activeOverlayId)
  const setActiveOverlay = useVideoEditor((s) => s.setActiveOverlay)
  const removeOverlay = useVideoEditor((s) => s.removeOverlay)
  const moveOverlay = useVideoEditor((s) => s.moveOverlay)
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
  const liveDoc = useVideoEditor((s) => s.doc)
  const setOverlayMuted = useVideoEditor((s) => s.setOverlayMuted)
  const assets = useAssets()

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])
  const total = Math.max(0.0001, layout.total)
  const textOverlays = useMemo(() => overlays.filter((o) => o.kind === 'text'), [overlays])
  const mediaOverlays = useMemo(() => overlays.filter((o) => o.kind !== 'text'), [overlays])
  /**
   * Multi-track lane packing: media layers that never overlap in time share
   * one lane (sequential b-roll reads as a single track); overlapping layers
   * stack into new lanes below. Greedy interval packing, first-fit.
   */
  const mediaLanes = useMemo(() => {
    const sorted = [...mediaOverlays].sort((a, b) => a.start - b.start)
    const laneEnds: number[] = []
    const groups: OverlayClip[][] = []
    for (const o of sorted) {
      let placed = false
      for (let i = 0; i < laneEnds.length; i++) {
        if (o.start >= laneEnds[i] - 1e-6) {
          groups[i].push(o)
          laneEnds[i] = o.start + o.duration
          placed = true
          break
        }
      }
      if (!placed) {
        groups.push([o])
        laneEnds.push(o.start + o.duration)
      }
    }
    return groups
  }, [mediaOverlays])
  const trackRef = useRef<HTMLDivElement>(null)
  const dragMode = useRef<'scrub' | 'start' | 'end'>('scrub')
  // Clip drag-reorder on the base track (grab the block and move it).
  const segDrag = useRef<{ id: string; grabOffset: number; mids: { id: string; mid: number }[]; moved: boolean; lastTo: number } | null>(null)

  // --- Touch timeline: px-per-second mapping, pan + pinch, fixed center playhead.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [viewportW, setViewportW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [viewStart, setViewStart] = useState(0)
  const zoomedRef = useRef(false)
  const pxPerSec = IS_TOUCH && viewportW > 0 ? (viewportW / total) * zoom : 0
  const pxRef = useRef(0)
  const vsRef = useRef(0)
  pxRef.current = pxPerSec
  vsRef.current = viewStart
  const viewportSec = pxPerSec > 0 ? viewportW / pxPerSec : total
  const gesture = useRef<
    | { kind: 'pan'; pointerId: number; startX: number; startView: number; moved: boolean }
    | { kind: 'pinch'; dist0: number; zoom0: number; anchorTime: number; mid0X: number }
    | null
  >(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())

  useEffect(() => {
    if (!IS_TOUCH) return
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportW(el.getBoundingClientRect().width))
    ro.observe(el)
    setViewportW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  /** Keeps viewStart within its legal range (playhead time ∈ [0, total]). */
  const clampView = useCallback(
    (v: number): number => {
      // Never allow a negative timeline offset. When the whole sequence fits
      // in the viewport, a negative start creates a misleading empty region
      // before the first clip and makes Clip 1 appear to begin at 0:18.
      const maxStart = Math.max(0, total - viewportSec)
      return Math.min(Math.max(v, 0), maxStart)
    },
    [total, viewportSec],
  )

  // External seeks / playback: keep currentTime under the fixed center playhead
  // (content auto-scrolls) unless the user is mid-gesture.
  useEffect(() => {
    if (!IS_TOUCH || pxPerSec <= 0 || gesture.current) return
    setViewStart(clampView(currentTime - viewportSec / 2))
  }, [currentTime, viewportSec, total, pxPerSec, clampView])

  const seekCenter = useCallback(
    (v?: number): void => {
      onSeek((v ?? vsRef.current) + viewportSec / 2)
    },
    [onSeek, viewportSec],
  )

  const beginGesture = useCallback((e: React.PointerEvent<HTMLElement>): void => {
    if (!IS_TOUCH || pxRef.current <= 0 || e.button !== 0) return
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
    if (activePointers.current.size === 2) {
      // Second finger down: convert to a pinch anchored on the midpoint.
      const pts = [...activePointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      const anchorTime = vsRef.current + (midX - rect.left) / pxRef.current
      gesture.current = { kind: 'pinch', dist0: Math.max(20, dist), zoom0: zoomedRef.current ? zoom : 1, anchorTime, mid0X: midX }
      return
    }
    gesture.current = { kind: 'pan', pointerId: e.pointerId, startX: e.clientX, startView: vsRef.current, moved: false }
  }, [zoom])

  const moveGesture = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (!IS_TOUCH || pxRef.current <= 0) return
      const g = gesture.current
      if (!g) return
      if (g.kind === 'pan') {
        if (e.pointerId !== g.pointerId || e.buttons === 0) return
        const dx = e.clientX - g.startX
        if (!g.moved && Math.abs(dx) < 4) return
        g.moved = true
        const v = clampView(g.startView - dx / pxRef.current)
        setViewStart(v)
        seekCenter(v)
        return
      }
      // Pinch: zoom around the anchor time, re-pan so the anchor stays put.
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pts = [...activePointers.current.values()]
      if (pts.length < 2) return
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      const zoomNext = Math.min(ZOOM_MAX, Math.max(1, g.zoom0 * (dist / g.dist0)))
      const pxNext = (viewportW / total) * zoomNext
      if (Math.abs(pxNext - pxRef.current) < 0.01 && Math.abs(midX - g.mid0X) < 1) return
      if (zoomNext > 1.001) zoomedRef.current = true
      setZoom(zoomNext)
      const vFinal = clampView(g.anchorTime - (midX - rect.left) / pxNext)
      setViewStart(vFinal)
      seekCenter(vFinal)
    },
    [clampView, seekCenter, total, viewportW],
  )

  const endGesture = useCallback((e: React.PointerEvent<HTMLElement>): void => {
    activePointers.current.delete(e.pointerId)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointers
    }
    const g = gesture.current
    if (g && g.kind === 'pan' && !g.moved) {
      // Tap (no drag): seek to the tapped time — the follow effect then
      // scrolls that point under the fixed center playhead.
      const el = trackRef.current
      const rect = el?.getBoundingClientRect()
      if (rect && pxRef.current > 0) onSeek(vsRef.current + (e.clientX - rect.left) / pxRef.current)
    }
    if (activePointers.current.size === 0) gesture.current = null
  }, [onSeek])

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

  const timeAt = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      // Touch mode maps through the pan/zoom viewport; desktop fits the
      // whole sequence to the lane width.
      if (IS_TOUCH && pxPerSec > 0) return viewStart + (clientX - rect.left) / pxPerSec
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * total
    },
    [pxPerSec, total, viewStart],
  )

  /** Screen-x of a sequence time (mobile px viewport vs desktop fit). */
  const xOf = useCallback(
    (t: number, rectWidth: number): number => {
      if (IS_TOUCH && pxPerSec > 0) return (t - viewStart) * pxPerSec
      return (t / total) * rectWidth
    },
    [pxPerSec, total, viewStart],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const el = trackRef.current
      if (!el || e.button !== 0) return
      const rect = el.getBoundingClientRect()
      const t = timeAt(e.clientX)
      // Selected clip's edges trim; anything else scrubs (desktop) or pans
      // under the fixed center playhead (touch).
      const index = layout.entries.findIndex((entry) => entry.clip.id === activeClipId)
      let edge = false
      if (index >= 0) {
        const entry = layout.entries[index]
        const leftPx = xOf(entry.globalStart, rect.width)
        const rightPx = xOf(entry.globalStart + entry.out, rect.width)
        if (Math.abs(e.clientX - rect.left - leftPx) <= HANDLE_GRAB_PX) dragMode.current = 'start'
        else if (Math.abs(e.clientX - rect.left - rightPx) <= HANDLE_GRAB_PX) dragMode.current = 'end'
        else dragMode.current = 'scrub'
        edge = dragMode.current !== 'scrub'
      } else {
        dragMode.current = 'scrub'
      }
      if (IS_TOUCH && pxPerSec > 0 && !edge) {
        // Touch: pan/pinch gesture instead of a direct scrub.
        beginGesture(e)
        return
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
      if (dragMode.current === 'scrub') onSeek(t)
    },
    [activeClipId, beginGesture, layout.entries, onSeek, pxPerSec, timeAt, xOf],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      // No pressed pointer = hover over the track; scrubbing requires a gesture.
      if (e.buttons === 0) return
      const el = trackRef.current
      if (!el) return
      const mode = dragMode.current
      if (mode === 'scrub') {
        if (IS_TOUCH && pxPerSec > 0 && gesture.current) {
          moveGesture(e)
          return
        }
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
    [activeClipId, assets, durations, layout.entries, moveGesture, onSeek, pxPerSec, setTrimLive, timeAt],
  )

  const finish = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const el = trackRef.current
      if (!el) return
      if (dragMode.current !== 'scrub') commitTrim()
      else if (IS_TOUCH && pxPerSec > 0) endGesture(e)
      dragMode.current = 'scrub'
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
    },
    [commitTrim, endGesture, pxPerSec],
  )

  // Per-clip audio fade drag (selected clip): grab a fade handle at the
  // clip's bottom corners and drag horizontally to change the fade length.
  // Hooks must run unconditionally, so these live above the empty-timeline
  // early return.
  const mobileMap = useMemo(
    () => (IS_TOUCH && pxPerSec > 0 ? { pxPerSec, viewStart } : null),
    [pxPerSec, viewStart],
  )
  const fadeDrag = useRef<{ edge: 'in' | 'out'; startX: number; fadeIn: number; fadeOut: number; pxPerSec: number } | null>(null)
  const onFadeDown = useCallback(
    (edge: 'in' | 'out', e: React.PointerEvent<HTMLDivElement>): void => {
      const doc = useVideoEditor.getState().doc
      if (!doc || !activeClipId) return
      e.stopPropagation()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
      const el = trackRef.current
      const rect = el?.getBoundingClientRect()
      const pps = rect && mobileMap ? mobileMap.pxPerSec : rect && total > 0 ? rect.width / total : 100
      fadeDrag.current = { edge, startX: e.clientX, fadeIn: doc.audioFadeIn ?? 0, fadeOut: doc.audioFadeOut ?? 0, pxPerSec: pps }
    },
    [activeClipId, mobileMap, total],
  )
  const onFadeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const d = fadeDrag.current
      if (!d || e.buttons === 0) return
      const delta = (e.clientX - d.startX) / d.pxPerSec
      const fi = d.edge === 'in' ? Math.max(0, Math.min(5, d.fadeIn + delta)) : d.fadeIn
      const fo = d.edge === 'out' ? Math.max(0, Math.min(5, d.fadeOut - delta)) : d.fadeOut
      useVideoEditor.getState().setAudioFades(fi, fo)
    },
    [],
  )
  const onFadeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!fadeDrag.current) return
      fadeDrag.current = null
      useVideoEditor.getState().commitAudioFades()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // synthetic or already-released pointers
      }
    },
    [],
  )

  if (clips.length === 0) {
    return (
      <div
        className="flex h-28 min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-elevated text-center"
        role="status"
      >
        <span className="text-2xl leading-none text-lo" aria-hidden>
          ＋
        </span>
        <span className="text-xs font-medium text-hi">Add video clips to start editing</span>
        <span className="max-w-56 text-[11px] leading-snug text-lo">
          Import videos in the library, then tap one and choose “Add to project”. Tap a clip here any time to edit it.
        </span>
      </div>
    )
  }

  const canOperate = activeClipId !== null

  /** Beginner hint: what to do next, based on what's selected. */
  const hint = activeOverlayId !== null
    ? 'Layer selected — drag it, trim its edges, or use the sheet to edit it'
    : activeClipId !== null
      ? 'Clip selected — drag the white handles to trim, or use the tools below'
      : 'Tap a clip to edit it · pinch to zoom · drag the track to scrub'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center justify-between px-0.5 max-[767px]:mt-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-lo">Timeline</span>
        <span className="text-[10px] text-lo" aria-live="polite">
          {activeOverlayId !== null ? 'Overlay selected' : activeClipId !== null ? 'Clip selected' : 'Select a clip to edit'}
        </span>
      </div>
      {!IS_TOUCH ? null : (
        <p className="truncate px-0.5 text-[10px] leading-tight text-lo max-[767px]:hidden" role="status">
          {hint}
        </p>
      )}
      {/* Clip operations toolbar — labeled on touch devices so beginners
          can read what each tool does (desktop relies on tooltips). */}
      <div className="flex flex-wrap items-center gap-1 max-[767px]:gap-2">
        <Tooltip content="Split the selected clip at the playhead (Scissors)">
          <button type="button" onClick={splitAtPlayhead} disabled={!canOperate} className={toolBtn} aria-label="Split clip at playhead">
            <Scissors size={12} />
            <span className="hidden">Split</span>
          </button>
        </Tooltip>
        <Tooltip content="Move clip earlier">
          <button type="button" onClick={() => activeClipId && moveClip(activeClipId, -1)} disabled={!canOperate} className={toolBtn} aria-label="Move clip earlier">
            <ArrowLeft size={12} />
            <span className="hidden">Earlier</span>
          </button>
        </Tooltip>
        <Tooltip content="Move clip later">
          <button type="button" onClick={() => activeClipId && moveClip(activeClipId, 1)} disabled={!canOperate} className={toolBtn} aria-label="Move clip later">
            <ArrowRight size={12} />
            <span className="hidden">Later</span>
          </button>
        </Tooltip>
        <Tooltip content="Duplicate clip">
          <button type="button" onClick={() => activeClipId && duplicateClip(activeClipId)} disabled={!canOperate} className={toolBtn} aria-label="Duplicate clip">
            <Copy size={12} />
            <span className="hidden">Copy</span>
          </button>
        </Tooltip>
        <Tooltip content="Delete clip">
          <button type="button" onClick={() => activeClipId && removeClip(activeClipId)} disabled={!canOperate} className={cn(toolBtn, 'text-danger max-[767px]:ml-auto')} aria-label="Delete clip">
            <Trash2 size={12} />
            <span className="hidden">Delete</span>
          </button>
        </Tooltip>
        <span className="ml-auto pr-1 text-[10px] tabular-nums text-lo max-[767px]:basis-full max-[767px]:text-right" aria-label={`Playhead ${formatDuration(currentTime)} of ${formatDuration(total)}`}>
          {formatDuration(currentTime)} <span className="text-line">/</span> {formatDuration(total)}
        </span>
      </div>

      {/* All rows share one pan/zoom viewport on touch — the playhead is
          fixed at the horizontal center and clips scroll underneath it. */}
      <div ref={wrapRef} className="relative flex min-w-0 flex-col gap-1">
        {mobileMap ? (
          <div
            className="pointer-events-none absolute inset-y-0 left-1/2 z-40 w-0.5 -translate-x-1/2 bg-white/90"
            aria-hidden
          />
        ) : null}

        <TimelineRuler total={total} />
        {/* The track */}
        <div
          ref={trackRef}
          data-sequence-track
          className="relative h-14 min-w-0 touch-none select-none overflow-hidden rounded-md bg-elevated outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              mobile={mobileMap}
              fade={
                entry.clip.id === activeClipId && liveDoc
                  ? { in: liveDoc.audioFadeIn ?? 0, out: liveDoc.audioFadeOut ?? 0, live: true }
                  : { in: entry.clip.edit.audioFadeIn ?? 0, out: entry.clip.edit.audioFadeOut ?? 0, live: false }
              }
              onFadeDown={onFadeDown}
              onFadeMove={onFadeMove}
              onFadeUp={onFadeUp}
              onGrab={onSegmentGrab}
              onDrag={onSegmentDrag}
              onRelease={onSegmentRelease}
            />
          ))}
          {/* Beat grid (from the music track's local analysis). */}
          <BeatMarkers total={total} mobile={mobileMap} />
          {/* Playhead (desktop; touch uses the shared fixed center one) */}
          {!mobileMap ? (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-white/90"
              style={{ left: `${(Math.min(currentTime, total) / total) * 100}%` }}
              aria-hidden
            />
          ) : null}
        </div>

        {/* Voiceover track: Kokoro TTS clips (plays during export). */}
        <VoiceoverRow
          voiceovers={voiceovers}
          total={total}
          assets={assets ?? []}
          onRemove={removeVoiceover}
        />

        {/* Overlay track lanes: text layers share one lane; every media layer
            gets its own stacked lane (multi-track, CapCut-style). */}
        {textOverlays.length > 0 ? (
          <OverlayLaneRow
            laneLabel="Text overlays"
            overlays={textOverlays}
            total={total}
            currentTime={currentTime}
            onSeek={onSeek}
            selectedId={activeOverlayId}
            onSelect={setActiveOverlay}
            onRemove={removeOverlay}
            onTiming={setOverlayTiming}
            mobile={mobileMap}
            onPanDown={beginGesture}
            onPanMove={moveGesture}
            onPanUp={endGesture}
          />
        ) : null}
        {mediaLanes.map((lane) => (
          <OverlayLaneRow
            key={lane.map((o) => o.id).join(':')}
            laneLabel={`Media layer — ${lane.map((o) => assets?.find((a) => a.id === o.assetId)?.name ?? o.kind).join(' → ')}`}
            overlays={lane}
            total={total}
            currentTime={currentTime}
            onSeek={onSeek}
            selectedId={activeOverlayId}
            onSelect={setActiveOverlay}
            onRemove={removeOverlay}
            onTiming={setOverlayTiming}
            onToggleMute={(id) => setOverlayMuted(id, !(overlays.find((o) => o.id === id)?.muted ?? false))}
            onMoveOverlay={moveOverlay}
            mobile={mobileMap}
            onPanDown={beginGesture}
            onPanMove={moveGesture}
            onPanUp={endGesture}
            chipThumb={(layer) => <LaneThumb assetId={layer.assetId} />}
          />
        ))}
      </div>
    </div>
  )
}
