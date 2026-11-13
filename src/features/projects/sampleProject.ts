import { importFiles } from '../library/import'
import { useProjectsStore } from './store'
import { toast } from '../../ui/toastStore'

/**
 * First-run "sample project": three procedurally generated images plus a
 * short procedurally animated video (no bundled assets, no network) imported
 * through the normal pipeline so everything a new user touches behaves
 * exactly like real media.
 */

type Style = 'dawn' | 'mesh' | 'mono'

function drawArt(style: Style): HTMLCanvasElement {
  const w = 1600
  const h = 1000
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable for sample generation')

  if (style === 'dawn') {
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#1d2b53')
    sky.addColorStop(0.45, '#7f5af0')
    sky.addColorStop(0.72, '#ef7aa2')
    sky.addColorStop(1, '#fcd6a1')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)
    // Sun
    ctx.fillStyle = 'rgba(255,236,200,0.95)'
    ctx.beginPath()
    ctx.arc(w * 0.66, h * 0.6, 110, 0, Math.PI * 2)
    ctx.fill()
    // Mountains
    ctx.fillStyle = 'rgba(20,16,40,0.85)'
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(w * 0.25, h * 0.55)
    ctx.lineTo(w * 0.45, h * 0.78)
    ctx.lineTo(w * 0.62, h * 0.45)
    ctx.lineTo(w * 0.85, h * 0.8)
    ctx.lineTo(w, h * 0.6)
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  } else if (style === 'mesh') {
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, w, h)
    const blobs: Array<[number, number, number, string]> = [
      [w * 0.3, h * 0.35, 420, 'rgba(91,139,255,0.55)'],
      [w * 0.62, h * 0.3, 360, 'rgba(125,225,180,0.5)'],
      [w * 0.5, h * 0.75, 480, 'rgba(239,122,162,0.45)'],
      [w * 0.8, h * 0.7, 300, 'rgba(252,214,161,0.4)'],
    ]
    for (const [x, y, r, color] of blobs) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    // 'mono' — geometric
    ctx.fillStyle = '#101014'
    ctx.fillRect(0, 0, w, h)
    const greys = ['#20202a', '#2b2b38', '#3a3a4a', '#4c4c60', '#6b6b82']
    let x = 0
    let i = 0
    while (x < w) {
      const colW = 120 + (i % 3) * 80
      const barH = h * (0.35 + ((i * 13) % 55) / 100)
      ctx.fillStyle = greys[i % greys.length] ?? '#30303a'
      ctx.fillRect(x, h - barH, colW, barH)
      x += colW
      i++
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, h * 0.18)
    ctx.lineTo(w, h * 0.18)
    ctx.stroke()
  }

  // Subtle vignette to make grading tools show up in Phase 2
  const vign = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.75)
  vign.addColorStop(0, 'rgba(0,0,0,0)')
  vign.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Sample export failed'))),
      'image/jpeg',
      0.92,
    )
  })
}

/** Records a ~2.5s animated sample clip. Falls back to null anywhere along the way. */
async function createSampleVideo(): Promise<File | null> {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 540
  const ctx = canvas.getContext('2d')
  if (
    !ctx ||
    typeof MediaRecorder === 'undefined' ||
    typeof canvas.captureStream !== 'function' ||
    !MediaRecorder.isTypeSupported('video/webm')
  ) {
    return null
  }

  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 4_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  const DURATION_MS = 2500
  const start = performance.now()
  recorder.start(250)
  await new Promise<void>((resolve) => {
    const frame = (): void => {
      const t = Math.min(1, (performance.now() - start) / DURATION_MS)
      drawSampleFrame(ctx, canvas.width, canvas.height, t)
      if (t >= 1) {
        resolve()
        return
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  recorder.stop()
  await finished

  const blob = new Blob(chunks, { type: 'video/webm' })
  if (blob.size === 0) return null
  return new File([blob], 'Sample — Drifting Light.webm', { type: 'video/webm' })
}

function drawSampleFrame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  // Twilight sky that slowly shifts hue.
  const sky = ctx.createLinearGradient(0, 0, w * 0.2, h)
  const shift = t * 30
  sky.addColorStop(0, `hsl(${234 - shift}, 60%, 18%)`)
  sky.addColorStop(0.5, `hsl(${260 - shift}, 55%, 34%)`)
  sky.addColorStop(1, `hsl(${320 - shift}, 60%, 52%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // A drifting glowing orb.
  const x = w * (0.2 + 0.6 * t)
  const y = h * (0.62 - 0.12 * Math.sin(t * Math.PI))
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 140)
  glow.addColorStop(0, 'rgba(255,236,200,0.95)')
  glow.addColorStop(0.4, 'rgba(239,122,162,0.45)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Mountain silhouettes stay still so the motion reads clearly.
  ctx.fillStyle = 'rgba(18,14,36,0.9)'
  ctx.beginPath()
  ctx.moveTo(0, h)
  ctx.lineTo(w * 0.22, h * 0.6)
  ctx.lineTo(w * 0.42, h * 0.82)
  ctx.lineTo(w * 0.6, h * 0.52)
  ctx.lineTo(w * 0.82, h * 0.84)
  ctx.lineTo(w, h * 0.68)
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fill()

  // Fades make grading/trim visually obvious in the timeline.
  if (t < 0.08) {
    ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.08})`
    ctx.fillRect(0, 0, w, h)
  } else if (t > 0.92) {
    ctx.fillStyle = `rgba(0,0,0,${(t - 0.92) / 0.08})`
    ctx.fillRect(0, 0, w, h)
  }
}

const specs: Array<{ style: Style; name: string }> = [
  { style: 'dawn', name: 'Sample — Sunrise Ridge.jpg' },
  { style: 'mesh', name: 'Sample — Color Mesh.jpg' },
  { style: 'mono', name: 'Sample — Monoliths.jpg' },
]

export async function createSampleProject(): Promise<void> {
  const files: File[] = []
  for (const spec of specs) {
    const blob = await canvasToBlob(drawArt(spec.style))
    files.push(new File([blob], spec.name, { type: 'image/jpeg' }))
  }
  // The sample clip is best-effort: browsers without canvas recording skip it.
  const videoFile = await createSampleVideo()
  if (videoFile) files.push(videoFile)

  const { imported, failed } = await importFiles(files)
  if (imported.length === 0) {
    throw new Error(failed[0]?.reason ?? 'Sample media could not be generated in this browser.')
  }
  if (failed.length > 0) {
    // Never swallow a skipped clip silently — say what happened and why.
    toast(
      'Some sample media was skipped',
      failed.map((f) => `${f.name}: ${f.reason}`).join(' · '),
    )
  }
  const store = useProjectsStore.getState()
  const doc = await store.create('Sample Project', 'photo')
  const photos = imported.filter((a) => a.kind === 'image').map((a) => a.id)
  const videos = imported.filter((a) => a.kind === 'video').map((a) => a.id)
  store.updateCurrent((current) =>
    current.id === doc.id
      ? {
          ...current,
          photoAssets: photos,
          videoAssets: videos,
          activePhotoId: photos[0] ?? null,
          activeVideoId: videos[0] ?? null,
        }
      : current,
  )
}

