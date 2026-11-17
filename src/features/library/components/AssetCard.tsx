import { memo, useEffect, useRef, useState } from 'react'
import { Music2, Plus, Star, Heart, MoreVertical, Trash2, Tag, Image as ImageIcon, Clapperboard } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useThumbnail } from '../useAssets'
import { getBlob } from '../../../core/db/blobStore'
import { Dropdown, DropdownTrigger, DropdownContent, MenuItem, MenuSeparator } from '../../../ui/dropdown'
import { formatBytes, formatDuration } from '../../../core/format'
import type { AssetKind, MediaAsset } from '../../../core/db/schema'
import type { ReactNode } from 'react'

const kindIcon: Record<AssetKind, ReactNode> = {
  image: <ImageIcon size={20} className="text-lo" />,
  video: <Clapperboard size={20} className="text-lo" />,
  audio: <Music2 size={20} className="text-lo" />,
}

/** Hover-scrubbing is a pointer interaction — skip it on touch-only devices. */
const CAN_HOVER = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * Hover scrub for video cards: as the pointer sweeps the thumbnail, decodes
 * frames from the local blob (hidden video element → small canvas → JPEG
 * frame). Lazily loads the blob on first hover; everything stays on-device.
 */
function VideoScrubFrame({ asset, fallback }: { asset: MediaAsset; fallback: string | null }): ReactNode {
  const [frame, setFrame] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pendingT = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let url: string | null = null
    const canvas = document.createElement('canvas')
    canvas.width = 192
    const draw = (): void => {
      const v = videoRef.current
      if (!v || v.videoWidth === 0 || cancelled) return
      canvas.height = Math.max(1, Math.round((canvas.width * v.videoHeight) / v.videoWidth))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      setFrame(canvas.toDataURL('image/jpeg', 0.6))
    }
    const onSeeked = (): void => {
      draw()
      const v = videoRef.current
      if (v && pendingT.current !== null) {
        v.currentTime = pendingT.current
        pendingT.current = null
      }
    }
    void (async () => {
      const blob = await getBlob({ key: asset.storageKey, storage: asset.storage })
      if (!blob || cancelled) return
      url = URL.createObjectURL(blob)
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.src = url
      v.addEventListener('seeked', onSeeked)
      videoRef.current = v
      await new Promise<void>((resolve) => {
        v.onloadeddata = () => resolve()
        v.onerror = () => resolve()
      })
      if (cancelled || v.videoWidth === 0) return
      draw()
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      videoRef.current = null
      setFrame(null)
      pendingT.current = null
    }
  }, [active, asset.storageKey, asset.storage])

  if (asset.kind !== 'video' || !CAN_HOVER) return <ThumbnailFrame asset={asset} thumb={fallback} />

  const seek = (e: React.PointerEvent<HTMLDivElement>): void => {
    const v = videoRef.current
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = frac * v.duration
    if (v.readyState < 1 || v.seeking) {
      pendingT.current = t
      return
    }
    v.currentTime = t
  }

  return (
    <div
      className="relative h-full w-full"
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onPointerMove={seek}
    >
      <ThumbnailFrame asset={asset} thumb={frame ?? fallback} />
      {frame ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-accent/80 to-accent/20" aria-hidden />
      ) : null}
    </div>
  )
}

/** The plain still thumbnail (also the fallback layer under the scrub). */
function ThumbnailFrame({ asset, thumb }: { asset: MediaAsset; thumb: string | null }): ReactNode {
  return thumb ? (
    <img src={thumb} alt={asset.name} loading="lazy" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <span aria-hidden>{kindIcon[asset.kind]}</span>
  )
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
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-elevated shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-md',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--c-accent),0_6px_18px_rgba(56,103,239,0.16)]' : 'border-line/80 hover:border-lo/40',
      )}
    >
      {/* Thumbnail region (fixed aspect keeps the grid calm while loading).
          Video cards hover-scrub through their frames on pointer devices. */}
      <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--c-stage)]">
        <VideoScrubFrame asset={asset} fallback={thumb} />

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
