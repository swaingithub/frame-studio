import { useMemo, useState } from 'react'
import { useCurrentProject } from '../../projects/store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { assetsByIds } from '../../../core/projectAssets'
import { formatBytes, formatDuration } from '../../../core/format'
import { isDocNeutral } from '../../../core/adjustments/edits'
import { AdjustPanel } from '../../photo/components/AdjustPanel'
import { usePhotoEditor } from '../../photo/store'
import { VideoInspectorBody } from '../../video/components/VideoInspector'
import { useVideoEditor } from '../../video/store'
import { useMediaQuery, PHONE_QUERY } from '../../../ui/useMediaQuery'
import type { Histogram } from '../../../core/render/histogram'
import type { ReactNode } from 'react'

/**
 * Right-hand inspector. Photo workspace: the live histogram + adjustment
 * panels (Phase 2). Video workspace: per-clip grade, trim & audio (Phase 4).
 */
export function InspectorPanel(): ReactNode {
  const [simpleMode, setSimpleMode] = useState(true)
  const project = useCurrentProject()
  const assets = useAssets()
  const workspace = project?.activeWorkspace ?? 'photo'

  const activeId = workspace === 'photo' ? project?.activePhotoId : project?.activeVideoId
  const selectedAsset = useMemo(() => {
    if (!assets) return null
    if (activeId) return assets.find((a) => a.id === activeId) ?? null
    return null
  }, [assets, activeId])
  // When no clip is selected in video mode, show the first clip's card.
  const videoSelected = useMemo(() => {
    if (workspace !== 'video' || activeId || !assets) return null
    return assetsByIds(assets, project?.videoAssets ?? [])[0] ?? null
  }, [workspace, activeId, assets, project])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-3">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-lo">
          {workspace === 'photo' ? 'Edit — Photo' : 'Edit — Video'}
        </h2>
        <button type="button" onClick={() => setSimpleMode((v) => !v)} aria-pressed={!simpleMode}
          className="rounded-md bg-elevated px-2 py-1 text-[10px] font-medium text-hi hover:bg-hover">
          {simpleMode ? 'More tools' : 'Simple mode'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selectedAsset ? <AssetInspectorCard assetId={selectedAsset.id} /> : null}
        {!selectedAsset && videoSelected ? <AssetInspectorCard assetId={videoSelected.id} /> : null}

        <section className="mt-4">
          {workspace === 'photo' ? <PhotoInspectorBody simpleMode={simpleMode} /> : <VideoInspectorSection simpleMode={simpleMode} />}
        </section>
      </div>
    </div>
  )
}

/** Photo mode: histogram + adjustments + history, driven by the editor store. */
function PhotoInspectorBody({ simpleMode }: { simpleMode: boolean }): ReactNode {
  const doc = usePhotoEditor((s) => s.doc)
  const histogram = usePhotoEditor((s) => s.histogram)

  if (!doc) {
    return (
      <p className="rounded-lg border border-dashed border-line p-3 text-xs text-lo">
        Select a photo to edit it. Adjustments, crop and history appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <AdjustPanel doc={doc} histogram={histogram} unedited={isDocNeutral(doc)} simpleMode={simpleMode} />
    </div>
  )
}

/** Video mode: Looks + grade + audio + history for the active clip. */
function VideoInspectorSection({ simpleMode }: { simpleMode: boolean }): ReactNode {
  const histogram = useVideoEditorHistogram()
  return <VideoInspectorBody histogram={histogram} simpleMode={simpleMode} />
}

function useVideoEditorHistogram(): Histogram | null {
  return useVideoEditor((s) => s.histogram) as Histogram | null
}

function AssetInspectorCard({ assetId }: { assetId: string }): ReactNode {
  const asset = useAssets()?.find((a) => a.id === assetId) ?? null
  const thumb = useThumbnail(asset)
  const phone = useMediaQuery(PHONE_QUERY)
  if (!asset) return null
  // Phones: the live stage is directly behind the sheet — don't duplicate a
  // big preview here; one compact line keeps the editing tools above the fold.
  if (phone) {
    return (
      <div className="rounded-lg border border-line bg-elevated px-3 py-2">
        <p className="truncate text-xs font-medium text-hi">{asset.name}</p>
        <p className="mt-0.5 text-[10px] text-lo">
          {asset.kind === 'video' ? `Video${asset.duration !== null ? ` · ${formatDuration(asset.duration)}` : ''}` : 'Image'}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
          {` · ${formatBytes(asset.size)}`}
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-line bg-elevated p-3">
      <div className="mb-2 flex aspect-[16/10] items-center justify-center overflow-hidden rounded-md border border-line bg-[var(--c-stage)]">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="animate-pulse" aria-hidden />
        )}
      </div>
      <p className="truncate text-sm font-medium text-hi">{asset.name}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-lo">
        <dt>Kind</dt>
        <dd className="capitalize text-hi">{asset.kind}</dd>
        {asset.width && asset.height ? (
          <>
            <dt>Dimensions</dt>
            <dd className="text-hi">
              {asset.width} × {asset.height}
            </dd>
          </>
        ) : null}
        {asset.duration !== null ? (
          <>
            <dt>Duration</dt>
            <dd className="tabular-nums text-hi">{formatDuration(asset.duration)}</dd>
          </>
        ) : null}
        <dt>Size</dt>
        <dd className="text-hi">{formatBytes(asset.size)}</dd>
        <dt>Type</dt>
        <dd className="truncate text-hi">{asset.mimeType}</dd>
        {asset.tags.length > 0 ? (
          <>
            <dt>Tags</dt>
            <dd className="text-hi">{asset.tags.join(', ')}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
