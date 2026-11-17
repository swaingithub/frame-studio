import { useMemo, useState } from 'react'
import {
  Circle,
  Clapperboard,
  Heart,
  Image as ImageIcon,
  Music2,
  Search,
  Star,
  Trash2,
  Plus,
  FolderInput,
  X,
  PanelLeftClose,
} from 'lucide-react'
import { cn } from '../../../lib/cn'
import { type AssetKind, type MediaAsset } from '../../../core/db/schema'
import { allTags, applyLibraryFilters, defaultFilters, type LibrarySort } from '../filters'
import { setTagOn, useLibraryStore } from '../store'
import { updateAssets } from '../store'
import { deleteAssetCompletely } from '../import'
import { useAssets } from '../useAssets'
import { useImport } from './useImport'
import { AssetGrid } from './AssetGrid'
import { Button } from '../../../ui/button'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'
import { useProjectsStore } from '../../projects/store'
import { formatBytes } from '../../../core/format'
import { useStorageEstimate } from '../../../lib/hooks'
import { useUIStore } from '../../../ui/uiStore'
import type { ReactNode } from 'react'

const kinds: Array<{ value: 'all' | AssetKind; label: string; icon: ReactNode }> = [
  { value: 'all', label: 'All', icon: <Circle size={11} /> },
  { value: 'image', label: 'Photos', icon: <ImageIcon size={11} /> },
  { value: 'video', label: 'Video', icon: <Clapperboard size={11} /> },
  { value: 'audio', label: 'Audio', icon: <Music2 size={11} /> },
]

const sorts: Array<{ value: LibrarySort; label: string }> = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'rating', label: 'Highest rating' },
  { value: 'size', label: 'Largest file' },
]

export function LibraryPanel({ onClose }: { onClose?: () => void } = {}): ReactNode {
  const assets = useAssets()
  const filters = useLibraryStore()
  const { pickFiles, importing } = useImport()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const currentProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.currentId) ?? null)
  const addAssetsToCurrent = useProjectsStore((s) => s.addAssetsToCurrent)
  const removeAssetFromCurrent = useProjectsStore((s) => s.removeAssetFromCurrent)
  const usage = useStorageEstimate()
  const toggleLeft = useUIStore((s) => s.toggleLeft)

  const shown = useMemo(() => (assets ? applyLibraryFilters(assets, filters) : []), [assets, filters])
  const tags = useMemo(() => (assets ? allTags(assets) : []), [assets])
  const projectAssetIds = useMemo(
    () => new Set(currentProject ? [...currentProject.photoAssets, ...currentProject.videoAssets] : []),
    [currentProject],
  )
  const selectedAssets = useMemo(
    () => shown.filter((a) => filters.selection.includes(a.id)),
    [shown, filters.selection],
  )

  async function batchDelete(): Promise<void> {
    const ids = [...filters.selection]
    setConfirm({
      title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
      description: 'Originals, thumbnails, and their use in projects will be removed. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        for (const id of ids) await deleteAssetCompletely(id)
        filters.clearSelection()
        await useProjectsStore.getState().reload()
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft"><FolderInput size={14} className="text-accent" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="whitespace-nowrap text-sm font-semibold tracking-tight text-hi">Library</h2>
          <p className="truncate text-[10px] text-lo">{assets ? `${assets.length} ${assets.length === 1 ? 'item' : 'items'} ready` : 'Loading media…'}</p>
        </div>
        <Button size="sm" variant="primary" onClick={pickFiles} disabled={importing} title="Import files (⌘I)">
          <Plus size={13} />
          Import
        </Button>
        {onClose ? (
          <button
            type="button"
            aria-label="Close library"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lo hover:bg-hover hover:text-hi"
          >
            <X size={14} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Collapse library"
            title="Collapse library"
            onClick={toggleLeft}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lo hover:bg-hover hover:text-hi"
          >
            <PanelLeftClose size={14} />
          </button>
        )}
      </div>

      {/* Progress */}
      {importing ? (
        <div className="flex h-7 items-center gap-2 border-b border-line bg-accent-soft/40 px-3 text-[10px] text-accent" role="status" aria-live="polite">
          <span className="shrink-0 font-medium">Importing media</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-accent/15" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={filters.importTotal || 1} aria-valuenow={filters.importDone}>
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${filters.importTotal === 0 ? 20 : (filters.importDone / filters.importTotal) * 100}%` }}
          />
          </div>
          <span className="shrink-0 tabular-nums">{filters.importTotal ? `${filters.importDone}/${filters.importTotal}` : 'Preparing…'}</span>
        </div>
      ) : (
        <div className="h-0.5" />
      )}

      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b border-line px-2.5 pb-2.5 pt-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lo" />
          <input
            value={filters.search}
            onChange={(e) => filters.patch({ search: e.target.value })}
            placeholder="Search name, tag, camera…"
            aria-label="Search library"
            className="h-8 w-full rounded-md border border-line bg-elevated pl-7 pr-2 text-xs text-hi placeholder:text-lo/70 focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={filters.kind === k.value}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
                filters.kind === k.value ? 'bg-accent-soft text-accent' : 'text-lo hover:bg-hover hover:text-hi',
              )}
              onClick={() => filters.patch({ kind: k.value })}
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-[11px] text-lo" title="Favorites only">
            <button
              type="button"
              aria-pressed={filters.favoritesOnly}
              onClick={() => filters.patch({ favoritesOnly: !filters.favoritesOnly })}
              className={cn(
                'flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors',
                filters.favoritesOnly ? 'bg-accent-soft text-accent' : 'hover:bg-hover hover:text-hi',
              )}
            >
              <Heart size={11} className={filters.favoritesOnly ? 'fill-accent' : ''} />
              Favorites
            </button>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-lo">
            <Star size={11} />
            Min.
            <select
              value={filters.minRating}
              onChange={(e) => filters.patch({ minRating: Number(e.target.value) })}
              aria-label="Minimum rating filter"
              className="rounded border border-line bg-elevated px-1 py-0.5 text-[11px] text-hi outline-none"
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'any' : `${n}★`}
                </option>
              ))}
            </select>
          </label>
          <select
            value={filters.sort}
            onChange={(e) => filters.patch({ sort: e.target.value as LibrarySort })}
            aria-label="Sort order"
            className="ml-auto rounded border border-line bg-elevated px-1 py-0.5 text-[11px] text-hi outline-none"
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {tags.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => filters.patch({ tag: null })}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] transition-colors',
                filters.tag === null ? 'bg-accent-soft text-accent' : 'bg-hover text-lo hover:text-hi',
              )}
            >
              All tags
            </button>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => filters.patch({ tag: filters.tag === t ? null : t })}
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] transition-colors',
                  filters.tag === t ? 'bg-accent-soft text-accent' : 'bg-hover text-lo hover:text-hi',
                )}
              >
                #{t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Grid */}
      {!assets ? (
        <div className="grid flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto p-2.5 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-elevated" />
          ))}
        </div>
      ) : (
        <AssetGrid
          assets={shown}
          selection={filters.selection}
          projectAssetIds={projectAssetIds}
          onToggleSelect={filters.toggleSelect}
          onSetRating={(id, rating) => void updateAssets([id], (a) => ({ ...a, rating }))}
          onToggleFavorite={(id) => void updateAssets([id], (a) => ({ ...a, favorite: !a.favorite }))}
          onAddTag={(id, tag) => void setTagOn([id], tag, true)}
          onRemoveTag={(id, tag) => void setTagOn([id], tag, false)}
          onDelete={(id) =>
            setConfirm({
              title: `Delete "${idToName(assets, id)}"?`,
              description: 'The original file, thumbnail, and its place in projects will be removed. This cannot be undone.',
              confirmLabel: 'Delete',
              danger: true,
              onConfirm: () => deleteAssetCompletely(id).then(() => useProjectsStore.getState().reload()),
            })
          }
          onAddToProject={(ids) => {
            if (!currentProject) {
              return
            }
            const kind = assets.find((a) => ids.includes(a.id))?.kind
            if (kind) addAssetsToCurrent(ids, kind)
          }}
          onRemoveFromProject={removeAssetFromCurrent}
          empty={
            <div className="max-w-64 text-center">
              <ImageIcon size={22} className="mx-auto mb-2 text-lo" />
              <p className="text-sm font-medium text-hi">
                {(assets?.length ?? 0) === 0 ? 'Your library is empty' : 'No matches with these filters'}
              </p>
              <p className="mt-1 text-xs text-lo">
                {(assets?.length ?? 0) === 0
                  ? 'Drop photos, videos, or audio anywhere — everything stays on this device.'
                  : 'Try clearing the search or filters.'}
              </p>
              {(assets?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  className="mt-3 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                  onClick={() => filters.patch(defaultFilters)}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          }
        />
      )}

      {/* Batch actions */}
      {selectedAssets.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-elevated px-3 py-2">
          <span className="text-xs text-lo">{selectedAssets.length} selected</span>
          <div className="ml-auto flex items-center gap-1">
            {currentProject ? (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  const kind = selectedAssets[0]?.kind
                  if (kind) addAssetsToCurrent(selectedAssets.map((a) => a.id), kind)
                }}
                title={`Add to ${currentProject.name}`}
              >
                <Plus size={12} />
                Add
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                void updateAssets(selectedAssets.map((a) => a.id), (a) => ({ ...a, favorite: true }))
              }}
              title="Favorite selected"
            >
              <Heart size={12} />
            </Button>
            <Button size="sm" variant="danger" onClick={() => void batchDelete()} title="Delete selected">
              <Trash2 size={12} />
            </Button>
            <Button size="sm" variant="ghost" onClick={filters.clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-1.5 text-[10px] text-lo">
          <span>Everything processed on-device</span>
          <span>{usage != null ? `${formatBytes(usage)} stored` : null}</span>
        </div>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

function idToName(assets: MediaAsset[], id: string): string {
  return assets.find((a) => a.id === id)?.name ?? 'this item'
}
