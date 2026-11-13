/**
 * Beat detection & beat-sync (pure, no imports from the editor).
 *
 * `detectBeats` runs a classic energy/onset analysis entirely on the decoded
 * PCM of the music track — nothing leaves the device. `syncCutsToBeats`
 * retrims clip boundaries so every cut lands on a beat (CapCut's
 * "sync cuts to beat").
 */

export interface BeatInfo {
  /** Detected tempo, 60–180 BPM (0 when detection failed). */
  bpm: number
  /** Beat times in music seconds, ascending. */
  beats: number[]
}

/** Longest drift a boundary may travel to reach a beat (seconds). */
export const MAX_SNAP_OFFSET = 0.45

/**
 * Energy/onset-based beat detection. Robust for typical music; returns
 * { bpm: 0, beats: [] } when the signal is too sparse or noisy to trust.
 */
export function detectBeats(samples: Float32Array, sampleRate: number): BeatInfo {
  if (samples.length < sampleRate) return { bpm: 0, beats: [] }
  const hop = 256
  const frames = Math.floor(samples.length / hop)
  if (frames < 32) return { bpm: 0, beats: [] }

  // 1. Per-frame energy (RMS²), then a positive-difference onset envelope.
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const base = f * hop
    for (let i = 0; i < hop; i++) {
      const v = samples[base + i]
      sum += v * v
    }
    energy[f] = sum / hop
  }
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1]
    onset[f] = d > 0 ? d : 0
  }

  // 2. Peak picking against a local adaptive threshold (±0.35 s window).
  const fps = sampleRate / hop
  const win = Math.max(2, Math.round(fps * 0.35))
  const minGapFrames = Math.max(1, Math.round(fps * 0.12))
  const onsets: number[] = [] // refined frame positions (fractional)
  let lastPeak = -minGapFrames
  for (let f = 1; f < frames - 1; f++) {
    if (onset[f] <= onset[f - 1] || onset[f] < onset[f + 1]) continue
    let mean = 0
    let count = 0
    for (let i = Math.max(0, f - win); i <= Math.min(frames - 1, f + win); i++) {
      mean += onset[i]
      count++
    }
    mean /= Math.max(1, count)
    if (onset[f] > mean * 1.4 && onset[f] > 0 && f - lastPeak >= minGapFrames) {
      // Parabolic interpolation: recover sub-frame timing from the
      // neighbouring envelope samples.
      const l = onset[f - 1]
      const c = onset[f]
      const r = onset[f + 1]
      const denom = l - 2 * c + r
      const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * denom))) : 0
      onsets.push(f + shift)
      lastPeak = f
    }
  }
  if (onsets.length < 6) return { bpm: 0, beats: [] }

  // 3. Tempo candidates: fold every inter-onset interval into 60–180 BPM and
  //    vote in a fine histogram (also vote octave siblings, weaker).
  const intervalVotes = new Map<number, number>()
  const vote = (bpm: number, weight: number): void => {
    const key = Math.round(bpm * 2) / 2
    intervalVotes.set(key, (intervalVotes.get(key) ?? 0) + weight)
  }
  for (let i = 1; i < onsets.length; i++) {
    const seconds = (onsets[i] - onsets[i - 1]) / fps
    if (seconds < 0.15) continue
    let ioi = 60 / seconds
    while (ioi < 60) ioi *= 2
    while (ioi > 180) ioi /= 2
    vote(ioi, 1)
    vote(ioi * 2, 0.25)
    vote(ioi / 2, 0.25)
  }
  let bestBpm = 0
  let bestScore = 0
  for (const [bpm] of intervalVotes) {
    // Merge votes from neighbouring bins (±1 BPM) before comparing.
    let merged = 0
    for (const [b, s] of intervalVotes) if (Math.abs(b - bpm) <= 1) merged += s
    if (merged > bestScore) {
      bestScore = merged
      bestBpm = bpm
    }
  }
  if (bestBpm <= 0) return { bpm: 0, beats: [] }

  // 3b. Refine the tempo: weighted mean of the intervals that fold near the
  //     winner (±3 BPM) — beats the 0.5-BPM histogram resolution.
  let refinedSum = 0
  let refinedWeight = 0
  for (let i = 1; i < onsets.length; i++) {
    const seconds = (onsets[i] - onsets[i - 1]) / fps
    if (seconds < 0.15) continue
    let ioi = 60 / seconds
    while (ioi < 60) ioi *= 2
    while (ioi > 180) ioi /= 2
    if (Math.abs(ioi - bestBpm) <= 3) {
      refinedSum += ioi * seconds
      refinedWeight += seconds
    }
  }
  if (refinedWeight > 0) bestBpm = refinedSum / refinedWeight

  // 4. Phase-lock: choose the grid offset that best aligns with the onsets,
  //    weighting by onset strength.
  const interval = 60 / bestBpm
  const duration = samples.length / sampleRate
  let bestPhase = 0
  let bestAlign = -1
  const bins = Math.round(interval * fps)
  for (let phase = 0; phase < bins; phase++) {
    let score = 0
    for (const f of onsets) {
      const t = f / fps
      const dist = Math.abs(((t - phase / fps) % interval + interval * 1.5) % interval - interval / 2)
      if (dist < interval * 0.12) score += onset[f]
    }
    if (score > bestAlign) {
      bestAlign = score
      bestPhase = phase / fps
    }
  }

  const beats: number[] = []
  for (let t = bestPhase; t < duration - 0.05; t += interval) {
    beats.push(Math.round(t * 1000) / 1000)
  }
  return { bpm: Math.round(bestBpm * 10) / 10, beats }
}

/** Nearest beat to `t`, or null when none is within `maxOffset`. */
export function nearestBeat(t: number, beats: readonly number[], maxOffset = MAX_SNAP_OFFSET): number | null {
  let best: number | null = null
  let bestDist = maxOffset
  for (const b of beats) {
    const dist = Math.abs(b - t)
    if (dist < bestDist) {
      bestDist = dist
      best = b
    }
  }
  return best
}

/** Snaps a playhead/edge time onto the beat grid (used by timeline snapping). */
export function snapTime(t: number, beats: readonly number[], maxOffset = MAX_SNAP_OFFSET): number {
  return nearestBeat(t, beats, maxOffset) ?? t
}
