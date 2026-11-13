import { describe, expect, it } from 'vitest'
import {
  addAssetsToDoc,
  createProjectDoc,
  duplicateProjectDoc,
  normalizeProjectName,
  removeAssetFromDoc,
  sanitizeProject,
} from './model'

describe('project model', () => {
  it('creates well-formed documents', () => {
    const doc = createProjectDoc('  Holiday   Reel  ', 'photo', 1000)
    expect(doc.name).toBe('Holiday Reel')
    expect(doc.activeWorkspace).toBe('photo')
    expect(doc.photoAssets).toEqual([])
    expect(doc.schemaVersion).toBe(1)
    expect(doc.id.startsWith('proj_')).toBe(true)
  })

  it('normalizes empty names to Untitled Project', () => {
    expect(normalizeProjectName('   ')).toBe('Untitled Project')
    expect(normalizeProjectName('x'.repeat(100)).length).toBeLessThanOrEqual(80)
  })

  it('duplicates with a new id and copy name', () => {
    const doc = createProjectDoc('My Project', 'video', 1000)
    const copy = duplicateProjectDoc(doc, 2000)
    expect(copy.id).not.toBe(doc.id)
    expect(copy.name).toBe('My Project copy')
    expect(copy.videoAssets).toEqual(doc.videoAssets)
    expect(copy.videoAssets).not.toBe(doc.videoAssets)
  })

  it('adds assets without duplicates', () => {
    const doc = createProjectDoc('p', 'photo')
    let next = addAssetsToDoc(doc, ['a', 'b'], 'image')
    next = addAssetsToDoc(next, ['a', 'c'], 'image')
    expect(next.photoAssets).toEqual(['a', 'b', 'c'])
  })

  it('routes video/audio assets to the video list', () => {
    const doc = createProjectDoc('p', 'photo')
    const next = addAssetsToDoc(doc, ['v1'], 'video')
    expect(next.videoAssets).toEqual(['v1'])
    expect(next.photoAssets).toEqual([])
  })

  it('removes assets and clears active photo', () => {
    let doc = createProjectDoc('p', 'photo')
    doc = addAssetsToDoc(doc, ['a', 'b'], 'image')
    doc = { ...doc, activePhotoId: 'a' }
    const next = removeAssetFromDoc(doc, 'a')
    expect(next.photoAssets).toEqual(['b'])
    expect(next.activePhotoId).toBeNull()
  })

  it('sanitizes corrupted documents into valid shape', () => {
    const fixed = sanitizeProject({
      name: 42,
      photoAssets: 'not-a-list',
      activeWorkspace: 'maybe',
      updatedAt: 'yesterday',
    })
    expect(fixed).not.toBeNull()
    expect(fixed?.name).toBe('Recovered Project')
    expect(fixed?.photoAssets).toEqual([])
    expect(fixed?.activeWorkspace).toBe('photo')
    expect(typeof fixed?.updatedAt).toBe('number')
  })

  it('returns null for values that cannot be projects', () => {
    expect(sanitizeProject(null)).toBeNull()
    expect(sanitizeProject(7)).toBeNull()
    expect(sanitizeProject([1, 2])).toBeNull()
  })
})
