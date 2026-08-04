import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SearchApp from './SearchApp'
import BrowserApp from './BrowserApp'
import ErrorBoundary from './components/ErrorBoundary'
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
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>{shellFor(window.location.hash)}</ErrorBoundary>
    </React.StrictMode>
  )
}

void bootstrap()
