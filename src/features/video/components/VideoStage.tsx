/**
 * The video stage component — the preview canvas, the hidden decoders, the
 * overlay layers and the stage controls (Compare, safe zones, Cover, Export).
 * The playback engine lives in `useStageEngine`; export in `useStageExport`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Camera, Download, Eye, Pause, Play, RotateCcw, ShieldQuestion } from 'lucide-react'
import type { Histogram } from '../../../core/render/histogram'
import { Button } from '../../../ui/button'
import { Tooltip } from '../../../ui/tooltip'
import { cn } from '../../../lib/cn'
import { useVideoEditor, layoutOf } from '../store'
import { VideoTimeline } from './VideoTimeline'
import { useStageEngine } from './useStageEngine'
import { useStageExport } from './useStageExport'

export function VideoStage({ onHistogram, previewCollapsed = false }: { onHistogram?: (h: Histogram | null) => void; previewCollapsed?: boolean }): ReactNode {
  const clips = useVideoEditor((s) => s.sequence)
  const playing = useVideoEditor((s) => s.playing)
  const currentTime = useVideoEditor((s) => s.currentTime)
  const bypass = useVideoEditor((s) => s.bypass)
  const activeClipId = useVideoEditor((s) => s.activeClipId)
  const doc = useVideoEditor((s) => s.doc)
  const canvasSettings = useVideoEditor((s) => s.canvas)
  const durations = useVideoEditor((s) => s.durations)
  const music = useVideoEditor((s) => s.music)
  const overlays = useVideoEditor((s) => s.overlays)
  const voiceovers = useVideoEditor((s) => s.voiceovers)

  const layout = useMemo(() => layoutOf(clips, durations), [clips, durations])
  const atEnd = layout.total > 0 && currentTime >= layout.total - 0.05 && !playing

  const [box, setBox] = useState({ w: 0, h: 0 })
  const [showSafeZones, setShowSafeZones] = useState(false)
  const stageAreaRef = useRef<HTMLDivElement>(null)

  const engine = useStageEngine({
    playing,
    durations,
    music,
    voiceovers,
    overlays,
    activeClipId,
    doc,
    bypass,
    canvas: canvasSettings,
    onHistogram,
  })
  const {
    seekTo,
    togglePlay,
    onStagePointerDown,
    onStagePointerMove,
    onStagePointerUp,
    outDims,
    outCanvasRef,
    histRef,
    videoARef,
    videoBRef,
    musicRef,
    registerOverlayEl,
    recording,
    recordError,
    suppressStageClick,
    fallback,
  } = engine
  const { startExport, saveCoverFrame } = useStageExport(engine, engine.setRecordError)

  // Preview box: the engine's out canvas scales into it imperatively, so no React re-renders.
  useEffect(() => {
    const el = stageAreaRef.current
    if (!el) return
    const update = (): void => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback((): { w: number; h: number } => {
    if (outDims.w === 0 || box.w < 40 || box.h < 40) return { w: 0, h: 0 }
    const scale = Math.min(box.w / outDims.w, box.h / outDims.h, 1)
    return { w: Math.round(outDims.w * scale), h: Math.round(outDims.h * scale) }
  }, [outDims, box])

  const size = fit()

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col p-2 sm:p-4 max-[767px]:p-0">
      <div ref={stageAreaRef} className={cn('relative order-2 flex min-h-0 w-full flex-1 items-center justify-center max-[767px]:order-2', previewCollapsed && 'max-[767px]:hidden')}>
        <div style={{ width: size.w || undefined, height: size.h || undefined }} className="relative min-h-0">
          {/* Width/height are managed imperatively in the render loop (they
              change per-frame with the camera crop). Binding them here makes
              React "correct" the attribute after each paint, which resizes the
              canvas and wipes the frame just composited. */}
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
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-start bg-black/45 pb-1 pl-1.5 text-[9px] font-medium text-white/80">
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
      <div className="z-30 order-4 mt-2 flex w-full max-w-3xl items-center justify-end gap-1 self-center sm:mt-3 max-[767px]:hidden">
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
          className={cn('fs-tool-hit max-[767px]:!h-9 max-[767px]:!w-9 max-[767px]:p-0', bypass ? 'ring-1 ring-accent' : undefined)}
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
          className={cn('fs-tool-hit max-[767px]:!h-9 max-[767px]:!w-9 max-[767px]:p-0', showSafeZones && 'ring-1 ring-accent')}
        >
          <ShieldQuestion size={13} />
          <span className="hidden sm:inline">Safe zones</span>
        </Button>
        <Button size="sm" variant="subtle" aria-label="Save cover frame" title="Save the current frame as a cover image (JPEG)" onClick={() => void saveCoverFrame()} className="fs-tool-hit max-[767px]:!h-9 max-[767px]:!w-9 max-[767px]:p-0">
          <Camera size={13} />
          <span className="hidden sm:inline">Cover</span>
        </Button>
        <Button size="sm" variant="primary" onClick={() => void startExport()} disabled={recording !== null} className="fs-tool-hit max-[767px]:!h-9 max-[767px]:px-3">
          <Download size={13} />
          <span className="sm:hidden">Export</span>
          <span className="hidden sm:inline">Export video</span>
        </Button>
      </div>

      {/* Playback + sequence timeline */}
      <div className="z-20 order-3 mt-2 w-full max-w-3xl self-center sm:mt-3 max-[767px]:mt-2">
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
          <Button size="icon" variant="subtle" aria-label={playing ? 'Pause' : atEnd ? 'Replay' : 'Play'} title={playing ? 'Pause' : atEnd ? 'Replay from the beginning' : 'Play'} onClick={() => void togglePlay()} className="fs-tool-hit">
            {playing ? <Pause size={14} /> : atEnd ? <RotateCcw size={14} /> : <Play size={14} />}
          </Button>
          <VideoTimeline onSeek={seekTo} />
        </div>
      </div>
    </div>
  )
}
