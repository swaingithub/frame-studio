import { cn } from '../lib/cn'
import { clampPanelWidth, PANEL_MIN } from './uiStore'
import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

/**
 * Horizontal resize handle for side panels. Pure pointer events — no extra
 * dependency. Width lives in the persistence-backed UI store.
 */
interface PanelResizerProps {
  side: 'left' | 'right'
  width: number
  onResize: (w: number) => void
}

export function PanelResizer({ side, width, onResize }: PanelResizerProps): ReactNode {
  const startX = useRef(0)
  const startWidth = useRef(0)
  const dragging = useRef(false)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const dx = e.clientX - startX.current
      onResize(clampPanelWidth(side === 'left' ? startWidth.current + dx : startWidth.current - dx))
    },
    [side, onResize],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 24 : 8
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const direction = e.key === 'ArrowRight' ? 1 : -1
        onResize(clampPanelWidth(side === 'left' ? width + direction * step : width - direction * step))
      }
    },
    [onResize, side, width],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        'group relative z-10 h-full w-px shrink-0 cursor-col-resize bg-line',
        'after:absolute after:inset-y-0 after:w-1.5 after:-left-[3px] after:content-[""]',
        'hover:after:bg-accent/40 hover:bg-accent/40 transition-colors',
      )}
    />
  )
}

/** Collapsible side-panel container, shared by library & inspector panels. */
export function SidePanel({ children, width }: { children: ReactNode; width: number }): ReactNode {
  return (
    <aside style={{ width }} className="flex h-full min-w-0 shrink-0 flex-col border-r border-line bg-panel last:border-r-0">
      {children}
    </aside>
  )
}
