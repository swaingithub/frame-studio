import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { Button } from '../../../ui/button'
import { Heading } from './InspectorUi'
import { getBlob } from '../../../core/db/blobStore'
import { formatDuration } from '../../../core/format'
import { importFiles } from '../../library/import'
import { toast } from '../../../ui/toastStore'
import { useAssets } from '../../library/useAssets'
import { useVideoEditor } from '../store'
import { buildVoiceSyncKeyframes } from '../manhwa'
import { generateVoiceover, kokoroVoiceNames } from '../voiceover'
import { transcribeVoiceoverWav } from '../voiceoverCaptions'

/**
 * Manhwa workflow: per-panel Kokoro voiceover + animation synced to the
 * voice. The panel (image overlay) fades in as the voice speaks, swells
 * mid-voice and reacts to each Whisper segment — see `manhwa.ts`.
 */
export function ManhwaSection(): ReactNode {
  const overlays = useVideoEditor((s) => s.overlays)
  const voiceovers = useVideoEditor((s) => s.voiceovers)
  const addVoiceover = useVideoEditor((s) => s.addVoiceover)
  const syncOverlayToVoice = useVideoEditor((s) => s.syncOverlayToVoice)
  const assets = useAssets()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('af_heart')
  const [voices, setVoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [busySync, setBusySync] = useState(false)
  const [panelId, setPanelId] = useState('')
  const [voiceoverId, setVoiceoverId] = useState('')

  const panels = overlays.filter((o) => o.kind === 'image')
  const panel = panels.find((o) => o.id === panelId) ?? panels[panels.length - 1] ?? null
  const voiceover = voiceovers.find((v) => v.id === voiceoverId) ?? voiceovers[voiceovers.length - 1] ?? null

  useEffect(() => {
    let alive = true
    void kokoroVoiceNames()
      .then((names) => {
        if (!alive) return
        setVoices(names)
        setVoice((v) => {
          if (names.includes(v)) return v
          // Kokoro Hindi voices start with 'h' (hf_*, hm_*).
          const hindi = names.find((n) => n.startsWith('h'))
          return hindi ?? names[0] ?? v
        })
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
        toast('Voiceover added', 'Added to the timeline — now sync the panel to it.', 'success')
        setText('')
      }
    } catch (err) {
      toast('Voiceover failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function sync(): Promise<void> {
    if (!panel || !voiceover || busySync) return
    setBusySync(true)
    try {
      const asset = (assets ?? []).find((a) => a.id === voiceover.assetId)
      if (!asset) throw new Error('Voiceover asset not found.')
      const blob = await getBlob({ key: asset.storageKey, storage: asset.storage ?? 'idb' })
      if (!blob) throw new Error('Voiceover audio not available.')
      const segments = await transcribeVoiceoverWav(blob)
      syncOverlayToVoice(
        panel.id,
        { start: voiceover.start, duration: voiceover.duration },
        buildVoiceSyncKeyframes(segments, voiceover.duration),
      )
      toast('Panel synced', 'The panel now fades in as the voice speaks and swells in sync.', 'success')
    } catch (err) {
      toast('Sync failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusySync(false)
    }
  }

  return (
    <section aria-label="Manhwa">
      <Heading icon={<BookOpen size={11} />}>Manhwa</Heading>
      <p className="mt-1.5 text-[10px] text-lo">
        Per-panel voiceover (Kokoro: Hindi, English, or mixed) + panel animation synced to the voice.
      </p>

      <div className="mt-2 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Panel voiceover text…"
          aria-label="Manhwa panel voiceover"
          className="w-full resize-none rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
        />
        <div className="flex items-center gap-2">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={voices.length === 0}
            aria-label="Manhwa voice"
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
          <Button
            variant="subtle"
            size="sm"
            disabled={busy || voices.length === 0 || !text.trim()}
            onClick={() => void generate()}
          >
            {busy ? 'Generating…' : 'Generate voice'}
          </Button>
        </div>

        {panels.length > 0 ? (
          <div className="space-y-1">
            <span className="text-[10px] text-lo">Panel</span>
            <select
              value={panel?.id ?? ''}
              onChange={(e) => setPanelId(e.target.value)}
              aria-label="Manhwa panel"
              className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
            >
              {panels.map((o) => {
                const name = o.assetId ? assets?.find((a) => a.id === o.assetId)?.name ?? 'Panel' : 'Panel'
                return (
                  <option key={o.id} value={o.id}>
                    {name}
                  </option>
                )
              })}
            </select>
          </div>
        ) : (
          <p className="text-[10px] text-lo">Add the manhwa panel as an image overlay on the timeline.</p>
        )}

        {voiceovers.length > 0 ? (
          <div className="space-y-1">
            <span className="text-[10px] text-lo">Voiceover</span>
            <select
              value={voiceover?.id ?? ''}
              onChange={(e) => setVoiceoverId(e.target.value)}
              aria-label="Manhwa voiceover"
              className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi outline-none focus-visible:border-accent"
            >
              {voiceovers.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatDuration(v.start)} → +{formatDuration(v.duration)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <Button variant="primary" size="sm" disabled={!panel || !voiceover || busySync} onClick={() => void sync()}>
          {busySync ? 'Syncing…' : 'Sync panel to voice'}
        </Button>
      </div>
    </section>
  )
}
