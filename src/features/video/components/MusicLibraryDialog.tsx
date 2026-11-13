import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Clock3, Disc3, Loader2, Pause, Play, Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Dialog, DialogContent } from '../../../ui/dialog'
import { cn } from '../../../lib/cn'
import { toast } from '../../../ui/toastStore'
import { importFiles } from '../../library/import'
import { useAssets } from '../../library/useAssets'
import { useProjectsStore } from '../../projects/store'
import { useVideoEditor } from '../store'
import {
  MUSIC_LIBRARY,
  formatMusicDuration,
  musicTrackUrl,
  type MusicLibraryTrack,
} from '../musicLibrary'

interface MusicLibraryDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Built-in, offline music library. Tracks ship with the app as CC0 originals;
 * adding one imports the local file into the project and selects it as the
 * sequence music. No network request is made beyond reading the bundled asset.
 */
export function MusicLibraryDialog({ open, onClose }: MusicLibraryDialogProps): ReactNode {
  const assets = useAssets()
  const addAssetsToCurrent = useProjectsStore((s) => s.addAssetsToCurrent)
  const setMusic = useVideoEditor((s) => s.setMusic)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moodFilter, setMoodFilter] = useState<string | null>(null)
  const categories = [...new Set(MUSIC_LIBRARY.tracks.map((t) => t.mood[0]))]
  const visibleTracks = moodFilter
    ? MUSIC_LIBRARY.tracks.filter((t) => t.mood[0] === moodFilter)
    : MUSIC_LIBRARY.tracks

  const stopPreview = useCallback((): void => {
    audioRef.current?.pause()
    setPlayingId(null)
  }, [])

  useEffect(() => {
    if (!open) stopPreview()
  }, [open, stopPreview])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const togglePreview = (track: MusicLibraryTrack): void => {
    let el = audioRef.current
    if (!el) {
      el = new Audio()
      el.preload = 'metadata'
      el.onended = () => setPlayingId(null)
      audioRef.current = el
    }
    if (playingId === track.id) {
      el.pause()
      setPlayingId(null)
      return
    }
    el.src = musicTrackUrl(track.file)
    el.currentTime = 0
    void el
      .play()
      .then(() => setPlayingId(track.id))
      .catch(() => {
        setPlayingId(null)
        setError('This browser could not preview the track. You can still add it.')
      })
  }

  const addTrack = async (track: MusicLibraryTrack): Promise<void> => {
    if (busyId) return
    stopPreview()
    setBusyId(track.id)
    setError(null)
    try {
      // Reuse an asset imported in an earlier session instead of duplicating it.
      const existing = (assets ?? []).find((a) => a.kind === 'audio' && a.name === track.file)
      let assetId = existing?.id
      if (!assetId) {
        const res = await fetch(musicTrackUrl(track.file))
        if (!res.ok) throw new Error(`Could not read ${track.file} (${res.status}).`)
        const blob = await res.blob()
        const file = new File([blob], track.file, { type: blob.type || 'audio/mp4' })
        const result = await importFiles([file])
        if (result.imported.length === 0) {
          throw new Error(result.failed[0]?.reason ?? 'The track could not be imported.')
        }
        assetId = result.imported[0].id
      }
      addAssetsToCurrent([assetId], 'audio')
      setMusic(assetId)
      toast('Music added', track.title, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The track could not be added.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        title="Music library"
        description="Original tracks bundled with Frame Studio — CC0 1.0, free for any use, and stored entirely on this device."
        className="max-h-[88vh]"
        wide
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by mood">
            <button
              type="button"
              aria-pressed={moodFilter === null}
              onClick={() => {
                setMoodFilter(null)
                stopPreview()
              }}
              className={cn(
                'rounded-full px-2 py-1 text-[10px] font-semibold transition-colors',
                moodFilter === null ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                aria-pressed={moodFilter === cat}
                onClick={() => {
                  setMoodFilter(moodFilter === cat ? null : cat)
                  stopPreview()
                }}
                className={cn(
                  'rounded-full px-2 py-1 text-[10px] font-semibold transition-colors',
                  moodFilter === cat ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {visibleTracks.map((track) => {
            const playing = playingId === track.id
            const busy = busyId === track.id
            return (
              <div
                key={track.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-line bg-elevated/60 p-2.5 transition-colors',
                  playing && 'border-accent/60 bg-accent/10',
                )}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(track)}
                  aria-label={playing ? `Pause ${track.title}` : `Preview ${track.title}`}
                  aria-pressed={playing}
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors',
                    playing ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                  )}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-[1px]" />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-xs font-semibold text-hi">{track.title}</span>
                    <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
                      CC0
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-lo">
                    <span>{track.artist}</span>
                    <span aria-hidden>·</span>
                    <span>{track.bpm} BPM</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Clock3 size={9} aria-hidden />
                      {formatMusicDuration(track.duration)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{track.mood.join(' / ')}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void addTrack(track)}
                  disabled={busy || busyId !== null}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-onaccent transition-colors',
                    'hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  {busy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                  {busy ? 'Adding' : 'Add'}
                </button>
              </div>
            )
          })}

          {error ? (
            <p className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex items-start gap-2 rounded-lg border border-line/70 bg-panel px-2.5 py-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
            <div className="text-[10px] leading-relaxed text-lo">
              <p className="font-medium text-hi/90">Safe and offline</p>
              <p>
                These tracks were synthesized for Frame Studio and dedicated to the public domain
                (CC0 1.0). They are bundled with the app, never streamed, and are copied into your
                local project only when you add one.
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-lo/80">
                <Disc3 size={10} aria-hidden />
                {MUSIC_LIBRARY.tracks.length} tracks · {MUSIC_LIBRARY.license} · no attribution required
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
