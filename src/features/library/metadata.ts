/**
 * ID3 (MP3) + MP4/M4A metadata reader.
 *
 * Dependency-free, reads only the head of each file, so importing a large
 * personal music collection stays fast. Everything runs on-device; nothing
 * leaves the machine.
 *
 * Returns title / artist / album / genre / year so the library displays
 * real track info instead of bare filenames — for songs in any language.
 */

interface AudioMeta {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: string
}

const TEXT_ENCODINGS: Record<number, (bytes: Uint8Array) => string> = {
  0: (b) => new TextDecoder('latin1').decode(b),
  1: (b) => new TextDecoder('utf-16be', { ignoreBOM: true }).decode(b),
  2: (b) => new TextDecoder('utf-16be', { ignoreBOM: true }).decode(b),
  3: (b) => new TextDecoder('utf-8').decode(b),
}

/** Synchsafe integer (ID3 size fields use 7 bits per byte). */
function readSynchsafe(buf: DataView, off: number): number {
  let v = 0
  for (let i = 0; i < 4; i++) v = (v << 7) | buf.getUint8(off + i)
  return v
}

/** Nul-terminated string decode, best effort. */
function decodeText(bytes: Uint8Array): string {
  // Strip leading encoding byte + BOM-ish cruft.
  let start = 0
  if (bytes.length > 0 && bytes[0] <= 3) start = 1
  const chunk = bytes.slice(start)
  // Drop NUL / BOM bytes.
  const clean = chunk.filter((b) => b !== 0 && !(b === 0xfe || b === 0xff))
  if (clean.length === 0) return ''
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(clean)
  } catch {
    return new TextDecoder('latin1', { fatal: false }).decode(clean)
  }
}

/** Read ID3v2 tags from the start of an MP3 file. */
export function readId3v2(buf: ArrayBuffer): AudioMeta {
  const view = new DataView(buf)
  const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2))
  if (sig !== 'ID3') return {}
  const size = readSynchsafe(view, 6)
  const tagEnd = Math.min(10 + size, buf.byteLength)
  let off = 10
  const meta: AudioMeta = {}
  const want: Record<string, keyof AudioMeta> = {
    TIT2: 'title',
    TPE1: 'artist',
    TALB: 'album',
    TCON: 'genre',
    TYER: 'year',
    TDRC: 'year',
  }
  while (off + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    )
    const frameSize = readSynchsafe(view, off + 4)
    const frameStart = off + 10
    const frameEnd = Math.min(frameStart + frameSize, tagEnd)
    if (frameSize <= 0 || frameEnd <= frameStart) {
      off += 10 + frameSize
      continue
    }
    const key = want[frameId]
    if (key && !meta[key] && frameStart + 1 <= frameEnd) {
      const enc = view.getUint8(frameStart)
      const decoder = TEXT_ENCODINGS[enc] ?? TEXT_ENCODINGS[0]
      const textBytes = new Uint8Array(buf, frameStart + 1, frameEnd - frameStart - 1)
      const text = decoder(textBytes).split('\0')[0].trim()
      if (text) meta[key] = text
    }
    off += 10 + frameSize
  }
  return meta
}

/** Read MP4/M4A metadata atoms from the head of the file. */
export function readMp4Meta(buf: ArrayBuffer): AudioMeta {
  const view = new DataView(buf)
  const meta: AudioMeta = {}
  const want: Record<string, keyof AudioMeta> = {
    '\u00a9nam': 'title',
    '\u00a9ART': 'artist',
    '\u00a9alb': 'album',
    '\u00a9gen': 'genre',
    '\u00a9day': 'year',
  }
  let off = 0
  const limit = Math.min(buf.byteLength, 4 * 1024 * 1024) // scan first 4 MB
  while (off + 8 <= limit) {
    const size = view.getUint32(off, false)
    const type = String.fromCharCode(
      view.getUint8(off + 4),
      view.getUint8(off + 5),
      view.getUint8(off + 6),
      view.getUint8(off + 7),
    )
    if (size <= 0 || off + size > limit) break
    if (want[type] && size > 16) {
      // Full box: version(1) + flags(3) at +8, then data.
      const dataStart = off + 16
      const dataEnd = Math.min(off + size, buf.byteLength)
      if (dataEnd > dataStart) {
        const bytes = new Uint8Array(buf, dataStart, dataEnd - dataStart)
        const text = decodeText(bytes).trim()
        if (text) meta[want[type]] = text
      }
    }
    // dril-down into 'moov'/'meta'/'udta' containers.
    if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'meta' || type === 'udta') {
      const inner = readMp4Meta(buf.slice(off + 8, off + size))
      for (const [k, v] of Object.entries(inner)) {
        const key = k as keyof AudioMeta
        if (!meta[key]) meta[key] = v
      }
    }
    if (size === 0) break // unsized box, end of stream
    off += size
  }
  return meta
}

/** Detect encoding / container from file name + MIME type. */
function containerOf(name: string, mime: string): 'mp3' | 'mp4' | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (ext === '.mp3' || mime === 'audio/mpeg' || mime.startsWith('audio/mpeg')) return 'mp3'
  if (['.m4a', '.m4b', '.m4p', '.mp4', '.aac'].includes(ext) ||
      mime.startsWith('audio/mp4') || mime.startsWith('audio/x-m4a') ||
      mime.startsWith('audio/m4a') || mime === 'audio/aac') return 'mp4'
  return null
}

/**
 * Read title/artist/album/genre/year from an audio file.
 * Only the head of the file is loaded; returns {} when nothing readable.
 */
export async function readAudioMetadata(file: File): Promise<AudioMeta> {
  const container = containerOf(file.name, file.type)
  if (!container) return {}
  const headBytes = container === 'mp3' ? 256 * 1024 : 4 * 1024 * 1024
  const slice = file.slice(0, Math.min(headBytes, file.size))
  const buf = await slice.arrayBuffer()
  if (container === 'mp3') return readId3v2(buf)
  return readMp4Meta(buf)
}
