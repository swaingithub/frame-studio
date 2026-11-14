import { useEffect, useState } from 'react'
import { UploadCloud, X } from 'lucide-react'
import { Header } from './components/Header'
import { PhotoWorkspace } from './components/PhotoWorkspace'
import { VideoWorkspace } from './components/VideoWorkspace'
import { InspectorPanel } from './components/InspectorPanel'
import { WelcomeScreen } from './components/WelcomeScreen'
import { FirstRunCoach } from './components/FirstRunCoach'
import { LibraryPanel } from '../library/components/LibraryPanel'
import { useProjectsStore, useCurrentProject } from '../projects/store'
import { useLibraryStore } from '../library/store'
import { useImport } from '../library/components/useImport'
import { useUIStore } from '../../ui/uiStore'
import { PanelResizer } from '../../ui/panels'
import { useMediaQuery, DESKTOP_QUERY, PHONE_QUERY } from '../../ui/useMediaQuery'
import { cn } from '../../lib/cn'
import { useAssets } from '../library/useAssets'
import { formatBytes } from '../../core/format'
import type { ReactNode } from 'react'

/**
 * Application shell: header, resizable/collapsible left (library) and right
 * (inspector) panels, and the active workspace in the center. Handles global
 * drag-and-drop import and shows a drop overlay while dragging.
 */
export function Shell(): ReactNode {
  const loaded = useProjectsStore((s) => s.loaded)
  const project = useCurrentProject()
  const leftWidth = useUIStore((s) => s.leftWidth)
  const rightWidth = useUIStore((s) => s.rightWidth)
  const leftCollapsed = useUIStore((s) => s.leftCollapsed)
  const rightCollapsed = useUIStore((s) => s.rightCollapsed)
  const setLeftWidth = useUIStore((s) => s.setLeftWidth)
  const setRightWidth = useUIStore((s) => s.setRightWidth)

  /** Width/gutters that fit the inline three-column editor. */
  const desktop = useMediaQuery(DESKTOP_QUERY)
  /** Very narrow screens: the inspector slides up from the bottom. */
  const phone = useMediaQuery(PHONE_QUERY)
  /** Overlay panel open on compact layouts (persisted widths are desktop-only). */
  const [overlayPanel, setOverlayPanel] = useState<'left' | 'right' | null>(null)

  const [dragDepth, setDragDepth] = useState(0)
  const { run } = useImport()

  // Growing past the breakpoint restores the inline layout; shrinking starts
  // with both drawers closed so the stage is visible immediately.
  useEffect(() => {
    if (desktop) setOverlayPanel(null)
  }, [desktop])

  useEffect(() => {
    if (!overlayPanel) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOverlayPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayPanel])

  const leftOpen = desktop ? !leftCollapsed : overlayPanel === 'left'
  const rightOpen = desktop ? !rightCollapsed : overlayPanel === 'right'

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-app text-hi"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragDepth((d) => d + 1)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        e.preventDefault()
        setDragDepth(0)
        void run(Array.from(e.dataTransfer.files))
      }}
    >
      <Header
        compact={!desktop}
        openPanel={overlayPanel}
        onTogglePanel={(side) => setOverlayPanel((p) => (p === side ? null : side))}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: media library (inline on desktop, drawer on compact) */}
        {desktop && leftOpen ? (
          <>
            <div style={{ width: leftWidth }} className="h-full min-w-0 shrink-0 border-r border-line bg-panel">
              <LibraryPanel />
            </div>
            <PanelResizer side="left" width={leftWidth} onResize={setLeftWidth} />
          </>
        ) : null}

        {/* Center: active workspace */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {!loaded ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-xl animate-pulse space-y-3 p-4 sm:p-8">
                <div className="h-8 w-2/3 rounded-lg bg-elevated" />
                <div className="h-4 w-1/2 rounded bg-elevated" />
                <div className="grid grid-cols-3 gap-3 pt-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="aspect-[4/3] rounded-xl bg-elevated" />
                  ))}
                </div>
              </div>
            </div>
          ) : project ? (
            project.activeWorkspace === 'photo' ? (
              <PhotoWorkspace />
            ) : (
              <VideoWorkspace />
            )
          ) : (
            <WelcomeScreen />
          )}

          {dragDepth > 0 ? (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-accent-soft/60 outline-2 outline-dashed outline-accent -outline-offset-8">
              <div className="flex items-center gap-2 rounded-xl bg-panel px-5 py-4 text-sm font-medium text-hi shadow-2xl">
                <UploadCloud size={18} className="text-accent" />
                Drop to import — files stay on this device
              </div>
            </div>
          ) : null}

          <FirstRunCoach />
        </main>

        {/* Right: inspector (inline on desktop, drawer/sheet on compact) */}
        {desktop && rightOpen ? (
          <>
            <PanelResizer side="right" width={rightWidth} onResize={setRightWidth} />
            <div style={{ width: rightWidth }} className="h-full min-w-0 shrink-0 border-l border-line bg-panel">
              <InspectorPanel />
            </div>
          </>
        ) : null}
      </div>

      <StatusBar />

      {/* Compact overlay panels */}
      {!desktop && overlayPanel ? (
        <button
          type="button"
          aria-label="Close panel"
          className="fixed inset-x-0 bottom-0 top-[calc(2.75rem+env(safe-area-inset-top))] z-40 cursor-default bg-black/50"
          onClick={() => setOverlayPanel(null)}
        />
      ) : null}
      {!desktop && overlayPanel === 'left' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Library"
          className="fixed bottom-0 left-0 top-[calc(2.75rem+env(safe-area-inset-top))] z-50 w-[min(86vw,340px)] border-r border-line bg-panel shadow-2xl"
        >
          <LibraryPanel onClose={() => setOverlayPanel(null)} />
        </div>
      ) : null}
      {!desktop && overlayPanel === 'right' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Inspector"
          className={cn(
            'fs-anim-sheet-in fixed z-50 flex flex-col border-line bg-panel shadow-2xl',
            phone
              ? 'inset-x-0 bottom-0 h-[72dvh] rounded-t-2xl border-t'
              : 'bottom-0 right-0 top-[calc(2.75rem+env(safe-area-inset-top))] w-[min(86vw,380px)] border-l',
          )}
        >
          {phone ? (
            <div
              className="mx-auto mt-1.5 h-1 w-10 shrink-0 cursor-grab touch-none rounded-full bg-line"
              aria-hidden
              onPointerDown={(e) => {
                const startY = e.clientY
                const el = e.currentTarget
                el.setPointerCapture(e.pointerId)
                const onUp = (ev: PointerEvent): void => {
                  if (ev.clientY - startY > 48) setOverlayPanel(null)
                  el.releasePointerCapture(e.pointerId)
                }
                el.addEventListener('pointerup', onUp, { once: true })
              }}
            />
          ) : null}
          <PanelCloseButton onClose={() => setOverlayPanel(null)} />
          <div className="min-h-0 flex-1">
            <InspectorPanel />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Small floating close affordance for compact drawers/sheets. */
function PanelCloseButton({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <button
      type="button"
      aria-label="Close panel"
      onClick={onClose}
      className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-lo hover:bg-hover hover:text-hi"
    >
      <X size={14} />
    </button>
  )
}

function StatusBar(): ReactNode {
  const saveState = useProjectsStore((s) => s.saveState)
  const project = useCurrentProject()
  const library = useLibraryStore()
  const assets = useAssets()
  const [usage, setUsage] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    navigator.storage?.estimate?.().then(({ usage: u }) => {
      if (alive) setUsage(u ?? null)
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [assets])

  const statusText = !project ? 'No project open' : saveState === 'saving' ? 'Autosaving…' : 'All changes saved'

  return (
    <footer className="flex min-h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-line bg-panel px-3 py-0.5 pb-[env(safe-area-inset-bottom)] text-[10px] text-lo">
      <span className={cn('flex shrink-0 items-center gap-1.5', saveState === 'saving' && 'text-accent')}>
        <span
          className={cn('h-1.5 w-1.5 rounded-full', !project ? 'bg-lo/40' : saveState === 'saving' ? 'bg-accent animate-pulse' : 'bg-emerald-500')}
          aria-hidden
        />
        {statusText}
      </span>
      <span className="hidden truncate sm:inline">{assets ? `${assets.length} items in library` : ''}</span>
      {library.importing ? (
        <span className="shrink-0 text-accent">
          Importing {library.importDone}/{library.importTotal}…
        </span>
      ) : null}
      <span className="ml-auto shrink-0 truncate">{usage != null ? `${formatBytes(usage)} in browser storage` : 'Local storage'}</span>
    </footer>
  )
}
