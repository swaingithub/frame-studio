import Dexie, { type Table } from 'dexie'

/**
 * Central data model. Assets live in a global library; projects reference
 * assets by id. Binary media lives in the `files` table (IndexedDB) or OPFS
 * for very large files (see blobStore.ts).
 */

export type AssetKind = 'image' | 'video' | 'audio'
export type WorkspaceKind = 'photo' | 'video'
export type BlobStorage = 'idb' | 'opfs'

export interface MediaAsset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  /** Original file size in bytes. */
  size: number
  addedAt: number
  /** File's own last-modified timestamp, if provided by the OS. */
  modifiedAt: number | null
  /** Pixel dimensions (image/video only). */
  width: number | null
  height: number | null
  /** Seconds (video/audio only). */
  duration: number | null
  /** EXIF camera model, when detected. Full EXIF lands in Phase 2. */
  camera: string | null
  /** Subset of EXIF metadata surfaced in the inspector. */
  exif: Record<string, string | number> | null
  /** 0–5 user rating. */
  rating: number
  favorite: boolean
  tags: string[]
  storage: BlobStorage
  storageKey: string
  thumbKey: string | null
}

/**
 * Project document. Edit payloads are plain JSON lists of serializable
 * operations (filled in by the render pipeline in Phases 2 & 4).
 */
export interface ProjectDoc {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  activeWorkspace: WorkspaceKind
  /** Ordered asset ids appearing in the photo workspace. */
  photoAssets: string[]
  videoAssets: string[]
  activePhotoId: string | null
  /** The video workspace's selected clip id. */
  activeVideoId: string | null
  /** Per-photo operation stacks, keyed by asset id (Phase 2). */
  photoEdits: Record<string, unknown>
  /** Per-clip edit docs (grade, trim, volume), keyed by asset id (Phase 4). */
  videoEdits: Record<string, unknown>
  /** Ordered clip sequence — { clips, music }, sanitized by the video editor. */
  videoSequence: unknown | null
  /** The video workspace's selected sequence-clip instance id. */
  activeVideoClipId: string | null
  /** Timeline document (legacy, Phase 4). */
  timeline: unknown | null
  /** Bumped whenever the document shape changes. Enables migration. */
  schemaVersion: number
}

export const PROJECT_SCHEMA_VERSION = 1

/** Blob records for originals and thumbnails. */
export interface FileRecord {
  key: string
  blob: Blob
}

export class FrameStudioDB extends Dexie {
  projects!: Table<ProjectDoc, string>
  assets!: Table<MediaAsset, string>
  files!: Table<FileRecord, string>

  constructor() {
    super('frame-studio')
    this.version(2)
      .stores({
        projects: 'id, name, updatedAt',
        assets: 'id, name, kind, addedAt, favorite, rating, *tags',
        files: 'key',
      })
      .upgrade(() => {
        // Migration scaffolding: future schema changes bump the version and
        // plug in here — new stores, or data moves on the upgrade transaction.
        // Nothing to migrate yet (v2 is a no-op upgrade).
      })
  }
}

export const db = new FrameStudioDB()
