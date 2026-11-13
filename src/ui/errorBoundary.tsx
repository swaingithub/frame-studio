import { Component } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-of-app error boundary: converts unexpected crashes into a friendly,
 * recoverable screen instead of a white page. User data lives in IndexedDB,
 * so a reload never loses their work.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Frame Studio] render error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-app p-8 text-center">
          <TriangleAlert size={32} className="text-danger" />
          <h1 className="text-lg font-semibold text-hi">Something went wrong</h1>
          <p className="max-w-md text-sm text-lo">
            The app hit an unexpected error, but your projects and media are safe in local storage.
          </p>
          <p className="max-w-md rounded-lg border border-line bg-panel p-3 text-left text-xs break-words text-lo">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-onaccent hover:brightness-110"
          >
            <RotateCcw size={14} />
            Reload Frame Studio
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
