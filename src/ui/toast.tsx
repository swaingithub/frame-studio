import { useToastStore } from './toastStore'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { ToastKind, Toast } from './toastStore'
import type { ReactNode } from 'react'

/**
 * Toast viewport: bottom-right stack with auto-dismiss handled by the store.
 */
const icons: Record<ToastKind, ReactNode> = {
  info: <Info size={16} className="text-accent" />,
  success: <CheckCircle2 size={16} className="text-emerald-500" />,
  error: <TriangleAlert size={16} className="text-danger" />,
}

export function Toaster(): ReactNode {
  const toasts = useToastStore<Toast[]>((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-80"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
          className="fs-anim-toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-elevated p-3 shadow-xl"
        >
          {t.image ? (
            <img src={t.image} alt="" className="h-11 w-11 shrink-0 rounded border border-line object-cover" />
          ) : (
            <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-hi">{t.title}</p>
            {t.detail ? <p className="mt-0.5 whitespace-pre-line break-words text-xs text-lo">{t.detail}</p> : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-lo hover:text-hi"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
