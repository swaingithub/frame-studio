import { useState } from 'react'
import { Sparkles, FolderPlus, Images } from 'lucide-react'
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
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
          <Sparkles size={26} className="text-accent" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-hi">Welcome to Frame Studio</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-lo">
          A local-first photo & video workspace. Nothing is uploaded — your media, edits, and projects
          live entirely in this browser.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleSample()}
            className="group rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent/60 disabled:opacity-50"
          >
            <Images size={18} className="mb-2 text-accent" />
            <p className="text-sm font-medium text-hi">Try a sample project</p>
            <p className="mt-1 text-xs text-lo">Three generated images to explore the workflow.</p>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleCreate()}
            className="group rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent/60 disabled:opacity-50"
          >
            <FolderPlus size={18} className="mb-2 text-accent" />
            <p className="text-sm font-medium text-hi">Start a project</p>
            <p className="mt-1 text-xs text-lo">An empty project, ready to receive your media.</p>
          </button>
          <button
            type="button"
            onClick={pickFiles}
            className="group rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent/60"
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
