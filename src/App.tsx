import { useEffect } from 'react'
import { Shell } from './features/workspace/Shell'
import { useProjectsStore } from './features/projects/store'
import { Toaster } from './ui/toast'
import type { ReactNode } from 'react'

/**
 * App root: kicks off project loading from IndexedDB, then renders the shell.
 */
export default function App(): ReactNode {
  const init = useProjectsStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <>
      <Shell />
      <Toaster />
    </>
  )
}
