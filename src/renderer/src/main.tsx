import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SearchApp from './SearchApp'
import BrowserApp from './BrowserApp'
import ErrorBoundary from './components/ErrorBoundary'
import { useStore } from './store'
import './index.css'

/** One bundle serves three windows; the hash decides which shell to mount. */
function shellFor(hash: string): JSX.Element {
  if (hash.startsWith('#/search')) return <SearchApp />
  if (hash.startsWith('#/browser')) return <BrowserApp />
  return <App />
}

async function bootstrap(): Promise<void> {
  // Browser-only preview (vite dev URL without Electron): install a mock bridge.
  if (!window.api) {
    const { installMockApi } = await import('./lib/mockApi')
    installMockApi()
    /*
      Preview only, and deliberately inside this branch: the packaged app always
      has a preload bridge, so this line can never run in it. The screenshot
      script drives views through the store rather than by clicking buttons, so
      a renamed label produces a loud failure instead of a convincing picture of
      the wrong screen.
    */
    ;(window as unknown as { __uvdStore?: unknown }).__uvdStore = useStore
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>{shellFor(window.location.hash)}</ErrorBoundary>
    </React.StrictMode>
  )
}

void bootstrap()
