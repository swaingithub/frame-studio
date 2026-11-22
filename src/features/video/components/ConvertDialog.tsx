import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../../../ui/button'
import { Dialog, DialogContent, DialogClose } from '../../../ui/dialog'
import { useAssets } from '../../library/useAssets'
import { WC_CANDIDATES, type WcFormat } from '../webcodecsExport'
import { convertVideoAsset } from '../convertVideo'
import { downloadBlob, sanitizeFileName } from '../../photo/exportPhoto'
import type { MediaAsset } from '../../../core/db/schema'

interface ConvertResult {
  status: 'idle' | 'converting' | 'done' | 'error'
  progress: number
  blob: Blob | null
  error: string | null
}

const FORMAT_LABELS: Record<string, string> = { 'video/mp4': 'MP4 H.264', 'video/webm': 'WebM VP9' }

const SCALE_OPTIONS = [
  { value: 1, label: '100%' },
  { value: 0.75, label: '75%' },
  { value: 0.5, label: '50%' },
  { value: 0.33, label: '33%' },
]

/**
 * Convert dialog: pick a video, target format + resolution, then convert —
 * re-encoded through WebCodecs entirely in the browser and downloaded.
 */
export function ConvertDialog({
  assetId,
  open,
  onClose,
}: {
  assetId: string | null
  open: boolean
  onClose: () => void
}): ReactNode {
  const assets = useAssets()
  const videoAssets = useMemo(() => (assets ?? []).filter((a) => a.kind === 'video'), [assets])
  const initialAsset = useMemo<MediaAsset | null>(() => {
    const byId = videoAssets.find((a) => a.id === assetId)
    return byId ?? videoAssets[0] ?? null
  }, [assetId, videoAssets])

  const [asset, setAsset] = useState<MediaAsset | null>(initialAsset)
  const [format, setFormat] = useState<WcFormat>(WC_CANDIDATES[0])
  const [scale, setScale] = useState(1)
  const [state, setState] = useState<ConvertResult>({ status: 'idle', progress: 0, blob: null, error: null })

  useEffect(() => {
    if (open) {
      setAsset(initialAsset)
      setFormat(WC_CANDIDATES[0])
      setScale(1)
      setState({ status: 'idle', progress: 0, blob: null, error: null })
    }
  }, [open, initialAsset])

  const busy = state.status === 'converting'
  const done = state.status === 'done'

  async function run(): Promise<void> {
    if (!asset) return
    setState({ status: 'converting', progress: 0, blob: null, error: null })
    try {
      const blob = await convertVideoAsset(asset.id, {
        format,
        scale,
        onProgress: (t, total) =>
          setState((s) => (s.status === 'converting' ? { ...s, progress: total > 0 ? t / total : 0 } : s)),
      })
      setState({ status: 'done', progress: 1, blob, error: null })
    } catch (err) {
      setState({ status: 'error', progress: 0, blob: null, error: err instanceof Error ? err.message : String(err) })
    }
  }

  function download(): void {
    const blob = state.blob
    if (!blob || !asset) return
    downloadBlob(blob, `${sanitizeFileName(asset.name)}-converted.${format.ext}`)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      {open ? (
        <DialogContent
          title="Convert video"
          description="Re-encode this video to another format. Runs in your browser — the file stays on this device."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="subtle" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              {done ? (
                <Button variant="primary" onClick={download}>
                  Download
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void run()} disabled={busy || !asset}>
                  Convert
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="block space-y-1">
              <span className="block text-xs text-lo">Video</span>
              <select
                value={asset?.id ?? ''}
                onChange={(e) => setAsset(videoAssets.find((a) => a.id === e.target.value) ?? null)}
                aria-label="Video to convert"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none focus-visible:border-accent"
              >
                {videoAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="block text-xs text-lo">Format</span>
              <select
                value={format.ext}
                onChange={(e) => setFormat(WC_CANDIDATES.find((c) => c.ext === e.target.value) ?? WC_CANDIDATES[0])}
                aria-label="Output format"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none focus-visible:border-accent"
              >
                {WC_CANDIDATES.map((c) => (
                  <option key={c.ext} value={c.ext}>
                    {FORMAT_LABELS[c.mime] ?? c.mime}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="block text-xs text-lo">Resolution</span>
              <select
                value={String(scale)}
                onChange={(e) => setScale(Number(e.target.value))}
                aria-label="Resolution scale"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none focus-visible:border-accent"
              >
                {SCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {busy ? (
              <div role="progressbar" aria-label="Video conversion progress" className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </div>
            ) : null}
            {state.error ? <p className="text-xs text-danger" role="alert">{state.error}</p> : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
