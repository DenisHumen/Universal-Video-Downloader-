import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import ConfirmDialog from './ConfirmDialog'

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
