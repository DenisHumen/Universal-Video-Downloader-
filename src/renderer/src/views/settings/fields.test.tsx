import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftEntryRow } from './fields'

/*
  A text setting used to be saved on every key and bound to the saved value, so
  the reply to an earlier key arrived over a later one and put the text back.
*/
describe('a text setting while it is being typed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const field = (): HTMLInputElement => screen.getByLabelText('Languages') as HTMLInputElement
  const type = (text: string): void => void fireEvent.change(field(), { target: { value: text } })

  it('is saved once, when the typing stops', () => {
    const onCommit = vi.fn()
    render(<DraftEntryRow title="Languages" value="en" onCommit={onCommit} />)
    type('en,')
    type('en,r')
    type('en,ru')
    expect(onCommit).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(500))
    expect(onCommit.mock.calls).toEqual([['en,ru']])
  })

  it('does not go back to an older saved value under the typist', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<DraftEntryRow title="Languages" value="en" onCommit={onCommit} />)
    type('en,ru')
    // The reply to an earlier save lands while the next letters are being typed.
    rerender(<DraftEntryRow title="Languages" value="en," onCommit={onCommit} />)
    expect(field().value).toBe('en,ru')
  })

  it('saves at once when the field is left, and follows a reset when nobody is typing', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<DraftEntryRow title="Languages" value="en" onCommit={onCommit} />)
    type('de')
    fireEvent.blur(field())
    expect(onCommit.mock.calls).toEqual([['de']])
    rerender(<DraftEntryRow title="Languages" value="" onCommit={onCommit} />)
    expect(field().value).toBe('')
  })
})
