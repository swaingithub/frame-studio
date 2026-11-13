import { useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Dialog, DialogContent } from '../../../ui/dialog'
import { Button } from '../../../ui/button'
import { toast } from '../../../ui/toastStore'
import { exportPhoto, renderPhotoBlob, sanitizeFileName, toPngBlob, downloadBlob, type ExportFormat } from '../exportPhoto'
import { getFullSource, loadSource } from './EditorCanvas'
import { usePhotoEditor } from '../store'
import { Share2 } from 'lucide-react'
import { useAssetBlob } from '../../library/useAssets'
import type { MediaAsset } from '../../../core/db/schema'

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
]

const SIZES = [
  { label: 'Original size', value: null },
  { label: '4096 px', value: 4096 },
  { label: '2048 px', value: 2048 },
  { label: '1024 px', value: 1024 },
] as const

interface ExportDialogProps {
  asset: MediaAsset
  open: boolean
  onClose: () => void
}

export function ExportDialog({ asset, open, onClose }: ExportDialogProps): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const [format, setFormat] = useState<ExportFormat>('image/jpeg')
  const [quality, setQuality] = useState(92)
  const [maxEdge, setMaxEdge] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const blob = useAssetBlob(asset)

  async function runExport(): Promise<void> {
    if (!doc) return
    setBusy(true)
    try {
      let full = getFullSource(asset.id)
      if (!full && blob) {
        const entry = await loadSource(asset.id, blob)
        full = entry.full
      }
      if (!full) throw new Error('Source is no longer available')
      const name = await exportPhoto(full, doc, {
        format,
        quality,
        maxEdge,
        baseName: sanitizeFileName(asset.name),
      })
      toast('Export complete', name, 'success')
      onClose()
    } catch (err) {
      toast('Export failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Native share sheet (phones) with clipboard/download fallbacks. */
  async function shareExport(): Promise<void> {
    if (!doc) return
    setBusy(true)
    try {
      let full = getFullSource(asset.id)
      if (!full && blob) {
        const entry = await loadSource(asset.id, blob)
        full = entry.full
      }
      if (!full) throw new Error('Source is no longer available')
      const { name, blob: fileBlob } = await renderPhotoBlob(full, doc, {
        format,
        quality,
        maxEdge,
        baseName: sanitizeFileName(asset.name),
      })
      const file = new File([fileBlob], name, { type: format })
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: name })
        onClose()
      } else if ('ClipboardItem' in window) {
        // Clipboard accepts PNG broadly; transcode if needed.
        const imageBlob = format === 'image/png' ? fileBlob : await toPngBlob(full, doc, { quality, maxEdge })
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })])
        toast('Copied to clipboard', 'Paste it into any app', 'success')
        onClose()
      } else {
        downloadBlob(fileBlob, name)
        toast('Sharing not supported here', 'Downloaded instead', 'info')
        onClose()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      toast('Share failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!asset) return null
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      {open ? (
        <DialogContent
          title={`Export ${asset.name}`}
          description="Rendered in your browser at full resolution. Canvas re-encoding always strips EXIF and other metadata."
          footer={
            <>
              <Button variant="subtle" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="subtle" disabled={busy} onClick={() => void shareExport()}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
                Share
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void runExport()}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Export
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <label className="block space-y-1.5">
              <span className="block text-xs text-lo">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none"
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="block text-xs text-lo">
                Quality <span className="tabular-nums text-hi">{format === 'image/png' ? 'lossless' : quality}</span>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={quality}
                disabled={format === 'image/png'}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full accent-[var(--c-accent)] disabled:opacity-40"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="block text-xs text-lo">Resize (longest edge)</span>
              <select
                value={maxEdge === null ? 'orig' : String(maxEdge)}
                onChange={(e) => setMaxEdge(e.target.value === 'orig' ? null : Number(e.target.value))}
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none"
              >
                {SIZES.map((s) => (
                  <option key={s.label} value={s.value === null ? 'orig' : String(s.value)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-start gap-2 text-xs text-lo">
              <input type="checkbox" checked disabled className="mt-0.5 accent-[var(--c-accent)]" />
              Strip metadata (EXIF, GPS) — inherent to canvas re-encoding
            </label>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
