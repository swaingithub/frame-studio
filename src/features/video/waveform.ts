import { useEffect, useState } from 'react'
import { getBlob } from '../../core/db/blobStore'
import type { MediaAsset } from '../../core/db/schema'

/**
 * Audio waveform peaks for timeline clips (CapCut-style waveforms drawn on
 * the clip block). Decodes the asset's audio once per asset, reduces it to a
 * fixed number of RMS bins, and caches the result for the session.
 */

const BINS = 96
const cache = new Map<string, number[]>()
const pending = new Map<string, Promise<number[]>>()
let sharedCtx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  try {
    if (!sharedCtx) sharedCtx = new AudioContext()
    return sharedCtx
  } catch {
    return null
  }
}

function reduceToPeaks(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0)
  const perBin = Math.max(1, Math.floor(channel.length / BINS))
  const peaks: number[] = []
  let max = 0.0001
  for (let b = 0; b < BINS; b++) {
    let sum = 0
    const start = b * perBin
    const end = Math.min(channel.length, start + perBin)
    for (let i = start; i < end; i++) sum += channel[i] * channel[i]
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    peaks.push(rms)
    if (rms > max) max = rms
  }
  // Normalize to 0..1 with a slight gamma so quiet clips still read.
  return peaks.map((p) => Math.min(1, Math.pow(p / max, 0.7)))
}

function load(asset: MediaAsset): Promise<number[]> {
  const cached = cache.get(asset.id)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(asset.id)
  if (inflight) return inflight
  const job = (async (): Promise<number[]> => {
    const blob = await getBlob({ key: asset.storageKey, storage: asset.storage })
    if (!blob) throw new Error('missing blob')
    const ctx = audioCtx()
    if (!ctx) throw new Error('no audio context')
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    const peaks = reduceToPeaks(buffer)
    cache.set(asset.id, peaks)
    return peaks
  })()
    .finally(() => pending.delete(asset.id))
  pending.set(asset.id, job)
  return job
}

/** Reactive waveform peaks for an asset (null while decoding / on failure). */
export function useWaveform(asset: MediaAsset | null | undefined): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => (asset ? cache.get(asset.id) ?? null : null))
  useEffect(() => {
    if (!asset) return
    const cached = cache.get(asset.id)
    if (cached) {
      setPeaks(cached)
      return
    }
    let alive = true
    setPeaks(null)
    load(asset)
      .then((p) => {
        if (alive) setPeaks(p)
      })
      .catch(() => {
        // Not decodable (image assets, codec gaps) — no waveform, no error.
      })
    return () => {
      alive = false
    }
  }, [asset])
  return peaks
}
