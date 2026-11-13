import { useCallback, useEffect, useMemo } from 'react'
import { importFiles } from '../import'
import { useLibraryStore } from '../store'
import { toast } from '../../../ui/toastStore'

/**
 * File-import entry point for UI controls: an imperative file picker plus a
 * handler for drag-and-drop batches, with progress + per-file failure toasts.
 */
export function useImport(): {
  run: (files: readonly File[]) => Promise<void>
  pickFiles: () => void
  importing: boolean
} {
  const importing = useLibraryStore((s) => s.importing)

  const run = useCallback(async (files: readonly File[]) => {
    const list = [...files]
    if (list.length === 0) return
    const store = useLibraryStore.getState()
    store.setImporting(true)
    store.setImportProgress({ total: list.length, done: 0, current: list[0]?.name ?? '' })
    try {
      const { imported, failed } = await importFiles(list, (p) => useLibraryStore.getState().setImportProgress(p))
      if (imported.length > 0) {
        toast(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`, undefined, 'success')
      }
      if (failed.length > 0) {
        toast(
          `Skipped ${failed.length} file${failed.length === 1 ? '' : 's'}`,
          failed.slice(0, 3).map((f) => `${f.name}: ${f.reason}`).join('\n') +
            (failed.length > 3 ? `\n…and ${failed.length - 3} more` : ''),
          'error',
        )
      }
    } catch (err) {
      toast('Import failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      const s = useLibraryStore.getState()
      s.setImporting(false)
      s.setImportProgress({ total: 0, done: 0, current: '' })
    }
  }, [])

  const pickFiles = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = [
      'image/jpeg,image/png,image/webp,image/gif,image/avif',
      'video/mp4,video/webm,video/quicktime,video/x-matroska',
      'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/opus',
    ].join(',')
    input.onchange = () => {
      void run(Array.from(input.files ?? []))
    }
    input.click()
  }, [run])

  // Keyboard: Ctrl/Cmd+I opens the file picker from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        pickFiles()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickFiles])

  return useMemo(() => ({ run, pickFiles, importing }), [run, pickFiles, importing])
}
