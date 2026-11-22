import type { ReactNode } from 'react'
import { useAssets, useThumbnail } from '../../library/useAssets'

/** Small thumbnail for a media layer's timeline chip. */
export function LaneThumb({ assetId }: { assetId?: string }): ReactNode {
  const asset = useAssets()?.find((a) => a.id === assetId) ?? null
  const thumb = useThumbnail(asset)
  if (!thumb) return null
  return <img src={thumb} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" aria-hidden />
}
