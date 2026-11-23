/**
 * Blob → browser download (the pattern the photo and video exporters use).
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.addEventListener('click', () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  })
  a.click()
  a.remove()
}

export function sanitizeFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, '_')
}
