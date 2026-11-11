import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import {
  AccentSwatches,
  ActionRow,
  Badge,
  Banner,
  ComboRow,
  EntryRow,
  ExpanderRow,
  HeaderBar,
  NavigationStack,
  PasswordEntryRow,
  PreferencesGroup,
  PreferencesPage,
  Spinner,
  StyleTiles,
  SwitchRow,
  type TileStyle
} from '.'

/* D3: the GNOME primitives - roles, names, keyboard, and axe. */

describe('HeaderBar', () => {
  it('is a drag region with a centred heading and no-drag slots', () => {
    const { container } = render(
      <HeaderBar title="Settings" start={<button className="ui-icon-btn" aria-label="Back" />} data-uvd="hb" />
    )
    const bar = container.querySelector('[data-uvd="hb"]')!
    expect(bar.classList.contains('drag-region')).toBe(true)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })
})

describe('preferences rows', () => {
  it('name every control by its row title, and pass axe', async () => {
    function Page(): JSX.Element {
      const [on, setOn] = useState(false)
      const [q, setQ] = useState('best')
      return (
        <PreferencesPage>
          <PreferencesGroup title="Defaults" description="For new downloads" suffix={<button aria-label="Add" />}>
            <SwitchRow title="Resume on Launch" checked={on} onChange={setOn} id="resume" />
            <ComboRow
              title="Quality"
              value={q}
              onChange={setQ}
              options={[
                { value: 'best', label: 'Best' },
                { value: '1080', label: '1080p' }
              ]}
            />
            <EntryRow title="Template" defaultValue="{title}" mono />
            <PasswordEntryRow title="Password" showLabel="Show" hideLabel="Hide" />
            <ActionRow title="Proxy" value="Off" navigation onActivate={() => undefined} id="proxy" />
          </PreferencesGroup>
        </PreferencesPage>
      )
    }
    render(<Page />)
    const sw = screen.getByRole('switch', { name: 'Resume on Launch' })
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const combo = screen.getByRole('combobox', { name: 'Quality' })
    fireEvent.click(combo)
    fireEvent.click(screen.getByRole('option', { name: /1080/ }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(combo.textContent).toMatch(/1080/)
    expect(screen.getByRole('textbox', { name: 'Template' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByRole('button', { name: 'Hide' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Proxy/ }).getAttribute('data-row')).toBe('proxy')
    expect(document.querySelector('[data-row="resume"]')).not.toBeNull()
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('expands an expander row, and its children follow the enable switch', () => {
    function E(): JSX.Element {
      const [on, setOn] = useState(false)
      return (
        <ExpanderRow title="SponsorBlock" enabled={on} onEnabledChange={setOn} expandLabel="Show options">
          <ActionRow title="Categories" />
        </ExpanderRow>
      )
    }
    render(<E />)
    fireEvent.click(screen.getByRole('button', { name: 'Show options' }))
    expect(screen.getByText('Categories').closest('[aria-disabled]')?.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'SponsorBlock' }))
    expect(screen.getByText('Categories').closest('[aria-disabled]')?.getAttribute('aria-disabled')).toBe('false')
  })

  it('expands from anywhere on its row, except the controls that answer for themselves', () => {
    const toggle = vi.fn()
    render(
      <ExpanderRow title="SponsorBlock" subtitle="Skips the sponsor" enabled={false} onEnabledChange={toggle} expandLabel="Show options">
        <ActionRow title="Categories" />
      </ExpanderRow>
    )
    const chevron = screen.getByRole('button', { name: 'Show options' })
    fireEvent.click(screen.getByText('Skips the sponsor'))
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Categories')).toBeTruthy()
    // The switch is its own question; it must not fold the row as well.
    fireEvent.click(screen.getByRole('switch', { name: 'SponsorBlock' }))
    expect(toggle).toHaveBeenCalledWith(true)
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(chevron)
    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    // Nothing inside what it revealed folds it either.
    fireEvent.click(chevron)
    fireEvent.click(screen.getByText('Categories'))
    expect(chevron.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('NavigationStack', () => {
  it('shows the top page, slides it in, and goes back on Esc and Alt+Left', () => {
    const back = vi.fn()
    const { container, rerender } = render(
      <NavigationStack pages={[{ key: 'list', node: <p>List</p> }]} onBack={back} />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(back).not.toHaveBeenCalled()
    rerender(
      <NavigationStack
        pages={[
          { key: 'list', node: <p>List</p> },
          { key: 'network', node: <p>Network</p> }
        ]}
        onBack={back}
      />
    )
    expect(screen.getByText('Network')).toBeTruthy()
    expect(screen.queryByText('List')).toBeNull()
    expect(container.querySelector('[data-page="network"]')?.className).toContain('ui-page-push')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    expect(back).toHaveBeenCalledTimes(2)
  })
})

describe('Appearance pickers', () => {
  it('style tiles and accent swatches are radio groups with arrow keys', async () => {
    function P(): JSX.Element {
      const [style, setStyle] = useState<TileStyle>('system')
      const [accent, setAccent] = useState('orange')
      return (
        <>
          <StyleTiles
            label="Style"
            value={style}
            onChange={setStyle}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'night', label: 'Night' },
              { value: 'system', label: 'System' }
            ]}
          />
          <AccentSwatches
            label="Accent Color"
            value={accent}
            onChange={setAccent}
            options={[
              { value: 'orange', label: 'Orange' },
              { value: 'blue', label: 'Blue' }
            ]}
          />
        </>
      )
    }
    render(<P />)
    const tiles = screen.getAllByRole('radio').slice(0, 3)
    expect(tiles.map((t) => t.tabIndex)).toEqual([-1, -1, 0])
    fireEvent.keyDown(tiles[2], { key: 'ArrowRight' })
    expect(tiles[0].getAttribute('aria-checked')).toBe('true')
    const blue = screen.getByRole('radio', { name: 'Blue' })
    expect(blue.getAttribute('data-accent')).toBe('blue')
    fireEvent.click(blue)
    expect(blue.getAttribute('aria-checked')).toBe('true')
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Badge, Banner, Spinner', () => {
  it('render their roles', async () => {
    render(
      <>
        <Badge label="3 active">3</Badge>
        <Banner title="Getting the download engine ready" />
        <Spinner label="Loading" />
      </>
    )
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy()
    expect(screen.getAllByRole('status')).toHaveLength(2)
    await act(async () => undefined)
    expect(await axeViolations(document.body)).toEqual([])
  })
})

/*
  A list open over a dialog owns the keyboard. The dialogs' listener runs first,
  so an Esc meant for the list used to close the dialog under it - and the form
  typed into it.
*/
describe('a drop-down inside a dialog', () => {
  it('takes Esc for itself, and the dialog takes the next one', async () => {
    const { default: Modal } = await import('../components/Modal')
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose} label="Step">
        <PreferencesGroup>
          <ComboRow
            title="Share"
            value="a"
            onChange={() => undefined}
            options={[
              { value: 'a', label: 'NAS' },
              { value: 'b', label: 'Backup' }
            ]}
          />
        </PreferencesGroup>
      </Modal>
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Share' }))
    const option = screen.getByRole('option', { name: 'Backup' })
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(screen.queryByRole('option', { name: 'Backup' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Share' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
