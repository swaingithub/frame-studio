import { useEffect, useState, type ReactNode } from 'react'
import { Speaker } from 'lucide-react'
import { Button } from '../../../ui/button'
import { getBlob } from '../../../core/db/blobStore'
import { generateVoiceover, kokoroVoiceNames } from '../voiceover'
import { transcribeVoiceoverWav } from '../voiceoverCaptions'
import { importFiles } from '../../library/import'
import { toast } from '../../../ui/toastStore'
import { useAssets } from '../../library/useAssets'
import { useVideoEditor } from '../store'
import type { CaptionSegment } from '../captions'
import { Heading } from './InspectorUi'

/** Voiceover: generate Kokoro speech from pasted text, added to the timeline. */
export function VoiceoverSection(): ReactNode {
  const addVoiceover = useVideoEditor((s) => s.addVoiceover)
  const addVoiceoverCaptions = useVideoEditor((s) => s.addVoiceoverCaptions)
  const voiceovers = useVideoEditor((s) => s.voiceovers)
  const assets = useAssets()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('af_heart')
  const [voices, setVoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [transcript, setTranscript] = useState<{ voiceoverId: string; text: string; segments: CaptionSegment[] } | null>(null)
  const [transcribingId, setTranscribingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void kokoroVoiceNames()
      .then((names) => {
        if (!alive) return
        setVoices(names)
        setVoice((v) => (names.includes(v) ? v : (names[0] ?? v)))
      })
      .catch((err) => console.error('Kokoro voices unavailable', err))
    return () => {
      alive = false
    }
  }, [])

  async function generate(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const { blob, duration } = await generateVoiceover(trimmed, voice)
      const name = `voiceover-${new Date().toISOString().replace(/[:.]/g, '')}.wav`
      const { imported } = await importFiles([new File([blob], name, { type: 'audio/wav' })])
      const assetId = imported[0]?.id
      if (assetId) {
        addVoiceover(assetId, duration)
        toast('Voiceover added', `"${trimmed.slice(0, 24)}" — added to the timeline at the end of the video.`, 'success')
        setText('')
      }
    } catch (err) {
      toast('Voiceover failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function transcribe(voiceoverId: string): Promise<void> {
    setTranscribingId(voiceoverId)
    try {
      const asset = (assets ?? []).find((a) => a.id === voiceovers.find((v) => v.id === voiceoverId)?.assetId)
      if (!asset) throw new Error('Voiceover asset not found.')
      const blob = await getBlob({ key: asset.storageKey, storage: asset.storage ?? 'idb' })
      if (!blob) throw new Error('Voiceover audio not available.')
      const segments = await transcribeVoiceoverWav(blob)
      setTranscript({ voiceoverId, text: segments.map((s) => s.text).join(' '), segments })
    } catch (err) {
      toast('Transcription failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setTranscribingId(null)
    }
  }

  function addTranscript(): void {
    if (!transcript) return
    addVoiceoverCaptions(transcript.voiceoverId, transcript.segments)
    setTranscript(null)
    toast('Voiceover captions added', 'Captions were added to the timeline as text overlays.', 'success')
  }

  return (
    <section aria-label="Voiceover">
      <Heading icon={<Speaker size={11} />}>Voiceover</Heading>
      <p className="mt-1.5 text-[10px] text-lo">
        Generates speech from text — Kokoro, on-device (first use downloads ~92 MB).
      </p>
      <div className="mt-2 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Type the voiceover text…"
          aria-label="Voiceover text"
          className="w-full resize-none rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
        />
        <div className="flex items-center gap-2">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={voices.length === 0}
            aria-label="Voiceover voice"
            className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
          >
            {voices.length === 0 ? (
              <option value="">Loading voices…</option>
            ) : (
              voices.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, ' ')}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={busy || voices.length === 0 || !text.trim()}
            onClick={() => void generate()}
            className="fs-tool-hit shrink-0 rounded-md border border-dashed border-accent/50 bg-panel px-2.5 py-1.5 text-[11px] font-medium text-hi transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {/* Captions: transcribe a voiceover to timeline captions (Whisper). */}
        {voiceovers.length > 0 ? (
          <div className="mt-2 space-y-2 border-t border-line pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-lo">Captions</span>
            {transcript ? (
              <div className="rounded-md border border-line bg-elevated px-2 py-1.5">
                <p className="max-h-28 overflow-y-auto text-[10px] leading-relaxed text-hi">{transcript.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-lo">
                    {transcript.segments.length} segment{transcript.segments.length === 1 ? '' : 's'} — Whisper, on-device
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="subtle" size="sm" onClick={() => setTranscript(null)}>
                      Dismiss
                    </Button>
                    <Button variant="primary" size="sm" onClick={addTranscript}>
                      Add to timeline
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <select
                value={transcript?.voiceoverId ?? ''}
                onChange={(e) => {
                  if (e.target.value) void transcribe(e.target.value)
                }}
                disabled={transcribingId !== null}
                aria-label="Transcribe voiceover"
                className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
              >
                <option value="">Transcribe a voiceover…</option>
                {voiceovers.map((v) => {
                  const name = (assets ?? []).find((a) => a.id === v.assetId)?.name ?? v.id
                  return (
                    <option key={v.id} value={v.id}>
                      {v.id === transcript?.voiceoverId ? '✓ ' : ''}
                      {name}
                    </option>
                  )
                })}
              </select>
              {transcribingId ? <span className="text-[10px] text-lo">Transcribing…</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
