import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EngineNotice from './EngineNotice'
import { useStore } from '../store'
import { useT } from '../i18n'

const text = (key: Parameters<ReturnType<typeof useT>>[0]): string => renderHook(() => useT()).result.current(key)

describe('EngineNotice and a refused engine update', () => {
  const openSettings = vi.fn()

  beforeEach(() => {
    openSettings.mockClear()
    useStore.setState({ openSettings, ytdlp: { state: 'ready', version: '2026.10.26', refused: true } })
  })

  it('says the update was not installed and that downloads carry on, with nothing to install it anyway', () => {
    render(<EngineNotice />)
    expect(screen.getByText(text('engine.updateRefused'))).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((button) => button.textContent?.trim() || button.getAttribute('aria-label'))
    expect(buttons).toEqual([text('engine.checkAppUpdate'), text('common.close')])
  })

  it('leads to the app’s own update, which is what brings a new signing key', () => {
    render(<EngineNotice />)
    fireEvent.click(screen.getByRole('button', { name: text('engine.checkAppUpdate') }))
    expect(openSettings).toHaveBeenCalledWith('system/updates')
  })

  it('can be put away, since the engine still works', () => {
    render(<EngineNotice />)
    fireEvent.click(screen.getByRole('button', { name: text('common.close') }))
    expect(screen.queryByText(text('engine.updateRefused'))).toBeNull()
  })

  it('stays silent about an engine that is simply ready', () => {
    useStore.setState({ ytdlp: { state: 'ready', version: '2026.10.26' } })
    const { container } = render(<EngineNotice />)
    expect(container.textContent).toBe('')
  })

  it('on a first install, says what to do and offers a retry that checks again, not a way round', () => {
    useStore.setState({
      ytdlp: { state: 'error', message: 'Engine authenticity check failed: the release has no signature.' }
    })
    render(<EngineNotice />)
    expect(screen.getByText(text('engine.untrusted'))).toBeTruthy()
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([text('common.retry')])
  })
})
