import { useState, type ReactNode } from 'react'
import { Zap } from 'lucide-react'
import { useVideoEditor } from '../store'
import { ConvertDialog } from './ConvertDialog'

/** Video converter (CapCut-style tool): re-encode to another format/size. */
export function ConvertControls(): ReactNode {
  const clip = useVideoEditor((s) => s.clip)
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Convert">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1.5 text-[11px] text-hi transition-colors hover:bg-hover"
      >
        <Zap size={12} /> Convert
      </button>
      <ConvertDialog assetId={clip?.assetId ?? null} open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
