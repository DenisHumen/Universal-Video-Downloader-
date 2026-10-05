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

/*
  A file dropped anywhere is not a document to open. Chromium's default for an
  unhandled drop is to navigate to the file, which replaced the whole interface
  on every screen but Home - the only one that handled drops - and a local
  HTML file loaded that way got the preload bridge with it. Main refuses that
  navigation now too; this keeps the drop from even being attempted, in all
  three shells. Links are left alone: Home picks them up itself, and anywhere
  else main hands them to a browser.
*/
const carriesFiles = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (carriesFiles(e)) e.preventDefault()
  })
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
