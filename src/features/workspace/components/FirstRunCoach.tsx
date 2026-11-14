import { useEffect, useState, type ReactNode } from 'react'
import { Download, Hand, PlusCircle } from 'lucide-react'
import { useCurrentProject } from '../../projects/store'
import { cn } from '../../../lib/cn'

/**
 * First-run coach marks: three one-line steps shown once per device the first
 * time a project opens, for people who have never edited before. Stored in
 * localStorage so it never nags again after being seen (or skipped).
 */

const STORAGE_KEY = 'fs.coach.v1'

interface Step {
  icon: ReactNode
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    icon: <PlusCircle size={22} className="text-accent" />,
    title: '1. Add your media',
    body: 'Import photos or videos from the library — nothing is uploaded, everything stays on this device.',
  },
  {
    icon: <Hand size={22} className="text-accent" />,
    title: '2. Tap to edit',
    body: 'Tap any clip or photo to select it, then use the bars and sliders to trim, grade and arrange.',
  },
  {
    icon: <Download size={22} className="text-accent" />,
    title: '3. Export when it feels right',
    body: 'Save the finished photo or video straight to your device — no account, no watermark.',
  },
]

export function FirstRunCoach(): ReactNode {
  const project = useCurrentProject()
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!project) return
    let seen = false
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      seen = true // private-mode storage: never nag
    }
    if (!seen) setOpen(true)
  }, [project])

  const dismiss = (): void => {
    setOpen(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // storage unavailable — session-only, fine
    }
  }

  if (!open || !project) return null
  const current = STEPS[step]

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-8 sm:items-center" role="dialog" aria-label="Getting started">
      <div className="w-full max-w-sm rounded-xl bg-panel p-4 shadow-2xl ring-1 ring-line">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
            {current.icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-hi">{current.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-lo">{current.body}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={cn('h-1 w-5 rounded-full transition-colors', i === step ? 'bg-accent' : 'bg-line')} />
            ))}
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-xs text-lo hover:text-hi"
            onClick={dismiss}
          >
            Skip
          </button>
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
            onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : dismiss())}
            autoFocus
          >
            {step < STEPS.length - 1 ? 'Next' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  )
}
