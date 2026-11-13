import { describe, expect, it } from 'vitest'
import { applyLibraryFilters, allTags, defaultFilters, matchesFilters, sortAssets } from './filters'
import type { MediaAsset } from '../../core/db/schema'

function asset(partial: Partial<MediaAsset>): MediaAsset {
  return {
    id: crypto.randomUUID(),
    name: 'photo.jpg',
    kind: 'image',
    mimeType: 'image/jpeg',
    size: 1000,
    addedAt: 0,
    modifiedAt: null,
    width: 100,
    height: 100,
    duration: null,
    camera: null,
    exif: null,
    rating: 0,
    favorite: false,
    tags: [],
    storage: 'idb',
    storageKey: 'k',
    thumbKey: null,
    ...partial,
  }
}

describe('library filters', () => {
  const assets = [
    asset({ id: '1', name: 'Sunset.jpg', kind: 'image', addedAt: 10, rating: 4, favorite: true, tags: ['trip'] }),
    asset({ id: '2', name: 'Song.mp3', kind: 'audio', addedAt: 20, rating: 2 }),
    asset({ id: '3', name: 'Clip.mp4', kind: 'video', addedAt: 30, camera: 'Canon R6' }),
  ]

  it('matches nothing-less filters through everything', () => {
    expect(applyLibraryFilters(assets, defaultFilters)).toHaveLength(3)
  })

  it('filters by kind', () => {
    const result = applyLibraryFilters(assets, { ...defaultFilters, kind: 'audio' })
    expect(result.map((a) => a.id)).toEqual(['2'])
  })

  it('filters by favorites and rating together', () => {
    const result = applyLibraryFilters(assets, {
      ...defaultFilters,
      favoritesOnly: true,
      minRating: 3,
    })
    expect(result.map((a) => a.id)).toEqual(['1'])
  })

  it('searches names, tags, and camera case-insensitively', () => {
    expect(applyLibraryFilters(assets, { ...defaultFilters, search: 'SUN' }).length).toBe(1)
    expect(applyLibraryFilters(assets, { ...defaultFilters, search: 'trip' }).length).toBe(1)
    expect(applyLibraryFilters(assets, { ...defaultFilters, search: 'canon' }).length).toBe(1)
  })

  it('filters by single tag', () => {
    expect(matchesFilters(assets[0], { ...defaultFilters, tag: 'trip' })).toBe(true)
    expect(matchesFilters(assets[1], { ...defaultFilters, tag: 'trip' })).toBe(false)
  })

  it('sorts by date desc by default and by name on request', () => {
    const byDate = sortAssets(assets, 'date-desc').map((a) => a.id)
    expect(byDate).toEqual(['3', '2', '1'])
    const byName = sortAssets(assets, 'name').map((a) => a.id)
    expect(byName).toEqual(['3', '2', '1'])
    // never mutates the input
    expect(assets[0].addedAt).toBe(10)
  })

  it('collects the global tag vocabulary', () => {
    expect(allTags(assets)).toEqual(['trip'])
  })
})
