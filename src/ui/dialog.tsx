import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import type { ReactNode } from 'react'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

interface DialogContentProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  wide?: boolean
}

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  wide,
}: DialogContentProps): ReactNode {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]',
          'data-[state=open]:fs-anim-overlay-in data-[state=closed]:fs-anim-overlay-out',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2',
          'flex-col rounded-xl border border-line bg-panel p-5 shadow-2xl focus:outline-none',
          wide && 'w-[min(96vw,860px)]',
          'data-[state=open]:fs-anim-content-in data-[state=closed]:fs-anim-content-out',
          className,
        )}
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-base font-semibold text-hi">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="rounded-md p-1 text-lo transition-colors hover:bg-hover hover:text-hi"
            aria-label="Close dialog"
          >
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="mb-4 text-sm text-lo">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <div className="mb-2" />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
