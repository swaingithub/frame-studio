import type { ReactNode } from 'react'
import type { MediaAsset } from '../../../core/db/schema'
import { useWaveform } from '../waveform'

/** CapCut-style symmetric audio waveform drawn along the clip's bottom edge. */
export function ClipWaveform({ asset }: { asset?: MediaAsset | null }): ReactNode {
  const peaks = useWaveform(asset && asset.kind !== 'image' ? asset : null)
  if (!peaks || peaks.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-x-1 bottom-1 z-[2] flex h-2.5 items-center gap-px" aria-hidden>
      {peaks.map((p, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-full bg-white/75"
          style={{ height: `${Math.max(10, p * 100)}%` }}
        />
      ))}
    </div>
  )
}
