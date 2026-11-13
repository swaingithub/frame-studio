import { describe, expect, it } from 'vitest'
import { allStickers, sanitizeStickerText, STICKER_CATEGORIES, STICKER_DEFAULT_SCALE } from './stickers'

describe('sticker catalog', () => {
  it('has non-empty categories with short emoji-only entries', () => {
    expect(STICKER_CATEGORIES.length).toBeGreaterThanOrEqual(4)
    for (const category of STICKER_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(1)
      expect(category.emojis.length).toBeGreaterThanOrEqual(8)
      for (const emoji of category.emojis) {
        expect(emoji.length).toBeLessThanOrEqual(4)
        expect(sanitizeStickerText(emoji)).toBe(emoji)
      }
    }
    // No accidental duplicates.
    expect(new Set(allStickers()).size).toBe(allStickers().length)
  })

  it('inserts stickers at a readable base scale', () => {
    expect(STICKER_DEFAULT_SCALE).toBeGreaterThan(1.5)
    expect(STICKER_DEFAULT_SCALE).toBeLessThanOrEqual(4)
  })
})

describe('sanitizeStickerText', () => {
  it('rejects garbage and over-long strings', () => {
    expect(sanitizeStickerText('')).toBeNull()
    expect(sanitizeStickerText(42)).toBeNull()
    expect(sanitizeStickerText('a'.repeat(9))).toBeNull()
  })
})
