import { memo, useState } from 'react'
import { Music2, Plus, Star, Heart, MoreVertical, Trash2, Tag, Image as ImageIcon, Clapperboard } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useThumbnail } from '../useAssets'
import { Dropdown, DropdownTrigger, DropdownContent, MenuItem, MenuSeparator } from '../../../ui/dropdown'
import { formatBytes, formatDuration } from '../../../core/format'
import type { AssetKind, MediaAsset } from '../../../core/db/schema'
import type { ReactNode } from 'react'

const kindIcon: Record<AssetKind, ReactNode> = {
  image: <ImageIcon size={20} className="text-lo" />,
  video: <Clapperboard size={20} className="text-lo" />,
  audio: <Music2 size={20} className="text-lo" />,
}

interface AssetCardProps {
  asset: MediaAsset
  selected: boolean
  inProject: boolean
  onToggleSelect: (id: string, shift?: boolean) => void
  onSetRating: (id: string, rating: number) => void
  onToggleFavorite: (id: string) => void
  onAddTag: (id: string, tag: string) => void
  onRemoveTag: (id: string, tag: string) => void
  onDelete: (id: string) => void
  onAddToProject: (ids: string[]) => void
  onRemoveFromProject: (id: string) => void
}

export const AssetCard = memo(function AssetCard({
  asset,
  selected,
  inProject,
  onToggleSelect,
  onSetRating,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onDelete,
  onAddToProject,
  onRemoveFromProject,
}: AssetCardProps): ReactNode {
  const thumb = useThumbnail(asset)
  const [tagEditorOpen, setTagEditorOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const kindLabel = asset.kind === 'image' ? 'Image' : asset.kind === 'video' ? 'Video' : 'Audio'

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={(e) => onToggleSelect(asset.id, e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggleSelect(asset.id, e.shiftKey)
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg border bg-elevated transition-[border-color,box-shadow]',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--c-accent)]' : 'border-line hover:border-lo/40',
      )}
    >
      {/* Thumbnail region (fixed aspect keeps the grid calm while loading) */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--c-stage)]">
        {thumb ? (
          <img src={thumb} alt={asset.name} loading="lazy" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span aria-hidden>{kindIcon[asset.kind]}</span>
        )}

        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {kindLabel}
        </span>
        {asset.duration !== null ? (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
            {formatDuration(asset.duration)}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'absolute right-1.5 top-1.5 rounded-md bg-black/45 p-1 text-white backdrop-blur-sm transition-opacity',
            asset.favorite ? 'opacity-100 [&_svg]:fill-rose-400 [&_svg]:text-rose-400' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(asset.id)
          }}
        >
          <Heart size={13} />
        </button>
      </div>

      {/* Meta footer */}
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
        <div className="min-w-0 flex-1">
          <p
            className="fs-label-fade text-xs font-medium text-hi"
            title={asset.name}
          >
            {asset.name}
          </p>
          <p className="truncate text-[10px] text-lo">
            {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
            {formatBytes(asset.size)}
          </p>
        </div>
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${asset.name}`}
              className="rounded p-1 text-lo opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-hi"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical size={14} />
            </button>
          </DropdownTrigger>
          <DropdownContent align="end" className="min-w-52">
            <MenuItem onSelect={() => onToggleFavorite(asset.id)} icon={<Heart size={13} />}>
              {asset.favorite ? 'Unfavorite' : 'Favorite'}
            </MenuItem>
            <MenuItem onSelect={() => onSetRating(asset.id, 0)} icon={<Star size={13} />}>
              Clear rating
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                setTagEditorOpen((v) => !v)
              }}
              icon={<Tag size={13} />}
            >
              {tagEditorOpen ? 'Close tag editor' : 'Add tag…'}
            </MenuItem>
            {inProject ? (
              <MenuItem danger onSelect={() => onRemoveFromProject(asset.id)}>
                Remove from project
              </MenuItem>
            ) : (
              <MenuItem onSelect={() => onAddToProject([asset.id])} icon={<Plus size={13} />}>
                Add to project
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 size={13} />} onSelect={() => onDelete(asset.id)}>
              Delete from library
            </MenuItem>
          </DropdownContent>
        </Dropdown>
      </div>

      {/* Rating row */}
      <div className="flex items-center gap-0.5 px-2 pb-2" onClick={(e) => e.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Set rating ${n} for ${asset.name}`}
            className="rounded-sm p-0.5 text-lo transition-colors hover:text-amber-400 focus-visible:text-amber-400"
            onClick={() => onSetRating(asset.id, asset.rating === n ? 0 : n)}
          >
            <Star size={11} className={asset.rating >= n ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
        ))}
      </div>

      {/* Tags */}
      {asset.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {asset.tags.map((t) => (
            <button
              key={t}
              type="button"
              title="Click to remove tag"
              className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent hover:bg-danger/15 hover:text-danger"
              onClick={(e) => {
                e.stopPropagation()
                onRemoveTag(asset.id, t)
              }}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {tagEditorOpen ? (
        <form
          className="flex items-center gap-1 border-t border-line px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const t = tagDraft.trim()
            if (t) onAddTag(asset.id, t)
            setTagDraft('')
            setTagEditorOpen(false)
          }}
        >
          <input
            autoFocus
            value={tagDraft}
            placeholder="Tag name"
            onChange={(e) => setTagDraft(e.target.value)}
            className="h-6 w-full rounded bg-app px-2 text-[11px] text-hi outline-none placeholder:text-lo/70"
            onClick={(e) => e.stopPropagation()}
          />
        </form>
      ) : null}
    </div>
  )
})
