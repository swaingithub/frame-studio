import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { unzipSync } from 'fflate'
import { db, type MediaAsset } from '../../core/db/schema'
import { putBlob } from '../../core/db/blobStore'
import { createProjectDoc } from '../projects/model'
import { exportProjectBackup, importProjectBackup } from './backup'

vi.mock('../../lib/download', () => ({ downloadBlob: vi.fn() }))
import { downloadBlob } from '../../lib/download'

const lastDownload = (): Blob => {
  const calls = vi.mocked(downloadBlob).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

const mediaBytes = new TextEncoder().encode('fake video bytes')
const thumbBytes = new TextEncoder().encode('fake thumb bytes')

async function putTestAsset(): Promise<MediaAsset> {
  // Node Blobs survive fake-indexeddb's structuredClone; jsdom Blobs do not.
  const file = await putBlob(new NodeBlob([mediaBytes], { type: 'video/mp4' }) as unknown as Blob)
  const thumb = await putBlob(new NodeBlob([thumbBytes], { type: 'image/png' }) as unknown as Blob)
  const asset: MediaAsset = {
    id: 'asset_video',
    name: 'clip.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    size: mediaBytes.length,
    addedAt: 1,
    modifiedAt: null,
    width: 320,
    height: 180,
    duration: 2.5,
    camera: null,
    exif: null,
    rating: 0,
    favorite: false,
    tags: [],
    storage: file.storage,
    storageKey: file.key,
    thumbKey: thumb.key,
  }
  await db.assets.put(asset)
  return asset
}

describe('backup v2 (zip)', () => {
  beforeEach(async () => {
    vi.mocked(downloadBlob).mockClear()
    await db.assets.clear()
    await db.files.clear()
    await db.projects.clear()
  })

  it('exports a zip with the manifest and raw asset bytes', async () => {
    const asset = await putTestAsset()
    const project = createProjectDoc('Backup test', 'video')
    project.videoAssets = [asset.id]
    await db.projects.put(project)

    await exportProjectBackup(project.id)
    expect(vi.mocked(downloadBlob)).toHaveBeenCalledTimes(1)
    const files = unzipSync(new Uint8Array(await lastDownload().arrayBuffer()))
    expect(files['manifest.json']).toBeDefined()
    expect(new TextDecoder().decode(files['assets/asset_video.bin']!)).toBe('fake video bytes')
    expect(new TextDecoder().decode(files['assets/asset_video.thumb.bin']!)).toBe('fake thumb bytes')
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!))
    expect(manifest.format).toBe('frame-studio-backup')
    expect(manifest.version).toBe(2)
    expect(manifest.project.videoAssets).toEqual([asset.id])
  })

  it('imports a v2 zip and restores the project + assets', async () => {
    const asset = await putTestAsset()
    const project = createProjectDoc('Backup test', 'video')
    project.videoAssets = [asset.id]
    await db.projects.put(project)

    await exportProjectBackup(project.id)
    const newId = await importProjectBackup(new File([lastDownload()], 'test.framestudio.zip', { type: 'application/zip' }))

    const restored = await db.projects.get(newId)
    expect(restored).toBeDefined()
    expect(restored!.videoAssets).toHaveLength(1)
    const newAssetId = restored!.videoAssets[0]
    expect(newAssetId).not.toBe(asset.id)
    const newAsset = await db.assets.get(newAssetId)
    expect(newAsset).toBeDefined()
    expect(newAsset!.thumbKey).toBeTruthy()
  })

  it('still imports legacy v1 JSON backups', async () => {
    const asset = await putTestAsset()
    const project = createProjectDoc('Old', 'video')
    project.videoAssets = [asset.id]
    const dataUrl = `data:video/mp4;base64,${btoa('fake video bytes')}`
    const backup = {
      format: 'frame-studio-backup',
      version: 1,
      exportedAt: 1,
      project,
      assets: [{ asset, file: dataUrl, thumb: null }],
    }
    const newId = await importProjectBackup(new File([JSON.stringify(backup)], 'old.framestudio.json', { type: 'application/json' }))
    const restored = await db.projects.get(newId)
    expect(restored).toBeDefined()
    expect(restored!.videoAssets).toHaveLength(1)
    expect(restored!.videoAssets[0]).not.toBe(asset.id)
    expect(await db.assets.get(restored!.videoAssets[0])).toBeDefined()
  })

  it('rejects files that are not backups', async () => {
    await expect(importProjectBackup(new File(['hello'], 'x.txt', { type: 'text/plain' }))).rejects.toThrow()
  })
})
