import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../lib/cn'
import type { ReactNode } from 'react'

export function TooltipProvider({ children }: { children: ReactNode }): ReactNode {
  return <TooltipPrimitive.Provider delayDuration={350}>{children}</TooltipPrimitive.Provider>
}

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export function Tooltip({ content, children, side = 'bottom', className }: TooltipProps): ReactNode {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-72 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs shadow-lg',
            'whitespace-pre-line text-hi data-[state=delayed-open]:fs-anim-menu-in',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
