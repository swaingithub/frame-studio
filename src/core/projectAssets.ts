import type { MediaAsset, ProjectDoc } from './db/schema'

/** Lookup helpers shared by workspace views. Pure & testable. */

export function assetsByIds(all: readonly MediaAsset[], ids: readonly string[]): MediaAsset[] {
  const map = new Map(all.map((a) => [a.id, a]))
  const out: MediaAsset[] = []
  for (const id of ids) {
    const asset = map.get(id)
    if (asset) out.push(asset)
  }
  return out
}

export function projectPhotos(doc: ProjectDoc, all: readonly MediaAsset[]): MediaAsset[] {
  return assetsByIds(all, doc.photoAssets)
}

export function projectMedia(doc: ProjectDoc, all: readonly MediaAsset[]): MediaAsset[] {
  return assetsByIds(all, [...doc.videoAssets, ...doc.photoAssets])
}
