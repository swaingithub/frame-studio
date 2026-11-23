import { useState, type ReactNode } from 'react'
import {
  HSL_CHANNELS,
  HSL_CHANNEL_LABELS,
  HSL_CHANNEL_SWATCH,
  isNeutralHsl,
  type HslChannel,
  type HslMixer,
} from '../../../core/adjustments/color'
import { AdjustSlider } from '../../../ui/adjustSlider'
import { usePhotoEditor } from '../store'
import { cn } from '../../../lib/cn'

interface HslPanelProps {
  mixer: HslMixer
  collapsed: boolean
  onToggle: () => void
}

export function HslPanel({ mixer, collapsed, onToggle }: HslPanelProps): ReactNode {
  const editor = usePhotoEditor()
  const [channel, setChannel] = useState<HslChannel>('red')
  const band = mixer[channel]
  const touched = !isNeutralHsl(mixer)

  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-lo hover:text-hi"
        aria-expanded={!collapsed}
      >
        HSL
        {touched ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Adjusted" /> : null}
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="HSL color range">
            {HSL_CHANNELS.map((ch) => {
              const dirty = mixer[ch].hue !== 0 || mixer[ch].sat !== 0 || mixer[ch].lum !== 0
              return (
                <button
                  key={ch}
                  type="button"
                  role="tab"
                  aria-selected={channel === ch}
                  aria-label={HSL_CHANNEL_LABELS[ch]}
                  title={HSL_CHANNEL_LABELS[ch]}
                  onClick={() => setChannel(ch)}
                  className={cn(
                    'relative h-6 w-6 rounded-full ring-1 ring-white/15 transition-transform',
                    channel === ch && 'scale-110 ring-2 ring-accent',
                  )}
                  style={{ background: HSL_CHANNEL_SWATCH[ch] }}
                >
                  {dirty ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-hi" /> : null}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-lo">{HSL_CHANNEL_LABELS[channel]}</p>
          {(
            [
              ['hue', 'Hue'],
              ['sat', 'Saturation'],
              ['lum', 'Luminance'],
            ] as const
          ).map(([key, label]) => (
            <AdjustSlider
              key={key}
              param={{ label, min: -100, max: 100, def: 0 }}
              value={band[key]}
              onLive={(v) => editor.setHslLive(channel, { [key]: Math.round(v) })}
              onCommit={() => editor.commit(`${HSL_CHANNEL_LABELS[channel]} ${label}`)}
              onReset={() => {
                editor.setHslLive(channel, { [key]: 0 })
                editor.commit(`${HSL_CHANNEL_LABELS[channel]} ${label} reset`)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
