import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateRetryButton from './UpdateRetryButton'

const freshness = vi.fn()
const update = vi.fn()

beforeEach(() => {
  freshness.mockReset()
  update.mockReset()
  freshness.mockResolvedValue({ older: true, current: '2026.01.01', latest: '2026.03.17' })
  update.mockResolvedValue({ ok: true, version: '2026.03.17' })
  Object.assign(window, { api: { engineFreshness: freshness, updateYtdlp: update } })
})

afterEach(cleanup)

const button = (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Update and Retry' })

describe('Update and Retry', () => {
  it('is offered for a site that changed while a newer engine is out', async () => {
    render(<UpdateRetryButton errorCode="noFormats" onRetry={vi.fn()} />)
    expect(await button()).toBeTruthy()
  })

  it('is offered for an unclassified failure with a stack in it', async () => {
    render(<UpdateRetryButton said="Traceback (most recent call last):" onRetry={vi.fn()} />)
    expect(await button()).toBeTruthy()
  })

  it('is not offered when the engine is the latest', async () => {
    freshness.mockResolvedValue({ older: false })
    render(<UpdateRetryButton errorCode="playerChanged" onRetry={vi.fn()} />)
    await waitFor(() => expect(freshness).toHaveBeenCalled())
    await act(async () => undefined)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not even ask for a failure of another kind', async () => {
    render(<UpdateRetryButton errorCode="network" onRetry={vi.fn()} />)
    await act(async () => undefined)
    expect(freshness).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('updates, then retries, and is not offered again', async () => {
    const onRetry = vi.fn()
    render(<UpdateRetryButton errorCode="noFormats" onRetry={onRetry} />)
    fireEvent.click(await button())
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not retry when the update is refused, and keeps the button', async () => {
    update.mockResolvedValue({ ok: false, code: 'engineBusy' })
    const onRetry = vi.fn()
    render(<UpdateRetryButton errorCode="noFormats" onRetry={onRetry} />)
    fireEvent.click(await button())
    await waitFor(() => expect(update).toHaveBeenCalled())
    await act(async () => undefined)
    expect(onRetry).not.toHaveBeenCalled()
    expect(await button()).toBeTruthy()
  })

  it('does not retry when the update fails', async () => {
    update.mockRejectedValue(new Error('offline'))
    const onRetry = vi.fn()
    render(<UpdateRetryButton errorCode="noFormats" onRetry={onRetry} />)
    fireEvent.click(await button())
    await waitFor(() => expect(update).toHaveBeenCalled())
    await act(async () => undefined)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
