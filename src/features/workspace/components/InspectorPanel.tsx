import { Suspense, lazy, useMemo, useState } from 'react'
import { PanelRightClose, Sparkles } from 'lucide-react'
import { useCurrentProject } from '../../projects/store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { assetsByIds } from '../../../core/projectAssets'
import { formatBytes, formatDuration } from '../../../core/format'
import { isDocNeutral } from '../../../core/adjustments/edits'
import { usePhotoEditor } from '../../photo/store'
import { useVideoEditor } from '../../video/store'
import { useMediaQuery, PHONE_QUERY, DESKTOP_QUERY } from '../../../ui/useMediaQuery'
import type { Histogram } from '../../../core/render/histogram'
import type { ReactNode } from 'react'
import { useUIStore } from '../../../ui/uiStore'

// Editor inspector bodies are code-split: they load when the matching
// workspace opens, not when the shell boots.
const AdjustPanelLazy = lazy(() => import('../../photo/components/AdjustPanel').then((m) => ({ default: m.AdjustPanel })))
const VideoInspectorBodyLazy = lazy(() => import('../../video/components/VideoInspector').then((m) => ({ default: m.VideoInspectorBody })))

/**
 * Right-hand inspector. Photo workspace: the live histogram + adjustment
 * panels (Phase 2). Video workspace: per-clip grade, trim & audio (Phase 4).
 */
export function InspectorPanel(): ReactNode {
  const [simpleMode, setSimpleMode] = useState(true)
  const project = useCurrentProject()
  const assets = useAssets()
  const workspace = project?.activeWorkspace ?? 'photo'
  const toggleRight = useUIStore((s) => s.toggleRight)
  // Compact layouts render the inspector in a drawer with its own Close panel
  // button; the inline collapse control only applies to the desktop column.
  const desktop = useMediaQuery(DESKTOP_QUERY)

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
      <div className={`flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2${desktop ? '' : ' pr-9'}`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft"><Sparkles size={14} className="text-accent" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-hi">Edit your {workspace === 'photo' ? 'photo' : 'video'}</h2>
          <p className="text-[10px] text-lo">{simpleMode ? 'Quick tools for a great result' : 'Advanced controls'}</p>
        </div>
        <div className="flex items-center gap-1">
        <div className="flex items-center rounded-lg border border-line bg-elevated p-0.5" role="group" aria-label="Editing mode">
          <button
            type="button"
            onClick={() => setSimpleMode(true)}
            aria-pressed={simpleMode}
            className={`min-h-6 rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${simpleMode ? 'bg-panel text-hi shadow-sm' : 'text-lo hover:text-hi'}`}
          >
            Beginner
          </button>
          <button
            type="button"
            onClick={() => setSimpleMode(false)}
            aria-pressed={!simpleMode}
            className={`min-h-6 rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${!simpleMode ? 'bg-accent text-onaccent shadow-sm' : 'text-lo hover:text-hi'}`}
          >
            Advanced
          </button>
        </div>
        {desktop ? (
          <button
            type="button"
            aria-label="Collapse inspector"
            title="Collapse inspector"
            onClick={toggleRight}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lo hover:bg-hover hover:text-hi"
          >
            <PanelRightClose size={14} />
          </button>
        ) : null}
        </div>
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
      <Suspense fallback={null}>
        <AdjustPanelLazy doc={doc} histogram={histogram} unedited={isDocNeutral(doc)} simpleMode={simpleMode} />
      </Suspense>
    </div>
  )
}

/** Video mode: Looks + grade + audio + history for the active clip. */
function VideoInspectorSection({ simpleMode }: { simpleMode: boolean }): ReactNode {
  const histogram = useVideoEditorHistogram()
  return (
    <Suspense fallback={null}>
      <VideoInspectorBodyLazy histogram={histogram} simpleMode={simpleMode} />
    </Suspense>
  )
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
    <div className="flex items-center gap-3 rounded-xl border border-line bg-elevated p-2.5 shadow-sm">
      <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-[var(--c-stage)]">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="animate-pulse" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-hi">{asset.name}</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] text-lo">
          <dt>Kind</dt>
          <dd className="capitalize text-hi">{asset.kind}</dd>
        {asset.width && asset.height ? (
          <>
            <dt>Dimensions</dt>
            <dd className="text-hi">{asset.width} × {asset.height}</dd>
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
        </dl>
      </div>
    </div>
  )
}
