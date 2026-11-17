import { useState } from 'react'
import { Aperture, Sun, Moon, CheckCircle2, TriangleAlert, PanelLeftClose, PanelRightClose } from 'lucide-react'
import { ProjectSwitcher, ManageProjectsDialog } from '../../projects/components/Projects'
import { useProjectsStore, useCurrentProject } from '../../projects/store'
import { useThemeStore } from '../../../ui/theme'
import { useUIStore } from '../../../ui/uiStore'
import { Tooltip } from '../../../ui/tooltip'
import { Button } from '../../../ui/button'
import { detectCapabilities } from '../../../core/detection'
import { cn } from '../../../lib/cn'
import type { ReactNode } from 'react'

const capabilities = typeof window !== 'undefined' ? detectCapabilities() : null

interface HeaderProps {
  /** Compact layout: panel buttons open overlay drawers instead of collapsing columns. */
  compact?: boolean
  openPanel?: 'left' | 'right' | null
  onTogglePanel?: (side: 'left' | 'right') => void
}

export function Header({ compact = false, openPanel = null, onTogglePanel }: HeaderProps = {}): ReactNode {
  const [manageOpen, setManageOpen] = useState(false)
  const project = useCurrentProject()
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const updateCurrent = useProjectsStore((s) => s.updateCurrent)
  const leftCollapsed = useUIStore((s) => s.leftCollapsed)
  const rightCollapsed = useUIStore((s) => s.rightCollapsed)
  const toggleLeft = useUIStore((s) => s.toggleLeft)
  const toggleRight = useUIStore((s) => s.toggleRight)

  if (!capabilities) return null

  const leftExpanded = compact ? openPanel === 'left' : !leftCollapsed
  const rightExpanded = compact ? openPanel === 'right' : !rightCollapsed
  const togglePanel = (side: 'left' | 'right'): void => {
    if (compact) onTogglePanel?.(side)
    else if (side === 'left') toggleLeft()
    else toggleRight()
  }

  return (
    <header className="flex h-[calc(2.75rem+env(safe-area-inset-top))] shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2 pt-[env(safe-area-inset-top)] sm:gap-2 sm:px-2.5">
      <div className="flex shrink-0 items-center gap-2 pl-1">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft" aria-hidden>
          <Aperture size={15} className="text-accent" />
        </span>
        <span className="hidden text-sm font-semibold tracking-tight text-hi sm:block">Frame Studio</span>
      </div>

      {project ? <ProjectSwitcher onManage={() => setManageOpen(true)} /> : <div className="w-40" />}

      {/* Workspace tabs — meaningless without a project, so don't show a
          disabled ghost of them on the welcome screen. */}
      {project ? (
        <nav className="mx-auto flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-elevated p-0.5 shadow-sm" aria-label="Workspace switcher" role="tablist">
          {(['photo', 'video'] as const).map((ws) => (
            <button
              key={ws}
              type="button"
              role="tab"
              aria-selected={project?.activeWorkspace === ws}
              tabIndex={project?.activeWorkspace === ws ? 0 : -1}
              onClick={() => {
                if (!project) return
                updateCurrent((doc) => ({ ...doc, activeWorkspace: ws }))
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const next = event.key === 'ArrowRight' ? (ws === 'photo' ? 'video' : 'photo') : (ws === 'video' ? 'photo' : 'video')
                updateCurrent((doc) => ({ ...doc, activeWorkspace: next }))
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-all sm:px-4',
                project?.activeWorkspace === ws ? 'bg-accent text-onaccent shadow-sm' : 'text-lo hover:bg-hover hover:text-hi',
              )}
            >
              {ws}
              <span className="hidden sm:inline"> editor</span>
            </button>
          ))}
        </nav>
      ) : (
        <div className="mx-auto" />
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={capabilities.webgl2 ? 'WebGL2 available — full pipeline' : 'WebGL2 unavailable — Canvas 2D fallback'}>
          <button type="button" className="hidden rounded-md p-1.5 text-lo hover:text-hi md:block" aria-label="Feature support">
            {capabilities.webgl2 ? (
              <CheckCircle2 size={15} className="text-emerald-500" />
            ) : (
              <TriangleAlert size={15} className="text-amber-400" />
            )}
          </button>
        </Tooltip>
        <Tooltip content={compact ? (leftExpanded ? 'Close library' : 'Open library') : 'Toggle library panel'}>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => togglePanel('left')}
            aria-label={compact ? (leftExpanded ? 'Close library' : 'Open library') : 'Toggle library panel'}
            aria-expanded={compact ? leftExpanded : undefined}
          >
            <PanelLeftClose size={15} className={leftExpanded ? 'transition-transform' : 'rotate-180 transition-transform'} />
          </Button>
        </Tooltip>
        <Tooltip content={compact ? (rightExpanded ? 'Close inspector' : 'Open inspector') : 'Toggle inspector panel'}>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => togglePanel('right')}
            aria-label={compact ? (rightExpanded ? 'Close inspector' : 'Open inspector') : 'Toggle inspector panel'}
            aria-expanded={compact ? rightExpanded : undefined}
          >
            <PanelRightClose size={15} className={rightExpanded ? 'transition-transform' : 'rotate-180 transition-transform'} />
          </Button>
        </Tooltip>
        <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme" className="hidden min-[360px]:inline-flex">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
        </Tooltip>
      </div>

      <ManageProjectsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </header>
  )
}
