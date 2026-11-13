import type { AssetKind, MediaAsset } from '../../core/db/schema'

/** Pure, testable filtering/sorting logic shared by grid views. */

export type LibrarySort = 'date-desc' | 'date-asc' | 'name' | 'rating' | 'size'

export interface LibraryFilters {
  search: string
  kind: 'all' | AssetKind
  favoritesOnly: boolean
  minRating: number
  tag: string | null
  sort: LibrarySort
}

export const defaultFilters: LibraryFilters = {
  search: '',
  kind: 'all',
  favoritesOnly: false,
  minRating: 0,
  tag: null,
  sort: 'date-desc',
}

export function matchesFilters(asset: MediaAsset, f: LibraryFilters): boolean {
  if (f.kind !== 'all' && asset.kind !== f.kind) return false
  if (f.favoritesOnly && !asset.favorite) return false
  if (asset.rating < f.minRating) return false
  if (f.tag && !asset.tags.includes(f.tag)) return false
  const q = f.search.trim().toLowerCase()
  if (q) {
    const haystacks = [asset.name, ...asset.tags, asset.mimeType, asset.camera ?? '']
    const hit = haystacks.some((h) => h.toLowerCase().includes(q))
    if (!hit) return false
  }
  return true
}

export function sortAssets(assets: MediaAsset[], sort: LibrarySort): MediaAsset[] {
  const out = [...assets]
  switch (sort) {
    case 'date-desc':
      out.sort((a, b) => b.addedAt - a.addedAt)
      break
    case 'date-asc':
      out.sort((a, b) => a.addedAt - b.addedAt)
      break
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      break
    case 'rating':
      out.sort((a, b) => b.rating - a.rating || b.addedAt - a.addedAt)
      break
    case 'size':
      out.sort((a, b) => b.size - a.size)
      break
  }
  return out
}

export function applyLibraryFilters(assets: MediaAsset[], f: LibraryFilters): MediaAsset[] {
  return sortAssets(assets.filter((a) => matchesFilters(a, f)), f.sort)
}

/** All distinct tags across assets, alphabetical — powers the tag chips. */
export function allTags(assets: MediaAsset[]): string[] {
  const set = new Set<string>()
  for (const a of assets) for (const t of a.tags) set.add(t)
  return [...set].sort((a, b) => a.localeCompare(b))
}
