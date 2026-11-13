import { useCallback, useRef } from 'react'
import { AssetCard } from './AssetCard'
import type { MediaAsset } from '../../../core/db/schema'
import type { ReactNode } from 'react'

interface AssetGridProps {
  assets: MediaAsset[]
  selection: readonly string[]
  projectAssetIds: ReadonlySet<string>
  onToggleSelect: (id: string, shift?: boolean) => void
  onSetRating: (id: string, rating: number) => void
  onToggleFavorite: (id: string) => void
  onAddTag: (id: string, tag: string) => void
  onRemoveTag: (id: string, tag: string) => void
  onDelete: (id: string) => void
  onAddToProject: (ids: string[]) => void
  onRemoveFromProject: (id: string) => void
  empty?: ReactNode
}

export function AssetGrid(props: AssetGridProps): ReactNode {
  const {
    assets,
    selection,
    projectAssetIds,
    onToggleSelect,
    onSetRating,
    onToggleFavorite,
    onAddTag,
    onRemoveTag,
    onDelete,
    onAddToProject,
    onRemoveFromProject,
    empty,
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)

  const handleToggle = useCallback(
    (id: string, shift?: boolean) => {
      void shift
      onToggleSelect(id)
    },
    [onToggleSelect],
  )

  if (assets.length === 0 && empty) {
    return <div className="flex flex-1 items-center justify-center p-6">{empty}</div>
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2.5">
      <div
        role="listbox"
        aria-label="Media library assets"
        aria-multiselectable
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
        {assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            selected={selection.includes(asset.id)}
            inProject={projectAssetIds.has(asset.id)}
            onToggleSelect={handleToggle}
            onSetRating={onSetRating}
            onToggleFavorite={onToggleFavorite}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onDelete={onDelete}
            onAddToProject={onAddToProject}
            onRemoveFromProject={onRemoveFromProject}
          />
        ))}
      </div>
    </div>
  )
}
