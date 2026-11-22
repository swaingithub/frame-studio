import { useState, type ReactNode } from 'react'
import { ListMusic, Music2, X } from 'lucide-react'
import { AdjustSlider } from '../../photo/components/AdjustSlider'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { useVideoEditor } from '../store'
import { MusicLibraryDialog } from './MusicLibraryDialog'
import { BeatControls } from './BeatControls'

export function MusicSection(): ReactNode {
  const music = useVideoEditor((s) => s.music)
  const setMusic = useVideoEditor((s) => s.setMusic)
  const setMusicVolumeLive = useVideoEditor((s) => s.setMusicVolumeLive)
  const commitMusicVolume = useVideoEditor((s) => s.commitMusicVolume)
  const setMusicDuck = useVideoEditor((s) => s.setMusicDuck)
  const assets = useAssets()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const audioAssets = (assets ?? []).filter((a) => a.kind === 'audio')
  const chosen = music ? (assets ?? []).find((a) => a.id === music.assetId) ?? null : null
  const thumb = useThumbnail(chosen)

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo">
          <Music2 size={11} />
          Music
        </h3>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[10px] font-semibold text-hi transition-colors hover:bg-hover"
        >
          <ListMusic size={11} aria-hidden />
          Library
        </button>
      </div>
      {audioAssets.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-2 py-1.5 text-[11px] text-lo">
          <p>Pick a free CC0 track from the built-in library, or import your own audio in the Library.</p>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="mt-1 font-semibold text-accent hover:underline"
          >
            Browse music library
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {thumb ? <img src={thumb} alt="" className="h-7 w-7 rounded object-cover" aria-hidden /> : null}
            <select
              value={music?.assetId ?? ''}
              onChange={(e) => setMusic(e.target.value === '' ? null : e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
              aria-label="Music track"
            >
              <option value="">No music</option>
              {audioAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {music ? (
              <button type="button" onClick={() => setMusic(null)} className="rounded-md p-1 text-lo hover:bg-hover hover:text-hi" aria-label="Remove music">
                <X size={12} />
              </button>
            ) : null}
          </div>
          {music ? (
            <AdjustSlider
              param={{ label: 'Music level', min: 0, max: 100, def: 40 }}
              value={music.volume}
              onLive={setMusicVolumeLive}
              onCommit={() => commitMusicVolume()}
              onReset={() => {
                setMusicVolumeLive(40)
                commitMusicVolume()
              }}
            />
          ) : null}
          {music ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-lo" id="music-duck-label">Auto-duck under clip audio</span>
              <button
                type="button"
                role="switch"
                aria-checked={music.duck !== false}
                aria-labelledby="music-duck-label"
                onClick={() => setMusicDuck(music.duck === false)}
                className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${music.duck !== false ? 'bg-accent' : 'bg-elevated border border-line'}`}
              >
                <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${music.duck !== false ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          ) : null}
          {music ? <BeatControls /> : null}
        </div>
      )}
      <MusicLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </section>
  )
}
