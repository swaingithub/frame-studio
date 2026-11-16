import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Clock3, Disc2, Heart, Loader2, Music, Play, Plus, ShieldCheck, Search, TriangleAlert } from 'lucide-react'
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

const SAVED_KEY = 'fs.savedMusic'

function loadSaved(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function persistSaved(ids: Set<string>): void {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify([...ids]))
  } catch {
    // storage unavailable — saved state just won't persist
  }
}

/** Animated equalizer shown while a track preview plays. */
function Equalizer({ playing }: { playing: boolean }): ReactNode {
  return (
    <div className="flex items-end gap-1 h-5 w-20">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-accent transition-all duration-[120ms]"
          style={{
            height: `${24 + i * 13}%`,
            animationDelay: `${i * 0.08}s`,
            ...(playing ? { animation: 'fs-eq-bounce 0.9s ease-in-out infinite' } : {}),
          }}
        />
      ))}
    </div>
  )
}

/** One library track row: preview + metadata + primary "Use audio" + bookmark. */
function LibraryTrackRow({
  track,
  playing,
  busy,
  onPlay,
  onUse,
  onSave,
  saved,
  inUse,
}: {
  track: MusicLibraryTrack
  playing: boolean
  busy: boolean
  onPlay: () => void
  onUse: () => void
  onSave: () => void
  saved: boolean
  inUse: boolean
}): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-elevated/50 p-2.5 transition-colors hover:border-lo/60">
      <button
        type="button"
        onClick={onPlay}
        aria-label={playing ? `Pause ${track.title}` : `Preview ${track.title}`}
        aria-pressed={playing}
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors',
          playing ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
        )}
      >
        {playing ? (
          <Equalizer playing />
        ) : (
          <Play size={15} className="translate-x-[1px]" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-hi">{track.title}</span>
          {inUse ? (
            <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
              <Music size={9} aria-hidden />
              In your project
            </span>
          ) : null}
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

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onUse}
          disabled={busy || inUse}
          aria-label={inUse ? 'Already in your project' : `Use ${track.title}`}
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors',
            inUse
              ? 'bg-elevated text-lo/60 border border-line cursor-not-allowed'
              : 'bg-accent text-onaccent hover:bg-accent/90',
          )}
        >
          {busy ? (
            <Loader2 size={11} className="animate-spin" />
          ) : inUse ? (
            'Added'
          ) : (
            <>
              <Plus size={11} /> Use audio
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onSave}
          aria-label={saved ? `Unsave ${track.title}` : `Save ${track.title}`}
          className={cn(
            'shrink-0 p-1.5 rounded-md transition-colors text-hi/70 hover:text-hi',
            saved ? 'text-accent' : 'bg-elevated/50 hover:bg-hover',
          )}
        >
          <Heart size={14} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
}

/** One imported audio asset row (Your Music tab). */
function YourMusicRow({
  asset,
  onUse,
  inUse,
}: {
  asset: { id: string; name: string; size: number; duration: number | null }
  onUse: () => void
  inUse: boolean
}): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-elevated/50 p-2.5 transition-colors hover:border-lo/60">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
        <Music size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <span className="truncate block text-sm font-semibold text-hi">{asset.name}</span>
        <p className="mt-0.5 text-[10px] text-lo">
          {asset.duration !== null ? `${formatMusicDuration(asset.duration)} · ` : ''}
          {(asset.size / 1024).toFixed(0)} KB · imported
        </p>
      </div>

      <button
        type="button"
        onClick={onUse}
        disabled={inUse}
        aria-label={inUse ? 'Already in your project' : `Use ${asset.name}`}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors',
          inUse
            ? 'bg-elevated text-lo/60 border border-line cursor-not-allowed'
            : 'bg-accent text-onaccent hover:bg-accent/90',
        )}
      >
        {inUse ? 'Added' : 'Use audio'}
      </button>
    </div>
  )
}

/**
 * Instagram-style music picker: For You / Browse / Saved / Your Music.
 * Everything stays on-device — bundled CC0 tracks plus audio you've imported.
 */
export function MusicLibraryDialog({ open, onClose }: MusicLibraryDialogProps): ReactNode {
  const assets = useAssets()
  const addAssetsToCurrent = useProjectsStore((s) => s.addAssetsToCurrent)
  const setMusic = useVideoEditor((s) => s.setMusic)
  const music = useVideoEditor((s) => s.music)
  const audioAssets = useMemo(
    () => (assets ?? []).filter((a) => a.kind === 'audio'),
    [assets],
  )

  const [tab, setTab] = useState<'foryou' | 'browse' | 'saved' | 'yours'>('foryou')
  const [search, setSearch] = useState('')
  const [moodFilter, setMoodFilter] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(loadSaved)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopPreview = useCallback((): void => {
    audioRef.current?.pause()
    setPlayingId(null)
  }, [])

  const toggleSaved = (trackId: string): void => {
    const next = new Set(savedIds)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    setSavedIds(next)
    persistSaved(next)
  }

  const isSaved = (trackId: string) => savedIds.has(trackId)
  const inUse = (trackId: string) => music?.assetId === trackId

  useEffect(() => {
    if (!open) stopPreview()
  }, [open, stopPreview])

  useEffect(() => {
    return () => audioRef.current?.pause()
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
        setError('This browser could not preview the track. You can still use it.')
      })
  }

  const addTrack = async (track: MusicLibraryTrack): Promise<void> => {
    if (busyId) return
    stopPreview()
    setBusyId(track.id)
    setError(null)
    try {
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

  const selectImported = (assetId: string): void => {
    stopPreview()
    setMusic(assetId)
    toast('Music added', undefined, 'success')
    onClose()
  }

  const categories = [...new Set(MUSIC_LIBRARY.tracks.map((t) => t.mood[0]))]
  const currentTrack = music ? findTrack(music.assetId) : null
  const searchLower = search.toLowerCase()
  const libraryTracks = MUSIC_LIBRARY.tracks.filter((t) => {
    if (moodFilter && t.mood[0] !== moodFilter) return false
    const blob = `${t.title} ${t.artist} ${t.mood.join(' ')}`.toLowerCase()
    return blob.includes(searchLower)
  })

  const recentlyAdded = audioAssets.slice(0, 4)

  const tabLabel: Record<'foryou' | 'browse' | 'saved' | 'yours', string> = {
    foryou: 'For you',
    browse: 'Browse',
    saved: 'Saved',
    yours: 'Your music',
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        title="Music library"
        description="Browse bundled CC0 tracks or audio you've imported. Everything stays on this device."
        className="max-h-[90vh] w-[min(92vw,720px)]"
        wide
      >
        <div className="flex flex-col gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-lo/60" aria-hidden />
            <input
              type="search"
              placeholder="Search tracks, artists, moods…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 pl-9 text-[12px] text-hi outline-none focus-visible:border-accent"
              aria-label="Search music"
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 border-b border-line/50 pb-1 overflow-x-auto scrollbar-hide">
            {(['foryou', 'browse', 'saved', 'yours'] as const).map((t) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t)
                    setMoodFilter(null)
                  }}
                  className={cn(
                    'shrink-0 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                    active ? 'bg-accent text-onaccent' : 'text-lo/70 hover:text-hi hover:bg-elevated/40',
                  )}
                >
                  {tabLabel[t]}
                </button>
              )
            })}
          </div>

          {/* Mood chips (Browse only) */}
          {tab === 'browse' && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by mood">
              <button
                type="button"
                aria-pressed={moodFilter === null}
                onClick={() => setMoodFilter(null)}
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
                  onClick={() => setMoodFilter(moodFilter === cat ? null : cat)}
                  className={cn(
                    'rounded-full px-2 py-1 text-[10px] font-semibold transition-colors',
                    moodFilter === cat ? 'bg-accent text-onaccent' : 'bg-elevated text-hi hover:bg-hover',
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* For You */}
            {tab === 'foryou' && (
              <div className="pt-2">
                {music && currentTrack && (
                  <div className="px-2 mb-3">
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-lo">In your project</h3>
                    <LibraryTrackRow
                      track={currentTrack}
                      playing={playingId === music.assetId}
                      busy={busyId === music.assetId}
                      onPlay={() => togglePreview(currentTrack)}
                      onUse={() => {}}
                      onSave={() => {}}
                      saved={false}
                      inUse
                    />
                  </div>
                )}
                {recentlyAdded.length > 0 && (
                  <div className="px-2 mb-3">
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-lo">
                      Recently added
                    </h3>
                    <div className="grid gap-2">
                      {recentlyAdded.map((a) => (
                        <YourMusicRow
                          key={a.id}
                          asset={{ id: a.id, name: a.name, size: a.size, duration: a.duration }}
                          onUse={() => selectImported(a.id)}
                          inUse={music?.assetId === a.id}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="px-2">
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-lo">
                    Recommended for you
                  </h3>
                  <div className="grid gap-2">
                    {libraryTracks
                      .filter((t) => !recentlyAdded.some((a) => a.name === t.file))
                      .slice(0, 8)
                      .map((track) => (
                        <LibraryTrackRow
                          key={track.id}
                          track={track}
                          playing={playingId === track.id}
                          busy={busyId === track.id}
                          onPlay={() => togglePreview(track)}
                          onUse={() => void addTrack(track)}
                          onSave={() => toggleSaved(track.id)}
                          saved={isSaved(track.id)}
                          inUse={inUse(track.id)}
                        />
                      ))}
                  </div>
              </div>
              </div>
            )}

              {/* Browse */}
              {tab === 'browse' && (
                <div className="px-2">
                  {libraryTracks.length === 0 ? (
                    <p className="text-[11px] text-lo/60 text-center py-6">No tracks match your search.</p>
                  ) : (
                    <div className="grid gap-2">
                      {libraryTracks.map((track) => (
                        <LibraryTrackRow
                          key={track.id}
                          track={track}
                          playing={playingId === track.id}
                          busy={busyId === track.id}
                          onPlay={() => togglePreview(track)}
                          onUse={() => void addTrack(track)}
                          onSave={() => toggleSaved(track.id)}
                          saved={isSaved(track.id)}
                          inUse={inUse(track.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Saved */}
              {tab === 'saved' && (
                <div className="px-2">
                  {(() => {
                    const savedTracks = MUSIC_LIBRARY.tracks.filter((t) => isSaved(t.id))
                    if (savedTracks.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <Heart size={32} className="mx-auto mb-2 text-lo/30" />
                          <h3 className="text-sm font-semibold text-hi">No saved tracks yet</h3>
                          <p className="mt-0.5 text-[11px] text-lo/60">
                            Tap the heart on any track to save it here.
                          </p>
                        </div>
                      )
                    }
                    return (
                      <div className="grid gap-2">
                        {savedTracks.map((track) => (
                          <LibraryTrackRow
                            key={track.id}
                            track={track}
                            playing={playingId === track.id}
                            busy={busyId === track.id}
                            onPlay={() => togglePreview(track)}
                            onUse={() => void addTrack(track)}
                            onSave={() => toggleSaved(track.id)}
                            saved={true}
                            inUse={inUse(track.id)}
                          />
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Your Music */}
              {tab === 'yours' && (
                <div className="px-2">
                  {audioAssets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Disc2 size={32} className="mx-auto mb-2 text-lo/30" />
                      <h3 className="text-sm font-semibold text-hi">No imported audio yet</h3>
                      <p className="mt-0.5 text-[11px] text-lo/60">
                        Drop audio files into Frame Studio or import them in the Library.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {audioAssets.map((a) => (
                        <YourMusicRow
                          key={a.id}
                          asset={{ id: a.id, name: a.name, size: a.size, duration: a.duration }}
                          onUse={() => selectImported(a.id)}
                          inUse={music?.assetId === a.id}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            
            {error ? (
              <p className="px-2 flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <div className="px-2 mt-2 flex items-start gap-2 rounded-lg border border-line/70 bg-panel">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
              <div className="text-[10px] leading-relaxed text-lo">
                <p className="font-medium text-hi/90">Safe and offline</p>
                <p>
                  Bundled tracks are CC0 1.0 public domain, synthesized for Frame Studio, never streamed,
                  and copied into your project only when you use one.
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-lo/80">
                  <Disc2 size={10} aria-hidden />
                  {MUSIC_LIBRARY.tracks.length} tracks · no attribution required
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function findTrack(assetId: string | null): MusicLibraryTrack | null {
  if (!assetId) return null
  return MUSIC_LIBRARY.tracks.find((t) => t.file === assetId || t.id === assetId) ?? null
}

// Injected equalizer keyframe (kept out of global CSS so it scopes to this dialog).
if (typeof document !== 'undefined' && !document.getElementById('fs-eq-style')) {
  const style = document.createElement('style')
  style.id = 'fs-eq-style'
  style.textContent = `
    @keyframes fs-eq-bounce {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(1.6); }
    }
  `
  document.head.appendChild(style)
}
