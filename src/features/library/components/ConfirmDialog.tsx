import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogClose } from '../../../ui/dialog'
import { Button } from '../../../ui/button'
import type { ReactNode } from 'react'

/**
 * Minimal promise-style confirm dialog. `request == null` closes it.
 */
export interface ConfirmRequest {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null
  onClose: () => void
}

export function ConfirmDialog({ request, onClose }: ConfirmDialogProps): ReactNode {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (request) setBusy(false)
  }, [request])

  const open = request !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      {open ? (
        <DialogContent
          title={request.title}
          description={request.description}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="subtle">Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                className={request.danger ? 'bg-danger text-ondanger' : undefined}
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  const result = request.onConfirm()
                  Promise.resolve(result)
                    .catch((err: unknown) => {
                      console.error(err)
                    })
                    .finally(() => {
                      setBusy(false)
                      onClose()
                    })
                }}
              >
                {request.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <span className="sr-only">Confirmation required</span>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
