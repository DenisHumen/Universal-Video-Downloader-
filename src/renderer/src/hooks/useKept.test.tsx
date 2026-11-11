import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { forgetKept, useKept } from './useKept'

function Field({ name }: { name: string }): JSX.Element {
  const [text, setText] = useKept(name, '')
  const [status] = useKept<'idle' | 'busy'>(`${name}.status`, 'busy', (was) => (was === 'busy' ? 'idle' : was))
  return (
    <label>
      Query
      <input value={text} onChange={(e) => setText(e.target.value)} data-status={status} />
    </label>
  )
}

/* A screen is unmounted when its tab is left; what was typed on it must be there on the way back. */
describe('useKept', () => {
  it('gives a screen back what it held when it was last up', () => {
    const first = render(<Field name="q" />)
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'big buck bunny' } })
    first.unmount()

    render(<Field name="q" />)
    const field = screen.getByLabelText('Query') as HTMLInputElement
    expect(field.value).toBe('big buck bunny')
    // Work that was under way ended with the screen, and the value says so.
    expect(field.dataset.status).toBe('idle')
  })

  it('keeps each key apart, and forgets on a new start', () => {
    const first = render(<Field name="a" />)
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'one' } })
    first.unmount()

    const other = render(<Field name="b" />)
    expect((screen.getByLabelText('Query') as HTMLInputElement).value).toBe('')
    other.unmount()

    forgetKept()
    render(<Field name="a" />)
    expect((screen.getByLabelText('Query') as HTMLInputElement).value).toBe('')
  })
})
