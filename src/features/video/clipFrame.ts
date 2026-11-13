import { useEffect, useRef, useState } from 'react'
import type { TexSource } from '../../core/render/webgl'
import { useAssets, useAssetBlob } from '../library/useAssets'

/**
 * Grabs one representative frame (mid-trim) from the selected clip's video
 * so the Looks gallery can render live preset thumbnails for video, exactly
 * like the photo editor. Decodes into an offscreen canvas (a TexSource the
 * shared GL pipeline accepts), capped for memory.
 */

/** Longest edge of the thumbnail source frame. */
const FRAME_MAX_EDGE = 512

export function useClipFrame(clipId: string | null, assetId: string | null): TexSource | null {
  const assets = useAssets()
  const asset = assets?.find((a) => a.id === assetId) ?? null
  const blob = useAssetBlob(asset)
  const [frame, setFrame] = useState<TexSource | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    setFrame(null)
    if (!blob || !clipId) return
    let cancelled = false

    const url = URL.createObjectURL(blob)
    urlRef.current = url
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = url

    const cleanup = (): void => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      urlRef.current = null
    }

    const onSeeked = (): void => {
      if (cancelled) return
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return
      const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(vw, vh))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(2, Math.round(vw * scale))
      canvas.height = Math.max(2, Math.round(vh * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        setFrame(canvas)
      } catch {
        // drawImage can throw on undecodable frames — leave thumbnails off.
      }
    }

    video.addEventListener('loadedmetadata', () => {
      if (cancelled) return
      const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0
      video.addEventListener('seeked', onSeeked, { once: true })
      video.currentTime = target
    })
    video.addEventListener('error', () => {
      if (!cancelled) setFrame(null)
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [blob, clipId])

  return frame
}

