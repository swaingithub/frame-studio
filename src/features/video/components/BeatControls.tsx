import { useState, type ReactNode } from 'react'
import { AudioLines, Sparkles } from 'lucide-react'
import { extractClipAudio } from '../captionAudio'
import { detectBeats } from '../beatDetect'
import { useAssetBlob, useAssets } from '../../library/useAssets'
import { useVideoEditor } from '../store'
import { Heading } from './InspectorUi'

/** Decode + analyse states for the beat detector. */
export type BeatStatus = 'idle' | 'analysing' | 'error'

/**
 * Beat-sync controls: analyse the chosen music locally (no upload) to find
 * its tempo, then either snap every clip boundary to the grid with
 * "Sync cuts to beats" or just show the grid on the timeline.
 */
export function BeatControls(): ReactNode {
  const music = useVideoEditor((s) => s.music)
  const setBeats = useVideoEditor((s) => s.setBeats)
  const syncCuts = useVideoEditor((s) => s.syncCutsToBeats)
  const clipCount = useVideoEditor((s) => s.sequence.length)
  const [status, setStatus] = useState<BeatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const asset = useAssets()?.find((a) => a.id === music?.assetId) ?? null
  const blob = useAssetBlob(asset)

  const detect = async (): Promise<void> => {
    if (!blob) return
    setStatus('analysing')
    setError(null)
    try {
      const samples = await extractClipAudio(blob, 0, null, 300)
      const info = detectBeats(samples, 16000)
      if (info.beats.length < 4) {
        setError('No steady tempo found in this track.')
        setStatus('error')
        return
      }
      setBeats(info.beats, info.bpm)
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const busy = status === 'analysing'
  const beats = music?.beats ?? null
  return (
    <section aria-label="Beat sync">
      <Heading icon={<AudioLines size={11} />}>Beat sync</Heading>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void detect()}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-elevated px-2 py-1.5 text-[11px] font-medium text-hi hover:bg-hover disabled:opacity-40"
        >
          <AudioLines size={12} />
          {beats ? 'Re-detect beats' : 'Detect beats'}
        </button>
        {beats ? (
          <button
            type="button"
            disabled={clipCount < 2}
            onClick={syncCuts}
            title={clipCount < 2 ? 'Add another clip first' : undefined}
            className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-onaccent hover:brightness-110 disabled:opacity-40"
          >
            <Sparkles size={12} />
            Sync cuts
          </button>
        ) : null}
      </div>
      {beats ? (
        <p className="mt-1.5 text-[10px] text-lo">
          {music?.bpm ? `${Math.round(music.bpm)} BPM · ` : ''}
          {beats.length} beats on the timeline — cuts can snap to them.
        </p>
      ) : null}
      {busy ? <p className="mt-1.5 text-[10px] text-lo">Analysing the track on this device…</p> : null}
      {error ? <p className="mt-1.5 text-[10px] leading-snug text-danger">{error}</p> : null}
    </section>
  )
}
