import type { ReactNode } from 'react'
import { useVideoEditor } from '../store'

/** Faint ticks along the track showing the music track's detected beats. */
export function BeatMarkers({ total, mobile }: { total: number; mobile: { pxPerSec: number; viewStart: number } | null }): ReactNode {
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
            style={mobile ? { left: (beat - mobile.viewStart) * mobile.pxPerSec } : { left: `${(beat / total) * 100}%` }}
          />
        ))}
    </div>
  )
}
