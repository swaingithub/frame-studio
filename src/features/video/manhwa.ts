/**
 * Manhwa workflow: sync an image panel's animation to a Kokoro voiceover.
 *
 * The panel fades in as the voice speaks, swells to a peak mid-voice, then
 * settles toward 1. Each Whisper segment (word/phrase) adds a brief
 * emphasis swell, so the panel reacts to the speech itself. Pure — the
 * stage engine and the tests share this math.
 */

import type { CaptionSegment } from './captions'
import { type Keyframe, type KeyframeSet } from './sequenceAnim'
import { clampAnimValue, type AnimBase } from './sequenceModel'
import { upsertKeyframe } from './storeHelpers'

/**
 * Builds the overlay's keyframes for a panel animated over the voice span
 * (seconds). All times are relative to the overlay's start; the caller sets
 * the overlay's timing separately.
 */
export function buildVoiceSyncKeyframes(segments: readonly CaptionSegment[], span: number): KeyframeSet {
  const s = Math.max(0.5, span)
  let opacity: Keyframe[] = []
  let scale: Keyframe[] = []

  const put = (track: Keyframe[], prop: keyof AnimBase, t: number, v: number): Keyframe[] =>
    upsertKeyframe(track, t, clampAnimValue(prop, v))

  // Base swell over the voice: rise from 0.8 as the voice speaks, peak
  // mid-voice, settle to 1.
  scale = put(scale, 'scale', 0, 0.8)
  scale = put(scale, 'scale', 0.3 * s, 1.32)
  scale = put(scale, 'scale', 0.65 * s, 1.08)
  scale = put(scale, 'scale', s, 1)

  // Fade in as the voice begins, out as it ends.
  opacity = put(opacity, 'opacity', 0, 0)
  opacity = put(opacity, 'opacity', 0.1 * s, 1)
  opacity = put(opacity, 'opacity', 0.9 * s, 1)
  opacity = put(opacity, 'opacity', s, 0.04)

  // Word-level reaction — a brief emphasis swell at each segment.
  for (const seg of segments) {
    const start = Math.max(0, seg.start)
    const end = Math.max(start + 0.1, Math.min(s, seg.end))
    scale = put(scale, 'scale', start, 1.28)
    scale = put(scale, 'scale', end, 1.06)
  }

  const byTime = (a: Keyframe, b: Keyframe): number => a.t - b.t
  return { scale: scale.slice().sort(byTime), opacity: opacity.slice().sort(byTime), x: [], y: [] }
}
