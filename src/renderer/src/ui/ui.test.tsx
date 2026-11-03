import { act, fireEvent, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Icon,
  ICON_STROKE,
  IconButton,
  Menu,
  SegmentedControl,
  SettingsGroup,
  SettingsRow,
  Switch,
  TOOLTIP_DELAY,
  useSettingsRowLabel
} from '.'
import { Download } from './icons'

/*
  Plan 3.1: every primitive is token-only and tested — names, roles, the
  keyboard, and an axe pass.
*/

describe('token-only', () => {
  const dir = __dirname
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  it.each(files)('%s has no hardcoded colour, size or duration', (file) => {
    const src = readFileSync(join(dir, file), 'utf-8')
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(src).not.toMatch(/\brgba?\(/)
    expect(src).not.toMatch(/\btext-\[\d/)
    expect(src).not.toMatch(/\d+ms\b/)
    expect(src).not.toMatch(/\b(bg|text|border)-(white|black|gray|zinc|slate|neutral|red|blue|green)-/)
    // Tailwind drops a component class it cannot see written out whole.
    expect(src).not.toMatch(/`ui-[\w-]*\$\{/)
  })
})

describe('icons (plan 3.2)', () => {
  const root = join(__dirname, '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
    )
  it('imports lucide-react only inside ui/', () => {
    const offenders = walk(root)
      .filter((f) => !f.startsWith(join(root, 'ui')))
      .filter((f) => /from ['"]lucide-react['"]/.test(readFileSync(f, 'utf-8')))
      .map((f) => f.slice(root.length + 1))
    expect(offenders).toEqual([])
  })

  it('draws at sm 14 / md 16 / lg 24 with a 1.75 stroke', () => {
    const { container } = render(
      <>
        <Icon icon={Download} size="sm" />
        <Icon icon={Download} />
        <Icon icon={Download} size="lg" label="Download" />
      </>
    )
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs.map((s) => s.getAttribute('width'))).toEqual(['14', '16', '24'])
    expect(svgs.every((s) => s.getAttribute('stroke-width') === String(ICON_STROKE))).toBe(true)
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('img', { name: 'Download' })).toBeTruthy()
  })

  it('gives the re-exported glyphs the same stroke by default', () => {
    const { container } = render(<Download size={16} />)
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe(String(ICON_STROKE))
  })
})

describe('framer-motion (plan 3.3)', () => {
  const root = join(__dirname, '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : []
    )
  it('uses the lazy `m` components, never the full `motion` ones', () => {
    const offenders = walk(root).filter((f) => /<motion\.|import \{[^}]*\bmotion\b[^}]*\} from 'framer-motion'/.test(readFileSync(f, 'utf-8')))
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([])
  })
})

describe('Button', () => {
  it('maps variant and size onto the token classes', () => {
    render(
      <Button variant="primary" size="lg">
        Download
      </Button>
    )
    const b = screen.getByRole('button', { name: 'Download' })
    expect(b.className).toContain('ui-btn-primary')
    expect(b.className).toContain('ui-h-lg')
    expect(b.getAttribute('type')).toBe('button')
  })
})

describe('IconButton', () => {
  it('is named by its label and shows it as a tooltip after the delay', async () => {
    vi.useFakeTimers()
    render(<IconButton label="Pause all" icon={<svg />} />)
    const b = screen.getByRole('button', { name: 'Pause all' })
    fireEvent.mouseEnter(b)
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY))
    expect(screen.getByRole('tooltip').textContent).toBe('Pause all')
    fireEvent.mouseLeave(b)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Field', () => {
  it('passes everything through and has no violations when labelled', async () => {
    render(<Field aria-label="Link" placeholder="Paste a link" />)
    expect(screen.getByRole('textbox', { name: 'Link' }).className).toContain('ui-field')
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Switch and Checkbox', () => {
  it('toggle and report their state', async () => {
    function Both(): JSX.Element {
      const [on, setOn] = useState(false)
      const [ticked, setTicked] = useState(false)
      return (
        <>
          <Switch aria-label="Notifications" checked={on} onChange={setOn} />
          <Checkbox checked={ticked} onChange={setTicked}>
            Episode 1
          </Checkbox>
        </>
      )
    }
    render(<Both />)
    const sw = screen.getByRole('switch', { name: 'Notifications' })
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const box = screen.getByRole('checkbox', { name: 'Episode 1' })
    fireEvent.click(screen.getByText('Episode 1'))
    expect(box.getAttribute('aria-checked')).toBe('true')
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('SegmentedControl', () => {
  it('is one tab stop; arrows move and select', async () => {
    function Theme(): JSX.Element {
      const [v, setV] = useState<'night' | 'day' | 'system'>('night')
      return (
        <SegmentedControl
          label="Theme"
          value={v}
          onChange={setV}
          options={[
            { value: 'night', label: 'Night' },
            { value: 'day', label: 'Day' },
            { value: 'system', label: 'System' }
          ]}
        />
      )
    }
    render(<Theme />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
    radios[0].focus()
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' })
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios[1])
    fireEvent.keyDown(radios[1], { key: 'End' })
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Menu', () => {
  it('opens from its trigger, moves focus in, and Esc returns it', async () => {
    const remove = vi.fn()
    render(
      <Menu
        label="More"
        items={[
          { label: 'Show in folder', onSelect: vi.fn() },
          'separator',
          { label: 'Remove', onSelect: remove, danger: true }
        ]}
        trigger={(p) => <IconButton {...p} label="More" icon={<svg />} tooltip={false} />}
      />
    )
    const trigger = screen.getByRole('button', { name: 'More' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    await act(async () => fireEvent.click(trigger))
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    expect(await axeViolations(document.body)).toEqual([])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => fireEvent.click(trigger))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(remove).toHaveBeenCalled()
  })
})

describe('Dialog', () => {
  it('is named and described, and Esc closes it', async () => {
    const onClose = vi.fn()
    render(
      <Dialog
        title="Remove the file?"
        description="It goes to the system trash."
        onClose={onClose}
        role="alertdialog"
        actions={<Button>Cancel</Button>}
      />
    )
    const d = screen.getByRole('alertdialog', { name: 'Remove the file?' })
    expect(d.getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? d, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('SettingsGroup / SettingsRow', () => {
  it('names the control by the row title', async () => {
    function Control(): JSX.Element {
      const id = useSettingsRowLabel()
      return <Switch aria-labelledby={id} checked onChange={() => undefined} />
    }
    render(
      <SettingsGroup title="Notifications">
        <SettingsRow title="When a download finishes" hint="A desktop notification">
          <Control />
        </SettingsRow>
      </SettingsGroup>
    )
    expect(screen.getByRole('switch', { name: 'When a download finishes' })).toBeTruthy()
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('EmptyState', () => {
  it('always carries its way out', () => {
    render(<EmptyState icon={<svg />} title="Nothing yet" hint="Paste a link" action={<Button>Paste</Button>} />)
    expect(screen.getByText('Nothing yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paste' })).toBeTruthy()
  })
})
