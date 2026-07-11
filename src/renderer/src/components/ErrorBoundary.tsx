import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence: React 18 unmounts the whole tree on an uncaught render
 * error, which used to leave the user staring at a black window until Ctrl+R.
 * This boundary swallows the crash and offers a one-click reload instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/10 text-red-300/80">
          <TriangleAlert size={28} />
        </div>
        <div>
          <p className="text-base font-semibold text-cream">something went wrong</p>
          <p className="mono mx-auto mt-1.5 max-w-md break-words text-xs text-white/40">
            {this.state.error.message}
          </p>
        </div>
        <button className="btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> reload the app
        </button>
      </div>
    )
  }
}
