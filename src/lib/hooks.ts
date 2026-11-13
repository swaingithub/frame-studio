import { useEffect, useState } from 'react'

/** Creates an object URL for a blob and revokes it on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

export function useStorageEstimate(): number | null {
  const [usage, setUsage] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    async function run(): Promise<void> {
      try {
        if (navigator.storage?.estimate) {
          const { usage: u } = await navigator.storage.estimate()
          if (!cancelled) setUsage(u ?? null)
        }
      } catch {
        /* estimator unavailable */
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])
  return usage
}
