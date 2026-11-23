import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../../ui/button'
import { Dialog, DialogContent, DialogClose } from '../../ui/dialog'
import { useAssets, useAssetBlob } from '../library/useAssets'
import { generateMeme } from './memeGen'
import { downloadBlob, sanitizeFileName } from '../../lib/download'
import type { MediaAsset } from '../../core/db/schema'

/**
 * Meme generator dialog: pick a photo from the library, add a top line and
 * a bottom line, generate — the meme previews immediately and can be
 * downloaded as a PNG.
 */
export function MemeDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memeBlob, setMemeBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [top, setTop] = useState('')
  const [bottom, setBottom] = useState('')
  const [assetId, setAssetId] = useState<string | null>(null)

  const assets = useAssets()
  const imageAssets = useMemo(() => (assets ?? []).filter((a) => a.kind === 'image'), [assets])
  const asset = useMemo<MediaAsset | null>(() => {
    if (assetId) {
      const found = imageAssets.find((a) => a.id === assetId)
      if (found) return found
    }
    return imageAssets[0] ?? null
  }, [imageAssets, assetId])
  const blob = useAssetBlob(asset)

  // Reset when the dialog opens.
  useEffect(() => {
    if (open) {
      setTop('')
      setBottom('')
      setAssetId(null)
      setMemeBlob(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!memeBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(memeBlob)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [open, memeBlob])

  async function generate(): Promise<void> {
    if (!asset || !blob) return
    setBusy(true)
    setError(null)
    try {
      const bitmap = await createImageBitmap(blob)
      try {
        const meme = await generateMeme({ source: bitmap, top, bottom })
        setMemeBlob(meme)
      } finally {
        bitmap.close()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canGenerate = Boolean(asset && blob && (top.trim() || bottom.trim()))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      {open ? (
        <DialogContent
          title="Meme generator"
          description="Pick a photo, add a top line and a bottom line, then generate the meme."
          wide
          footer={
            <>
              <DialogClose asChild>
                <Button variant="subtle" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" disabled={busy || !canGenerate} onClick={() => void generate()}>
                {busy ? 'Generating…' : 'Generate'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="block space-y-1">
              <span className="block text-xs text-lo">Photo</span>
              <select
                value={asset?.id ?? ''}
                disabled={imageAssets.length <= 1}
                onChange={(e) => setAssetId(e.target.value || null)}
                aria-label="Photo to meme-ify"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none disabled:opacity-40"
              >
                {imageAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-xs text-lo">Top line</span>
                <input
                  value={top}
                  onChange={(e) => setTop(e.target.value)}
                  placeholder="e.g. When the timeline works…"
                  aria-label="Top line of the meme"
                  className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none placeholder:text-lo focus-visible:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-lo">Bottom line</span>
                <input
                  value={bottom}
                  onChange={(e) => setBottom(e.target.value)}
                  placeholder="e.g. and the music stops."
                  aria-label="Bottom line of the meme"
                  className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none placeholder:text-lo focus-visible:border-accent"
                />
              </label>
            </div>

            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}

            {previewUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-line bg-elevated">
                <img src={previewUrl} alt="Generated meme" className="max-h-64 w-full object-cover" />
              </div>
            ) : null}

            {memeBlob ? (
              <Button
                variant="primary"
                disabled={!memeBlob}
                onClick={() => {
                  const name = `${sanitizeFileName(asset?.name ?? 'meme')}-meme.png`
                  downloadBlob(memeBlob, name)
                  onClose()
                }}
              >
                Download meme
              </Button>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
