import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../../../ui/button'
import { Dialog, DialogContent, DialogClose } from '../../../ui/dialog'
import { useAssets, useAssetBlob } from '../../library/useAssets'
import { importFiles } from '../../library/import'
import { makePoster, type PosterLine } from '../makePoster'
import { toast } from '../../../ui/toastStore'
import type { MediaAsset } from '../../../core/db/schema'

/**
 * Poster maker: pick a photo, add title/subtitle/tagline lines with
 * independent sizes, and save the result to the library.
 */
export function PosterMakerDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const [title, setTitle] = useState('Title')
  const [subtitle, setSubtitle] = useState('Subtitle')
  const [tagline, setTagline] = useState('Tagline')
  const [titleSize, setTitleSize] = useState(0.065)
  const [subtitleSize, setSubtitleSize] = useState(0.035)
  const [taglineSize, setTaglineSize] = useState(0.03)
  const [assetId, setAssetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [poster, setPoster] = useState<Blob | null>(null)

  const assets = useAssets()
  const imageAssets = useMemo(() => (assets ?? []).filter((a) => a.kind === 'image'), [assets])
  const asset = useMemo<MediaAsset | null>(() => imageAssets.find((a) => a.id === assetId) ?? imageAssets[0] ?? null, [assetId, imageAssets])
  const blob = useAssetBlob(asset)

  useEffect(() => {
    if (open) {
      setTitle('Title')
      setSubtitle('Subtitle')
      setTagline('Tagline')
      setTitleSize(0.065)
      setSubtitleSize(0.035)
      setTaglineSize(0.03)
      setAssetId(null)
      setError(null)
      setPoster(null)
    }
  }, [open])

  // Live preview while typing / resizing.
  useEffect(() => {
    if (!open || !asset || !blob) return
    let alive = true
    void (async () => {
      const bmp = await createImageBitmap(blob)
      try {
        const p = await makePoster({
          source: bmp,
          lines: [
            { text: title.trim(), y: 0.08, fontSize: titleSize },
            { text: subtitle.trim(), y: 0.5, fontSize: subtitleSize },
            { text: tagline.trim(), y: 0.92, fontSize: taglineSize },
          ] satisfies PosterLine[],
        })
        if (alive) {
          setPreview(URL.createObjectURL(p))
          setPoster(p)
        }
      } catch {
        if (alive) setError('Could not render the poster.')
      } finally {
        bmp.close()
      }
    })()
    return () => {
      alive = false
    }
  }, [open, asset, blob, title, subtitle, tagline, titleSize, subtitleSize, taglineSize])

  useEffect(() => {
    if (!preview) return
    return () => {
      URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function save(): Promise<void> {
    if (!asset || !poster) return
    setBusy(true)
    setError(null)
    try {
      const { imported } = await importFiles([new File([poster], `poster-${asset.name}.jpg`, { type: 'image/jpeg' })])
      if (imported.length > 0) {
        toast('Poster saved', `Saved to the library as ${imported[0]?.name ?? 'poster'}`, 'success')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      {open ? (
        <DialogContent
          title="Create a poster"
          description="Add title, subtitle and tagline lines to a photo. Saved to the library."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="subtle" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" disabled={busy || !poster} onClick={() => void save()}>
                Save to library
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="block space-y-1">
              <span className="block text-xs text-lo">Photo</span>
              <select
                value={asset?.id ?? ''}
                onChange={(e) => setAssetId(e.target.value || null)}
                aria-label="Photo for the poster"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none focus-visible:border-accent"
              >
                {imageAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <PosterLineField label="Title" value={title} onChange={setTitle} size={titleSize} onSizeChange={setTitleSize} />
            <PosterLineField label="Subtitle" value={subtitle} onChange={setSubtitle} size={subtitleSize} onSizeChange={setSubtitleSize} />
            <PosterLineField label="Tagline" value={tagline} onChange={setTagline} size={taglineSize} onSizeChange={setTaglineSize} />

            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}

            {preview ? (
              <div className="overflow-hidden rounded-xl border border-line bg-elevated shadow-sm">
                <img src={preview} alt="Poster preview" className="h-auto w-full object-cover" />
              </div>
            ) : asset ? (
              <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line bg-elevated">
                <span className="text-xs text-lo">Rendering…</span>
              </div>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function PosterLineField({
  label,
  value,
  onChange,
  size,
  onSizeChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  size: number
  onSizeChange: (v: number) => void
}): ReactNode {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs text-lo">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={60}
          aria-label={`${label} line`}
          className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs text-hi outline-none focus-visible:border-accent"
        />
        <input
          type="range"
          min={0.02}
          max={0.25}
          step={0.01}
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          aria-label={`${label} size`}
          className="w-20 accent-[var(--c-accent)]"
        />
        <span className="w-7 text-right text-[10px] tabular-nums text-lo">{Math.round(size * 100)}</span>
      </div>
    </div>
  )
}
