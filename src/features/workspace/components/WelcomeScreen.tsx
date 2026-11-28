import { useState } from 'react'
import { Sparkles, FolderPlus, Images, ArrowRight, ShieldCheck } from 'lucide-react'
import { useProjectsStore } from '../../projects/store'
import { useImport } from '../../library/components/useImport'
import { toast } from '../../../ui/toastStore'
import type { ReactNode } from 'react'

/**
 * First-run screen: shown exactly when no projects exist. Offers a quick
 * tour of what the app does, a sample project, or a fresh empty project.
 */
export function WelcomeScreen(): ReactNode {
  const create = useProjectsStore((s) => s.create)
  const createSample = useProjectsStore((s) => s.createSample)
  const { pickFiles } = useImport()
  const [busy, setBusy] = useState<'sample' | 'create' | null>(null)

  async function handleSample(): Promise<void> {
    setBusy('sample')
    try {
      await createSample()
    } catch (err) {
      toast('Sample project failed', err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate(): Promise<void> {
    setBusy('create')
    try {
      await create('Untitled Project', 'photo')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-5 sm:p-8">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft shadow-[0_12px_30px_var(--c-accent-soft)]">
          <Sparkles size={26} className="text-accent" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-lo">Private creator studio</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-hi sm:text-4xl">Make something worth sharing.</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-lo">
          Edit photos and videos with a simple workflow. Your original files stay on this device.
        </p>
        <div className="mx-auto mt-5 flex max-w-md items-center justify-center gap-2 text-[11px] text-lo">
          <ShieldCheck size={13} className="text-emerald-500" /> Private by design <span className="text-lo">•</span> No watermark <span className="text-lo">•</span> Autosaves
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleSample()}
            className="group rounded-2xl border border-accent/40 bg-accent-soft/35 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:border-accent hover:shadow-md disabled:opacity-50"
          >
            <Images size={18} className="mb-2 text-accent" />
            <p className="flex items-center gap-1 text-sm font-semibold text-hi">Learn with a sample <ArrowRight size={13} className="opacity-0 transition-opacity group-hover:opacity-100" /></p>
            <p className="mt-1 text-xs text-lo">Explore a ready-made photo and video project first.</p>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleCreate()}
            className="group rounded-2xl border border-line bg-panel p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:border-accent/60 hover:shadow-md disabled:opacity-50"
          >
            <FolderPlus size={18} className="mb-2 text-accent" />
            <p className="text-sm font-medium text-hi">Start a project</p>
            <p className="mt-1 text-xs text-lo">An empty project, ready to receive your media.</p>
          </button>
          <button
            type="button"
            onClick={pickFiles}
            className="group rounded-2xl border border-line bg-panel p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 hover:border-accent/60 hover:shadow-md"
          >
            <Images size={18} className="mb-2 text-accent" />
            <p className="text-sm font-medium text-hi">Import media</p>
            <p className="mt-1 text-xs text-lo">Photos, videos or audio — dropped or picked.</p>
          </button>
        </div>
        <p className="mt-6 text-[11px] text-lo">
          Tip: press <kbd className="rounded bg-elevated px-1.5 py-0.5 text-[10px]">⌘/Ctrl</kbd>{' '}
          <kbd className="rounded bg-elevated px-1.5 py-0.5 text-[10px]">I</kbd> anywhere to import.
        </p>
        {busy ? (
          <p className="mt-4 text-xs text-lo" role="status">
            {busy === 'sample' ? 'Generating sample media…' : 'Creating project…'}
          </p>
        ) : null}
      </div>
    </div>
  )
}
