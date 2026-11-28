import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCurrentProject, useProjectsStore } from '../../projects/store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { useImport } from '../../library/components/useImport'
import { assetsByIds } from '../../../core/projectAssets'
import { Button } from '../../../ui/button'
import { Clapperboard, Image as ImageIcon, Info, Trash2, UploadCloud } from 'lucide-react'
import type { MediaAsset } from '../../../core/db/schema'
import type { ReactNode } from 'react'
import { EditorCanvas } from '../../photo/components/EditorCanvas'
import { ExportDialog } from '../../photo/components/ExportDialog'
import { usePhotoEditor } from '../../photo/store'
import type { Histogram } from '../../../core/render/histogram'
import { ManageProjectsDialog } from '../../projects/components/Projects'
import { MobileEditBar } from './MobileEditBar'
import { useMediaQuery, PHONE_QUERY } from '../../../ui/useMediaQuery'

/**
 * Photo workspace (Phase 2): interactive editor canvas with live adjustments,
 * crop/compare, export — plus the project filmstrip and metadata card.
 */

export function PhotoWorkspace(): ReactNode {
  const project = useCurrentProject()
  const assets = useAssets()
  const [manageOpen, setManageOpen] = useState(false)
  const { pickFiles } = useImport()
  const [exportOpen, setExportOpen] = useState(false)
  const setHistogram = usePhotoEditor((s) => s.setHistogram)
  const updateCurrent = useProjectsStore((s) => s.updateCurrent)
  const removeAssetFromCurrent = useProjectsStore((s) => s.removeAssetFromCurrent)
  const setActivePhoto = usePhotoEditor((s) => s.setActivePhoto)
  const phone = useMediaQuery(PHONE_QUERY)

  const photos = useMemo(
    () => (assets && project ? assetsByIds(assets, project.photoAssets) : []),
    [assets, project],
  )
  const active = useMemo(
    () => photos.find((p) => p.id === project?.activePhotoId) ?? null,
    [photos, project],
  )

  // Keep the editor store synced with the filmstrip selection.
  useEffect(() => {
    setActivePhoto(active?.id ?? null)
  }, [active?.id, setActivePhoto])

  const handleHistogram = useCallback((h: Histogram | null) => setHistogram(h), [setHistogram])

  if (!project) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Editor stage */}
      <div className="relative flex min-h-0 flex-1 items-stretch bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--c-stage)_78%,white),var(--c-stage)_72%)] p-3 sm:p-5 lg:p-8 dark:bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--c-stage)_82%,white),var(--c-stage)_72%)]">
        {active ? (
          <>
            <EditorCanvas
              asset={active}
              onHistogram={handleHistogram}
              onExport={() => setExportOpen(true)}
              hideActions={phone}
            />
            <ExportDialog asset={active} open={exportOpen} onClose={() => setExportOpen(false)} />
          </>
          ) : photos.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft"><ImageIcon size={26} className="text-accent" /></span>
            <div>
              <p className="text-base font-semibold text-hi">Create your first edit</p>
              <p className="mt-1 max-w-80 text-sm text-lo">Add a photo from the Library, then choose a Look and crop it for where you want to share it.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-[10px] text-lo"><span className="rounded-full bg-elevated px-2.5 py-1">1 · Add a photo</span><span className="rounded-full bg-elevated px-2.5 py-1">2 · Make it yours</span><span className="rounded-full bg-elevated px-2.5 py-1">3 · Export</span></div>
            <button type="button" onClick={() => void pickFiles()} className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-onaccent shadow-sm transition hover:brightness-110">
              <UploadCloud size={15} /> Import a photo
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-lo">
            Select a photo from the filmstrip below
          </div>
        )}
      </div>

      {/* CapCut-style thumb bar (phones only) */}
      {phone && active ? <MobileEditBar onExport={() => setExportOpen(true)} /> : null}

      {/* Filmstrip */}
      <div className="shrink-0 border-t border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-lo">Photos in project</h3>
          <Button size="sm" variant="subtle" onClick={() => setManageOpen(true)}>
            <Info size={12} />
            Projects…
          </Button>
          {photos.length > 0 ? (
            <button
              type="button"
              className="ml-auto text-[10px] text-lo hover:text-hi"
              onClick={() => updateCurrent((doc) => ({ ...doc, photoAssets: [], activePhotoId: null }))}
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="flex gap-2 overflow-x-auto p-3">
          {photos.length === 0 ? (
            <div className="flex h-20 items-center text-xs text-lo">No photos in this project yet.</div>
          ) : (
            photos.map((p) => (
              <FilmstripItem
                key={p.id}
                asset={p}
                active={p.id === project.activePhotoId}
                onClick={() => updateCurrent((doc) => ({ ...doc, activePhotoId: p.id }))}
                onRemove={() => removeAssetFromCurrent(p.id)}
              />
            ))
          )}
        </div>
      </div>

      <ManageProjectsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  )
}

function FilmstripItem({
  asset,
  active,
  onClick,
  onRemove,
}: {
  asset: MediaAsset
  active: boolean
  onClick: () => void
  onRemove: () => void
}): ReactNode {
  const thumb = useThumbnail(asset)
  return (
    <div
      className={
        'group relative h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-md border bg-[var(--c-stage)] transition-[border-color] ' +
        (active ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : 'border-line hover:border-lo/40')
      }
      role="button"
      tabIndex={0}
      aria-label={asset.name}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {thumb ? (
        <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : asset.kind === 'video' ? (
        <Clapperboard size={16} className="absolute inset-0 m-auto text-lo" />
      ) : (
        <span className="absolute inset-0 flex animate-pulse items-center justify-center" aria-hidden />
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-[9px] text-white">
        {asset.name}
      </span>
      <button
        type="button"
        aria-label={`Remove ${asset.name} from project`}
        className="fs-thumb-remove absolute left-1 top-1 hidden rounded bg-black/55 p-0.5 text-white hover:bg-black/75 group-hover:block"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}
