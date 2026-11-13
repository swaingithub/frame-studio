/**
 * Auto-captions model (pure logic).
 *
 * Whisper transcribes each clip's trimmed audio window separately and returns
 * segments in SOURCE time (seconds into the trim window). This module maps
 * them onto the sequence timeline — accounting for each clip's trim offset and
 * speed — and turns them into caption overlays. No imports from the editor
 * store, so every function here is unit-testable.
 */

/** One transcript chunk, in the transcribed audio's own seconds. */
export interface RawCaptionSegment {
  start: number
  end: number
  text: string
}

/** One caption, in global sequence seconds. */
export interface CaptionSegment {
  start: number
  end: number
  text: string
}

/** What the transcriber needs to know about one clip's audio window. */
export interface ClipAudioWindow {
  /** VideoClip.id the audio belongs to. */
  clipId: string
  /** Where the clip sits on the sequence timeline. */
  globalStart: number
  /** Trim window in source seconds (trimEnd null = open end). */
  trimStart: number
  trimEnd: number | null
  /** Playback speed (0/negative treated as 1). */
  speed: number
  /** Sequence length of the clip's output (already min-clamped). */
  out: number
}

/** Shortest caption we are willing to show; ultra-short segments get padded. */
export const MIN_CAPTION_OUT = 0.4

/** Maps SOURCE seconds (inside the trim window) to global sequence seconds. */
export function sourceToSequenceTime(window: ClipAudioWindow, srcTime: number): number {
  const speed = window.speed > 0 ? window.speed : 1
  return window.globalStart + (Math.max(0, srcTime) - window.trimStart) / speed
}

/**
 * Maps one clip's transcript (SOURCE-time segments, i.e. offsets into the
 * decoded trim window) onto the sequence timeline. Segments are clamped to the
 * clip's output span so a chunk that straddles the trim end cannot spill onto
 * the next clip.
 */
export function mapClipSegments(window: ClipAudioWindow, segments: readonly RawCaptionSegment[]): CaptionSegment[] {
  const speed = window.speed > 0 ? window.speed : 1
  const spanEnd = window.trimEnd !== null ? window.trimEnd - window.trimStart : Infinity
  const result: CaptionSegment[] = []
  for (const segment of segments) {
    if (typeof segment !== 'object' || segment === null) continue
    const text = typeof segment.text === 'string' ? segment.text.replace(/\s+/g, ' ').trim() : ''
    if (!text) continue
    const localStart = Math.max(0, Number(segment.start) || 0)
    const localEnd = Math.max(localStart, Number(segment.end) || localStart)
    // Nothing meaningful survives outside the trim window.
    if (localStart >= spanEnd) continue
    const clampedEnd = Math.min(localEnd, spanEnd)
    const seqStart = window.globalStart + localStart / speed
    const seqEnd = window.globalStart + clampedEnd / speed
    // Effectively-empty chunks are dropped; MIN_CAPTION_OUT pads the rest.
    if (seqEnd - seqStart < 0.02) continue
    result.push({ start: seqStart, end: Math.max(seqStart + 0.05, seqEnd), text: text.slice(0, 200) })
  }
  // Merge neighbours that whisper split mid-sentence (gap < 60 ms) and pad
  // ultra-short reads so captions don't flash.
  const merged: CaptionSegment[] = []
  for (const segment of result) {
    const previous = merged[merged.length - 1]
    if (previous && segment.start - previous.end < 0.06 && segment.text.length + previous.text.length <= 200) {
      previous.end = segment.end
      previous.text = `${previous.text} ${segment.text}`
      continue
    }
    merged.push({ ...segment })
  }
  for (const segment of merged) {
    segment.start = Math.max(0, segment.start)
    segment.end = Math.max(segment.start + MIN_CAPTION_OUT, segment.end)
  }
  return merged
}

/** Repairs a transcript read back from storage (or a worker message). */
export function sanitizeSegments(raw: unknown): RawCaptionSegment[] {
  if (!Array.isArray(raw)) return []
  const out: RawCaptionSegment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const start = typeof rec.start === 'number' && Number.isFinite(rec.start) ? Math.max(0, rec.start) : null
    const end = typeof rec.end === 'number' && Number.isFinite(rec.end) ? Math.max(0, rec.end) : null
    const text = typeof rec.text === 'string' ? rec.text.replace(/\s+/g, ' ').trim() : ''
    if (start === null || end === null || !text || end <= start) continue
    out.push({ start, end, text: text.slice(0, 200) })
  }
  return out
}

/** Flattens per-clip windows + transcripts into sorted sequence captions. */
export function captionsForSequence(
  windows: readonly ClipAudioWindow[],
  transcripts: ReadonlyArray<readonly RawCaptionSegment[]>,
): CaptionSegment[] {
  const all = windows.flatMap((window, index) => mapClipSegments(window, transcripts[index] ?? []))
  return all.sort((a, b) => a.start - b.start)
}

/**
 * Caption styling shared by every generated overlay (CapCut-style: bold text,
 * slightly above the bottom edge, subtle scale for readability at any canvas
 * size).
 */
export const CAPTION_BASE = { scale: 1.1, x: 0.5, y: 0.88, opacity: 1 } as const
