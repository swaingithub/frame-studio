/**
 * Stage export: "Save cover frame" and "Export video". Encodes the composited
 * canvas (WebCodecs MP4/WebM with a MediaRecorder fallback) while the sequence
 * plays once; the mixed audio (clips + music + voiceovers) is recorded in real
 * time. Run from the stage controls.
 */

import { useCallback } from 'react'
import { exportSequenceName, recordStream } from '../exportVideo'
import { downloadBlob } from '../../../lib/download'
import { pickWcFormat, recordWebCodecs } from '../webcodecsExport'
import { layoutOf, useVideoEditor } from '../store'
import { useCurrentProject } from '../../projects/store'
import type { useStageEngine } from './useStageEngine'

export function useStageExport(
  engine: ReturnType<typeof useStageEngine>,
  setRecordError: (e: string | null) => void,
): { startExport: () => Promise<void>; saveCoverFrame: () => Promise<void> } {
  const { outCanvasRef, togglePlay, seekTo, voiceoverElsRef, overlayEls, musicRef, videoARef, videoBRef, recording, exportDone, recordingTotal } = engine
  const project = useCurrentProject()

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
  }, [outCanvasRef])

  const startExport = useCallback(async (): Promise<void> => {
    const out = outCanvasRef.current
    if (!out || recording !== null) return
    const state = useVideoEditor.getState()
    const layout = layoutOf(state.sequence, state.durations)
    if (layout.entries.length === 0) return
    setRecordError(null)
    const total = layout.total
    recordingTotal.current = total
    engine.setRecording({ done: 0, total })
    const started = useVideoEditor.getState()
    started.setPlaying(false)
    seekTo(0)
    const voiceoverEls = [...voiceoverElsRef.current.values()]
    // Voiceovers (Kokoro TTS): play over the export.
    for (const el of voiceoverEls) el.play().catch(() => undefined)
    const audioElements = [
      videoARef.current,
      videoBRef.current,
      musicRef.current,
      // Multi-track: unmuted overlay video layers contribute their own audio.
      ...state.overlays
        .filter((o) => o.kind === 'video' && o.muted !== true)
        .map((o) => overlayEls.current.get(o.id))
        .filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement),
      // Kokoro voiceovers.
      ...voiceoverEls,
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
      engine.setRecording(null)
      started.setPlaying(false)
      started.setExporting(false)
    }
  }, [engine, setRecordError, togglePlay, seekTo, voiceoverElsRef, overlayEls, musicRef, videoARef, videoBRef, recording, exportDone, recordingTotal, outCanvasRef, project])

  return { startExport, saveCoverFrame }
}
