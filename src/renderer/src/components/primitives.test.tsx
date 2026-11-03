import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import ConfirmDialog from './ConfirmDialog'
import RowMenu from './RowMenu'

/*
  The interactive pieces the 4.0 primitives are lifted from (plan 3.1): what
  they promise keyboard and screen-reader users is pinned here before they move.
*/

describe('ConfirmDialog', () => {
  it('is an alert dialog, starts on Cancel, and closes on Esc', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmDialog title="Remove?" body="It goes." confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} />)
    const dialog = screen.getByRole('alertdialog', { name: 'Remove?' })
    expect(dialog).toBeTruthy()
    expect(document.activeElement?.textContent).toMatch(/cancel/i)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('RowMenu', () => {
  it('opens a labelled menu, moves focus into it, and selects', async () => {
    const pick = vi.fn()
    render(
      <RowMenu
        label="More"
        items={[
          { label: 'First', icon: null, onSelect: pick },
          { label: 'Second', icon: null, onSelect: vi.fn() }
        ]}
      />
    )
    const trigger = screen.getByRole('button', { name: 'More' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    expect(await axeViolations(document.body)).toEqual([])
    fireEvent.click(items[0])
    expect(pick).toHaveBeenCalled()
  })
})
