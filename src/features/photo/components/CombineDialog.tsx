import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../../../ui/button'
import { Dialog, DialogContent, DialogClose } from '../../../ui/dialog'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { combineImages, type CombineLayout } from '../combineImages'
import { importFiles } from '../../library/import'
import { toast } from '../../../ui/toastStore'
import type { MediaAsset } from '../../../core/db/schema'

const LAYOUTS: Array<{ value: CombineLayout; label: string }> = [
  { value: 'row', label: 'Row' },
  { value: 'column', label: 'Column' },
  { value: 'grid', label: 'Grid' },
]

/**
 * Combine dialog: pick 2+ library photos and stitch them into one image —
 * the result is saved to the library via the normal import pipeline.
 */
export function CombineDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const [selected, setSelected] = useState<string[]>([])
  const [layout, setLayout] = useState<CombineLayout>('row')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assets = useAssets()
  const imageAssets = useMemo(() => (assets ?? []).filter((a) => a.kind === 'image'), [assets])

  useEffect(() => {
    if (open) {
      setSelected([])
      setLayout('row')
      setError(null)
    }
  }, [open])

  async function run(): Promise<void> {
    const picked = imageAssets.filter((a) => selected.includes(a.id))
    if (picked.length < 2) return
    setBusy(true)
    setError(null)
    try {
      const blob = await combineImages(picked, { layout })
      const { imported } = await importFiles([new File([blob], `combined-${picked.length}-images.png`, { type: 'image/png' })])
      if (imported.length > 0) {
        toast('Combined image saved', `Saved to the library as ${imported[0]?.name ?? 'combined image'}`, 'success')
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
          title="Combine images"
          description="Stitch 2+ photos into one — row, column or grid. Saved to the library."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="subtle" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" disabled={busy || selected.length < 2} onClick={() => void run()}>
                {busy ? 'Combining…' : 'Combine'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {imageAssets.map((a) => <ImageCard key={a.id} asset={a} checked={selected.includes(a.id)} onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />)}
              {imageAssets.length === 0 ? <p className="text-xs text-lo">No images in the library.</p> : null}
            </div>
            <label className="block space-y-1">
              <span className="block text-xs text-lo">Layout</span>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as CombineLayout)}
                aria-label="Combine layout"
                className="w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-hi outline-none focus-visible:border-accent"
              >
                {LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

const ImageCard = memo(function ImageCard({
  asset,
  checked,
  onToggle,
}: {
  asset: MediaAsset
  checked: boolean
  onToggle: (id: string) => void
}): ReactNode {
  const thumb = useThumbnail(asset)
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors"
      style={{ borderColor: checked ? 'var(--c-accent)' : 'var(--c-line)' }}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(asset.id)} aria-label={`Combine ${asset.name}`} />
      <span className="h-8 w-12 shrink-0 overflow-hidden rounded-sm bg-elevated">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-hi" title={asset.name}>{asset.name}</span>
    </label>
  )
})
