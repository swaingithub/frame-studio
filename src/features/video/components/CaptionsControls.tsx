import { useState, type ReactNode } from 'react'
import { Captions, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { useVideoEditor } from '../store'
import { useCaptions, type CaptionStatus } from '../useCaptions'
import { Heading } from './InspectorUi'

const CAPTION_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto-detect' },
  { value: 'english', label: 'English' },
  { value: 'chinese', label: '中文' },
  { value: 'japanese', label: '日本語' },
  { value: 'korean', label: '한국어' },
  { value: 'spanish', label: 'Español' },
  { value: 'french', label: 'Français' },
  { value: 'german', label: 'Deutsch' },
  { value: 'portuguese', label: 'Português' },
  { value: 'russian', label: 'Русский' },
]

const STATUS_LABELS: Record<CaptionStatus, string> = {
  idle: '',
  'loading-model': 'Loading speech model…',
  decoding: 'Reading audio…',
  transcribing: 'Transcribing…',
  done: 'Captions added to the timeline',
  error: '',
}

/**
 * Auto-captions: transcribes every clip's audio locally (Whisper WASM in a
 * worker) and lays the chunks onto the timeline as text overlays. The model
 * downloads once on first use, then runs fully offline.
 */
export function CaptionsControls(): ReactNode {
  const hasCaptions = useVideoEditor((s) => s.overlays.some((o) => o.caption))
  const clearCaptions = useVideoEditor((s) => s.clearCaptions)
  const { status, progress, error, busy, generate } = useCaptions()
  const [language, setLanguage] = useState('')

  const firstUse = status === 'loading-model'
  return (
    <section>
      <Heading icon={<Captions size={11} />}>
        Auto captions
      </Heading>
      <div className="flex items-center gap-1.5">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label="Caption language"
          disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none"
        >
          {CAPTION_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate(language || undefined)}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-onaccent hover:brightness-110 disabled:opacity-40"
        >
          <Sparkles size={12} />
          {hasCaptions ? 'Regenerate' : 'Generate'}
        </button>
        {hasCaptions && !busy ? (
          <button
            type="button"
            onClick={clearCaptions}
            aria-label="Remove captions"
            title="Remove captions"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elevated text-lo hover:bg-hover hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
      </div>
      {busy ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label="Caption progress">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {STATUS_LABELS[status] ? <p className="mt-1.5 text-[10px] text-lo">{STATUS_LABELS[status]}</p> : null}
      {firstUse ? (
        <p className="mt-1.5 text-[10px] leading-snug text-lo">
          First run downloads the speech model (~40 MB) — after that it stays on this device and works offline.
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-danger">
          <TriangleAlert size={11} className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  )
}
