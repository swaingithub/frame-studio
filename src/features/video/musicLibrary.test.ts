import { describe, expect, it } from 'vitest'
import { MUSIC_LIBRARY, findMusicTrack, formatMusicDuration, musicTrackUrl } from './musicLibrary'

describe('bundled music library', () => {
  it('ships at least a few CC0 tracks', () => {
    expect(MUSIC_LIBRARY.tracks.length).toBeGreaterThanOrEqual(3)
    expect(MUSIC_LIBRARY.license).toBe('CC0-1.0')
    for (const track of MUSIC_LIBRARY.tracks) {
      expect(track.license).toBe('CC0-1.0')
      expect(track.duration).toBeGreaterThan(0)
      expect(track.file.endsWith('.m4a')).toBe(true)
      expect(track.mood.length).toBeGreaterThan(0)
      expect(track.title.length).toBeGreaterThan(0)
    }
  })

  it('has unique ids and file names', () => {
    const ids = MUSIC_LIBRARY.tracks.map((t) => t.id)
    const files = MUSIC_LIBRARY.tracks.map((t) => t.file)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(files).size).toBe(files.length)
  })

  it('covers the advertised mood categories', () => {
    const categories = new Set(MUSIC_LIBRARY.tracks.map((t) => t.mood[0]))
    for (const mood of ['Chill', 'Upbeat', 'Ambient', 'Cinematic', 'Gentle', 'Hip-hop', 'Corporate', 'Horror', 'Retro']) {
      expect(categories.has(mood)).toBe(true)
    }
  })

  it('resolves local URLs only — never a remote origin', () => {
    for (const track of MUSIC_LIBRARY.tracks) {
      expect(track.source).toBe('Original synthesis')
      const url = musicTrackUrl(track.file)
      expect(url.startsWith('/')).toBe(true)
      expect(url).not.toContain('http')
      expect(url).toContain('music/')
    }
  })

  it('looks up tracks and formats durations', () => {
    const first = MUSIC_LIBRARY.tracks[0]
    expect(findMusicTrack(first.id)?.title).toBe(first.title)
    expect(findMusicTrack('nope')).toBeNull()
    expect(formatMusicDuration(5)).toBe('0:05')
    expect(formatMusicDuration(65.4)).toBe('1:05')
  })
})
