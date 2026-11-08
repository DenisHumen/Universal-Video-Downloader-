import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from '../ui/icons'
import { translate, useI18n } from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence: React 18 unmounts the whole tree on an uncaught render
 * error, which used to leave the user staring at an empty window until Ctrl+R.
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
    // A class component can't use hooks; read the language directly instead.
    const language = useI18n.getState().language
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
        <div>
          <p className="label mb-2 text-bad">{translate(language, 'stamp.error')}</p>
          <p className="text-section font-medium text-ink">{translate(language, 'error.title')}</p>
          {/* What the code said is for a bug report: on hover, and on Copy. */}
          <p
            className="mx-auto mt-2 max-w-md text-meta leading-relaxed text-ink-2"
            title={this.state.error.message}
          >
            {translate(language, 'error.crashHint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-solid" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> {translate(language, 'error.reload')}
          </button>
          <button
            className="btn-quiet"
            onClick={() => void navigator.clipboard?.writeText(this.state.error?.message ?? '').catch(() => undefined)}
          >
            {translate(language, 'common.copy')}
          </button>
        </div>
      </div>
    )
  }
}
