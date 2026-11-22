import { Speaker, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDuration } from '../../../core/format'
import type { MediaAsset } from '../../../core/db/schema'
import type { VoiceoverClip } from '../sequenceModel'

/** Voiceover track row: Kokoro TTS clips positioned by start/duration. */
export function VoiceoverRow({
  voiceovers,
  total,
  assets,
  onRemove,
}: {
  voiceovers: VoiceoverClip[]
  total: number
  assets: MediaAsset[]
  onRemove: (id: string) => void
}): ReactNode {
  const pos = (seconds: number, span: number): string =>
    `${Math.max(0, Math.min(100, (seconds / Math.max(0.001, span)) * 100))}%`
  return (
    <div className="relative h-9 min-w-0 rounded-md bg-elevated" aria-label="Voiceover track">
      <div className="absolute inset-y-0 left-0 w-[88%] rounded-sm bg-stage" aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-0.5 text-[9px] font-semibold uppercase tracking-wide text-lo" aria-hidden>
        VO
      </span>
      {voiceovers.map((v) => {
        const asset = assets.find((a) => a.id === v.assetId) ?? null
        const name = asset?.name ?? 'Voiceover'
        return (
          <div
            key={v.id}
            role="group"
            aria-label={`Voiceover: ${name}`}
            className="absolute inset-y-0 flex items-center gap-1.5 rounded-sm border border-line bg-panel px-1.5 shadow-sm"
            style={{
              left: pos(v.start, total),
              width: `${Math.max(6, Math.min(100, (v.duration / Math.max(0.001, total)) * 100))}%`,
            }}
          >
            <Speaker size={11} className="shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[10px] text-hi" title={name}>
              {name}
            </span>
            <span className="shrink-0 tabular-nums text-[9px] text-lo">{formatDuration(v.duration)}</span>
            <button
              type="button"
              aria-label={`Remove voiceover ${name}`}
              className="fs-tool-hit rounded p-0.5 text-lo hover:bg-hover hover:text-danger"
              onClick={() => onRemove(v.id)}
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
