/**
 * Combine: stitches 2+ library images into one output image (row / column /
 * grid) and returns it as a PNG. Pure canvas work — runs on-device.
 */

import { getBlob } from '../../core/db/blobStore'
import type { MediaAsset } from '../../core/db/schema'

export type CombineLayout = 'row' | 'column' | 'grid'

export interface CombineOptions {
  layout: CombineLayout
}

export async function combineImages(assets: readonly MediaAsset[], options: CombineOptions): Promise<Blob> {
  const gap = 16
  const pad = 8
  const bitmaps: ImageBitmap[] = []
  const dims: { w: number; h: number }[] = []
  try {
    for (const asset of assets) {
      const blob = await getBlob({ key: asset.storageKey, storage: asset.storage ?? 'idb' })
      if (!blob) throw new Error(`Source missing for ${asset.name}`)
      const bmp = await createImageBitmap(blob)
      bitmaps.push(bmp)
      dims.push({ w: bmp.width, h: bmp.height })
    }
    if (bitmaps.length < 2) throw new Error('Select at least two images to combine.')

    const { layout } = options
    let W = 0
    let H = 0
    if (layout === 'row') {
      const maxH = Math.max(...dims.map((d) => d.h))
      W = pad * 2 + dims.reduce((a, d) => a + d.w, 0) + gap * (bitmaps.length - 1)
      H = pad * 2 + maxH
    } else if (layout === 'column') {
      const maxW = Math.max(...dims.map((d) => d.w))
      W = pad * 2 + maxW
      H = pad * 2 + dims.reduce((a, d) => a + d.h, 0) + gap * (bitmaps.length - 1)
    } else {
      const cols = Math.ceil(Math.sqrt(bitmaps.length))
      const rows = Math.ceil(bitmaps.length / cols)
      const cellW = Math.max(...dims.map((d) => d.w))
      const cellH = Math.max(...dims.map((d) => d.h))
      W = pad * 2 + cols * cellW + gap * (cols - 1)
      H = pad * 2 + rows * cellH + gap * (rows - 1)
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.round(W))
    canvas.height = Math.max(2, Math.round(H))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D canvas context')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const draw = (i: number, x: number, y: number, scale = 1): void => {
      ctx.drawImage(bitmaps[i], x, y, dims[i].w * scale, dims[i].h * scale)
    }
    if (layout === 'row') {
      const maxH = Math.max(...dims.map((d) => d.h))
      let x = pad
      for (let i = 0; i < bitmaps.length; i++) {
        draw(i, x, pad + (maxH - dims[i].h) / 2)
        x += dims[i].w + gap
      }
    } else if (layout === 'column') {
      const maxW = Math.max(...dims.map((d) => d.w))
      let y = pad
      for (let i = 0; i < bitmaps.length; i++) {
        draw(i, pad + (maxW - dims[i].w) / 2, y)
        y += dims[i].h + gap
      }
    } else {
      const cols = Math.ceil(Math.sqrt(bitmaps.length))
      const cellW = Math.max(...dims.map((d) => d.w))
      const cellH = Math.max(...dims.map((d) => d.h))
      for (let i = 0; i < bitmaps.length; i++) {
        const r = Math.floor(i / cols)
        const c = i % cols
        const scale = Math.min(1, (cellW - pad * 2) / dims[i].w, (cellH - pad * 2) / dims[i].h)
        draw(i, pad + c * (cellW + gap), pad + r * (cellH + gap), scale)
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new Error('Encoding failed')
    return blob
  } finally {
    for (const b of bitmaps) b.close()
  }
}
