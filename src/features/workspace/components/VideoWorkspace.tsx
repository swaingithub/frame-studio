import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Film, Image as ImageIcon, Music2, Plus, Smile, Trash2, UploadCloud, Type as TypeIcon, Blend as BlendIcon } from 'lucide-react'
import { useCurrentProject } from '../../projects/store'
import { useAssets, useThumbnail } from '../../library/useAssets'
import { formatDuration } from '../../../core/format'
import { VideoStage } from '../../video/components/VideoStage'
import { useVideoEditor, layoutOf } from '../../video/store'
import { TRANSITION_LABELS, type VideoTransition } from '../../video/sequenceModel'
import { STICKER_CATEGORIES } from '../../video/stickers'
import { MobileVideoBar } from './MobileVideoBar'
import { useMediaQuery, PHONE_QUERY } from '../../../ui/useMediaQuery'
import { cn } from '../../../lib/cn'
import type { MediaAsset } from '../../../core/db/schema'

/**
 * Video workspace: the SEQUENCE strip (each clip proportional to its trimmed
 * length) above the stage. Selecting a clip loads its edit doc; clips can be
 * split, moved, duplicated and deleted — and fresh library clips added.
 */
export function VideoWorkspace(): ReactNode {
  const project = useCurrentProject()
  const assets = useAssets()
  const activeClipId = useVideoEditor((s) => s.activeClipId)
  const sequence = useVideoEditor((s) => s.sequence)
  const durations = useVideoEditor((s) => s.durations)
  const revision = useVideoEditor((s) => s.revision)
  void revision
  const phone = useMediaQuery(PHONE_QUERY)

  // Adopt/repair the persisted sequence once the project is known.
  useEffect(() => {
    if (!project) return
    useVideoEditor.getState().ensureSequence()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  // Keep asset durations in the store (drives layout + trim sanitizing).
  useEffect(() => {
    if (!assets) return
    for (const asset of assets) {
      if (asset.duration !== null && (useVideoEditor.getState().durations[asset.id] ?? 0) !== asset.duration) {
        useVideoEditor.getState().setAssetDuration(asset.id, asset.duration)
      }
    }
  }, [assets])

  const layout = layoutOf(sequence, durations)
  const assetOf = useMemo(() => {
    const map = new Map((assets ?? []).map((a) => [a.id, a]))
    return (id: string): MediaAsset | undefined => map.get(id)
  }, [assets])

  // Video assets already in the sequence vs available to add.
  const usedIds = new Set(sequence.map((c) => c.assetId))
  const addable = (assets ?? []).filter((a) => a.kind === 'video' && !usedIds.has(a.id))

  if (!project) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sequence strip (at the bottom on phones, right above the thumb bar) */}
      <div className={cn('flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3', phone && 'order-3 border-b-0 border-t')}>
        {sequence.length === 0 ? <EmptySequence addable={addable} /> : null}
        {layout.entries.map((entry, index) => (
          <StripClip
            key={entry.clip.id}
            asset={assetOf(entry.clip.assetId)}
            name={assetOf(entry.clip.assetId)?.name}
            out={entry.out}
            index={index}
            title={entry.clip.title?.text}
            transition={entry.clip.transition}
            selected={entry.clip.id === activeClipId}
            onSelect={() => useVideoEditor.getState().setActiveClip(entry.clip.id)}
            onMove={(dir) => useVideoEditor.getState().moveClip(entry.clip.id, dir)}
            onDuplicate={() => useVideoEditor.getState().duplicateClip(entry.clip.id)}
            onDelete={() => useVideoEditor.getState().removeClip(entry.clip.id)}
          />
        ))}
        {addable.length > 0 && sequence.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-1">
            {addable.slice(0, 3).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => useVideoEditor.getState().addClip(a.id)}
                className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-accent/50 px-2 text-[11px] text-hi hover:bg-accent-soft"
                aria-label={`Add ${a.name} to timeline`}
              >
                <Plus size={11} />
                <span className="max-w-40 truncate">{a.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Overlay chips: add text / media layers above the base track */}
      {sequence.length > 0 ? (
        <div className={cn('flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-3', phone && 'order-2')} role="group" aria-label="Add overlay layers">
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-lo" aria-hidden>
            <TypeIcon size={11} />
            Overlays
          </span>
          <button
            type="button"
            onClick={() => useVideoEditor.getState().addTextOverlay()}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-accent/50 px-2 text-[11px] text-hi hover:bg-accent-soft"
            aria-label="Add text overlay"
          >
            <Plus size={10} />
            Text
          </button>
          <StickerButton />
          {(assets ?? [])
            .filter((a) => a.kind === 'video' || a.kind === 'image')
            .slice(0, 4)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => useVideoEditor.getState().addMediaOverlay(a.id, a.kind === 'image' ? 'image' : 'video')}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-accent/50 px-2 text-[11px] text-hi hover:bg-accent-soft"
                aria-label={`Add ${a.name} as overlay`}
              >
                {a.kind === 'image' ? <ImageIcon size={10} /> : <Film size={10} />}
                <span className="max-w-32 truncate">{a.name}</span>
              </button>
            ))}
        </div>
      ) : null}

      {/* Stage */}
      <div className={cn('flex min-h-0 flex-1 flex-col bg-stage', phone && 'order-1')}>
        {sequence.length > 0 ? (
          <VideoStage />
        ) : (
          <SelectClipHint hasAssets={(project.videoAssets?.length ?? 0) > 0} />
        )}
      </div>

      {/* CapCut-style thumb bar (phones only) */}
      {phone ? (
        <div className="order-4">
          <MobileVideoBar />
        </div>
      ) : null}
    </div>
  )
}

function EmptySequence({ addable }: { addable: MediaAsset[] }): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
      <p className="flex items-center gap-2 text-xs text-lo">
        <UploadCloud size={14} />
        Empty timeline — import videos in the Library, add them to the project, then add them here.
      </p>
      {addable.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {addable.slice(0, 6).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => useVideoEditor.getState().addClip(a.id)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-accent/50 px-2 text-[11px] text-hi hover:bg-accent-soft"
            >
              <Plus size={11} />
              <span className="max-w-40 truncate">{a.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SelectClipHint({ hasAssets }: { hasAssets: boolean }): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Clapperboard size={30} className="text-lo" />
      <p className="max-w-96 text-sm text-lo">
        {hasAssets
          ? 'Add clips to the timeline above to start editing.'
          : 'Assemble, trim, split, speed-ramp and grade your videos here — with the same looks as photos. Import media in the library first.'}
      </p>
    </div>
  )
}

function StripClip({
  asset,
  name,
  out,
  index,
  title,
  transition,
  selected,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  asset: MediaAsset | undefined
  name: string | undefined
  out: number
  index: number
  title: string | undefined
  transition: VideoTransition
  selected: boolean
  onSelect: () => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}): ReactNode {
  const thumb = useThumbnail(asset)
  return (
    <div
      className={cn(
        'group relative flex h-full shrink-0 overflow-hidden rounded-lg border transition-colors',
        selected ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-elevated hover:border-accent/40',
      )}
      style={{ width: 116 }}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex h-full w-full flex-col items-stretch text-left" aria-label={`Select clip ${index + 1}: ${name ?? ''}`}>
        <span className="flex items-center gap-1 px-2 pt-1.5">
          {asset?.kind === 'audio' ? <Music2 size={11} className={selected ? 'text-accent' : 'text-lo'} /> : <Film size={11} className={selected ? 'text-accent' : 'text-lo'} />}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-hi">{name ?? 'Clip'}</span>
          <span className="shrink-0 text-[9px] tabular-nums text-lo">{formatDuration(out)}</span>
        </span>
        <span className="relative mx-2 mt-1 min-h-0 flex-1 overflow-hidden rounded-sm bg-black/20">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" aria-hidden /> : null}
          {title ? (
            <span className="absolute bottom-0.5 left-0.5 rounded-sm bg-black/60 px-1 text-[8px] text-white" aria-hidden>
              <TypeIcon size={7} className="inline" /> {title.slice(0, 14)}
            </span>
          ) : null}
        </span>
      </button>
      <div className="fs-hover-actions absolute right-1 top-1 z-10 hidden gap-0.5 group-hover:flex group-focus-within:flex">
        <IconMini label="Move earlier" onClick={() => onMove(-1)}>
          <ArrowLeft size={10} />
        </IconMini>
        <IconMini label="Move later" onClick={() => onMove(1)}>
          <ArrowRight size={10} />
        </IconMini>
        <IconMini label="Duplicate" onClick={onDuplicate}>
          <Copy size={10} />
        </IconMini>
        <IconMini label="Delete" onClick={onDelete} danger>
          <Trash2 size={10} />
        </IconMini>
      </div>
      {index > 0 && transition !== 'cut' ? (
        <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1 py-px text-[8px] font-semibold uppercase text-hi/80" aria-label={TRANSITION_LABELS[transition]}>
          <BlendIcon size={7} />
        </span>
      ) : null}
    </div>
  )
}

function IconMini({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('flex h-6 w-6 items-center justify-center rounded bg-elevated/90 text-hi hover:bg-hover', danger && 'text-danger')}
    >
      {children}
    </button>
  )
}

/** Sticker picker: offline emoji set inserted as oversized text overlays. */
function StickerButton(): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocPointer = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md border border-dashed px-2 text-[11px] text-hi hover:bg-accent-soft',
          open ? 'border-accent bg-accent-soft' : 'border-accent/50',
        )}
        aria-label="Add sticker"
        aria-expanded={open}
      >
        <Smile size={10} />
        Stickers
      </button>
      {open ? (
        <div
          className="absolute left-0 top-8 z-30 max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-panel p-2 shadow-lg"
          role="dialog"
          aria-label="Sticker library"
        >
          {STICKER_CATEGORIES.map((category) => (
            <div key={category.label} className="mb-1.5 last:mb-0">
              <div className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wide text-lo">{category.label}</div>
              <div className="grid grid-cols-6 gap-1">
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    title={`Add ${emoji}`}
                    className="flex h-8 items-center justify-center rounded-md text-lg hover:bg-hover"
                    onClick={() => {
                      useVideoEditor.getState().addSticker(emoji)
                      setOpen(false)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
