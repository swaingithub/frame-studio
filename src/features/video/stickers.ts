/**
 * Sticker catalog — a small offline emoji set organised by category.
 * Stickers are inserted as text overlays (emoji glyph, larger base scale),
 * so they reuse the whole overlay pipeline: drag/positioning, keyframes,
 * animation presets, export and captions coexist for free. No downloads.
 */

export interface StickerCategory {
  label: string
  emojis: string[]
}

export const STICKER_CATEGORIES: readonly StickerCategory[] = [
  {
    label: 'Smileys',
    emojis: ['😀', '😂', '🥹', '😍', '🤩', '😎', '🥳', '😴', '🤯', '🫠', '😭', '😡'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '💔', '💖', '✨', '🔥', '⭐', '💯', '🎉', '💫', '🫶'],
  },
  {
    label: 'Fun',
    emojis: ['👍', '👏', '🙌', '🤝', '🤌', '👀', '🧠', '💀', '🤖', '👻', '🎃', '🦄'],
  },
  {
    label: 'Mood',
    emojis: ['☕', '🍕', '🍔', '🍿', '🎸', '🎮', '🚀', '🌈', '☀️', '🌙', '⚡', '🌊'],
  },
  {
    label: 'Film',
    emojis: ['🎬', '🎥', '📸', '🎙️', '📺', '🎞️', '💡', '🎤', '⏱️', '🔔', '❌', '✅'],
  },
]

/** Default base scale for a freshly inserted sticker (text overlays are 1). */
export const STICKER_DEFAULT_SCALE = 2.4

/** The flattened catalogue — handy for tests and picker rendering. */
export function allStickers(): string[] {
  return STICKER_CATEGORIES.flatMap((c) => c.emojis)
}

/** Guards a stored/inserted emoji: single-ish grapheme, bounded length. */
export function sanitizeStickerText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > 8) return null
  return text
}
