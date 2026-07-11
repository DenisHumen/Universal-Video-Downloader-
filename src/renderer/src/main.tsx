import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SearchApp from './SearchApp'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

async function bootstrap(): Promise<void> {
  // Browser-only preview (vite dev URL without Electron): install a mock bridge.
  if (!window.api) {
    const { installMockApi } = await import('./lib/mockApi')
    installMockApi()
  }

  const isSearchWindow = window.location.hash.startsWith('#/search')

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>{isSearchWindow ? <SearchApp /> : <App />}</ErrorBoundary>
    </React.StrictMode>
  )
}

void bootstrap()
