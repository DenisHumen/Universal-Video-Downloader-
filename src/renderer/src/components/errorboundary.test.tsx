import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from '../i18n'
import ErrorBoundary from './ErrorBoundary'

afterEach(() => {
  useI18n.setState({ language: 'en' })
  vi.restoreAllMocks()
})

function Broken(): JSX.Element {
  throw new Error("Cannot read properties of undefined (reading 'title')")
}

describe('ErrorBoundary', () => {
  // A crash used to print the code's own English, in a monospace block, to somebody reading Russian.
  it('says what to do in the interface language, with the code’s words only on hover', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useI18n.setState({ language: 'ru' })
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    )
    const hint = screen.getByText(/Перезагрузите его/)
    expect(hint.getAttribute('title')).toMatch(/Cannot read properties/)
    expect(document.body.textContent).not.toMatch(/Cannot read properties/)
    expect(screen.getByRole('button', { name: 'Копировать' })).toBeTruthy()
  })
})
