import { describe, expect, it } from 'vitest'
import { readAudioMetadata, readId3v2, readMp4Meta } from './metadata'

/** Build a minimal ID3v2.3 tag block with the given frames. */
function id3v2(frames: { id: string; text: string }[]): ArrayBuffer {
  const parts: Uint8Array[] = []
  let tagSize = 0
  for (const f of frames) {
    const enc = new Uint8Array([3]) // UTF-8
    const text = new TextEncoder().encode(f.text)
    const frame = new Uint8Array(10 + enc.length + text.length)
    frame.set(new TextEncoder().encode(f.id), 0)
    const contentSize = enc.length + text.length // encoding + text
    frame[4] = (contentSize >> 21) & 0x7f
    frame[5] = (contentSize >> 14) & 0x7f
    frame[6] = (contentSize >> 7) & 0x7f
    frame[7] = contentSize & 0x7f
    frame[8] = 0 // flags high
    frame[9] = 0 // flags low
    frame[10] = enc[0] // encoding
    frame.set(text, 11)
    parts.push(frame)
    tagSize += frame.length
  }
  const header = new Uint8Array(10)
  header.set(new TextEncoder().encode('ID3'), 0)
  header[3] = 3 // major version
  header[4] = 0
  header[5] = 0
  header[6] = (tagSize >> 21) & 0x7f
  header[7] = (tagSize >> 14) & 0x7f
  header[8] = (tagSize >> 7) & 0x7f
  header[9] = tagSize & 0x7f
  parts.unshift(header)
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out.buffer
}

describe('readId3v2', () => {
  it('reads title/artist/album/genre/year from an MP3 tag', () => {
    const buf = id3v2([
      { id: 'TIT2', text: '夜桜' },
      { id: 'TPE1', text: '宇多田ヒカル' },
      { id: 'TALB', text: 'Fantôme' },
      { id: 'TCON', text: 'J-Pop' },
      { id: 'TYER', text: '2016' },
    ])
    expect(readId3v2(buf)).toEqual({
      title: '夜桜',
      artist: '宇多田ヒカル',
      album: 'Fantôme',
      genre: 'J-Pop',
      year: '2016',
    })
  })

  it('returns empty for a file without ID3 tags', () => {
    expect(readId3v2(new Uint8Array(100).buffer)).toEqual({})
  })

  it('ignores unknown frames and keeps only known ones', () => {
    const buf = id3v2([
      { id: 'TXXX', text: 'custom' },
      { id: 'TIT2', text: 'Only Title' },
    ])
    expect(readId3v2(buf)).toEqual({ title: 'Only Title' })
  })
})

describe('readMp4Meta', () => {
  it('returns empty for a buffer without mp4 atoms', () => {
    expect(readMp4Meta(new Uint8Array(100).buffer)).toEqual({})
  })
})

describe('readAudioMetadata', () => {
  it('returns empty for a non-audio file type (no slice needed)', async () => {
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' })
    expect(await readAudioMetadata(file)).toEqual({})
  })
})
