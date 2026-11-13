// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, PROJECT_SCHEMA_VERSION } from './schema'
import { putBlob, getBlob, deleteBlob } from './blobStore'
import { importFiles } from '../../features/library/import'
import { addAssetsToDoc, createProjectDoc, sanitizeProject } from '../../features/projects/model'

const PNG_1PX = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
))

function pngFile(name = 'tiny.png'): File {
  return new File([PNG_1PX.slice()], name, { type: 'image/png' })
}

/**
 * jsdom has no image decoder, so `createImageBitmap` is stubbed with a
 * minimal stand-in: the pipeline under test is metadata routing + storage,
 * not JPEG decoding (that exercises the real browser in Phase 2's WebGL tests).
 */
beforeEach(async () => {
  class FakeBitmap {
    width = 1
    height = 1
    close(): void {
      /* no-op */
    }
  }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => new FakeBitmap()))
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('blob store', () => {
  it('round-trips a blob through IndexedDB', async () => {
    const ref = await putBlob(new Blob(['hello'], { type: 'text/plain' }))
    expect(ref.storage).toBe('idb')
    const back = await getBlob(ref)
    expect(back).not.toBeNull()
    const text = new TextDecoder().decode(await (back as Blob).arrayBuffer())
    expect(text).toBe('hello')
    await deleteBlob(ref)
    expect(await getBlob(ref)).toBeNull()
  })
})

describe('import pipeline', () => {
  it('imports a valid image with dimensions and records storage', async () => {
    const result = await importFiles([pngFile('pixel.png')])
    expect(result.failed).toHaveLength(0)
    const [asset] = result.imported
    expect(asset.kind).toBe('image')
    expect(asset.width).toBe(1)
    expect(asset.height).toBe(1)
    // No OffscreenCanvas/Worker in jsdom, so the worker thumb is skipped.
    expect(asset.thumbKey).toBeNull()
    const ref = await getBlob({ key: asset.storageKey, storage: asset.storage })
    if (!ref) throw new Error('stored blob should exist')
    expect(new Uint8Array(await ref.arrayBuffer())).toEqual(PNG_1PX)
    const record = await db.assets.get(asset.id)
    expect(record?.name).toBe('pixel.png')
  })

  it('rejects unsupported types with a friendly reason', async () => {
    const result = await importFiles([new File([new Uint8Array([1, 2, 3])], 'mystery.bin')])
    expect(result.imported).toHaveLength(0)
    expect(result.failed[0]?.reason).toMatch(/Unsupported/)
  })

  it('reports empty files as failures', async () => {
    const result = await importFiles([new File([], 'empty.png', { type: 'image/png' })])
    expect(result.failed[0]?.reason).toMatch(/empty/i)
  })

  it('keeps original bytes intact (non-destructive by design)', async () => {
    const file = pngFile()
    const { imported } = await importFiles([file])
    const ref = await getBlob({ key: imported[0].storageKey, storage: imported[0].storage })
    if (!ref) throw new Error('stored blob should exist')
    const original = new Uint8Array(await file.arrayBuffer())
    const stored = new Uint8Array(await ref.arrayBuffer())
    expect(stored).toEqual(original)
  })
})

describe('persistence round-trip', () => {
  it('stores assets and projects in IndexedDB and can restore them', async () => {
    const { imported } = await importFiles([pngFile('restore.png')])
    const doc = createProjectDoc('Recovered Test', 'photo')
    const project = addAssetsToDoc(doc, imported.map((a) => a.id), 'image')
    await db.projects.put(project)
    await Promise.all(imported.map((a) => db.assets.put(a)))

    // Simulate a fresh reload
    const projects = (await db.projects.toArray()).map((p) => sanitizeProject(p))
    expect(projects[0]?.name).toBe('Recovered Test')
    expect(projects[0]?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(projects[0]?.photoAssets).toEqual(imported.map((a) => a.id))
    const asset = await db.assets.get(imported[0].id)
    expect(asset?.kind).toBe('image')
  })
})
