import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { axeViolations } from '../../../../test/axe'
import type { SmbTarget } from '@shared/automation'
import ShareFolderDialog from './ShareFolderDialog'
import { ShareForm } from './AutomationForms'

/*
  The in-app share browser: walk the mock share's folders, make one, pick one.
  The mock share holds video/{series,films}, music and Backups.
*/

beforeAll(() => installMockApi())

const target: SmbTarget = {
  id: 'nas',
  name: '',
  host: '192.168.1.10',
  share: 'shared',
  path: '',
  domain: '',
  username: 'denis'
}

const rows = (): string[] =>
  within(screen.getByRole('list', { name: 'Folders' }))
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')

describe('ShareFolderDialog', () => {
  it('lists the folders, opens one, and goes back up by the path bar and the up button', async () => {
    const onPick = vi.fn()
    render(<ShareFolderDialog target={target} password="" onPick={onPick} onClose={() => undefined} />)
    expect(screen.getByRole('dialog', { name: 'Choose a Folder' })).toBeTruthy()
    await waitFor(() => expect(rows()).toEqual(['Backups', 'music', 'video']))
    expect((screen.getByRole('button', { name: 'Parent Folder' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'video' })))
    await waitFor(() => expect(rows()).toEqual(['films', 'series']))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'series' })))
    await waitFor(() => expect(rows()).toEqual(['Severance', 'The Bear']))

    const path = screen.getByRole('navigation', { name: 'Location' })
    expect(within(path).getAllByRole('button').map((b) => b.textContent)).toEqual(['shared', 'video', 'series'])
    expect(within(path).getByRole('button', { name: 'series' }).getAttribute('aria-current')).toBe('location')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Parent Folder' })))
    await waitFor(() => expect(rows()).toEqual(['films', 'series']))
    await act(async () => fireEvent.click(within(path).getByRole('button', { name: 'shared' })))
    await waitFor(() => expect(rows()).toEqual(['Backups', 'music', 'video']))

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'music' })))
    await waitFor(() => expect(screen.getByText('No folders here')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(onPick).toHaveBeenCalledWith('music')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('makes a new folder and opens it', async () => {
    const create = vi.spyOn(window.api, 'autoCreateShareFolder')
    const onPick = vi.fn()
    render(<ShareFolderDialog target={{ ...target, path: 'video/films' }} password="pw" onPick={onPick} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByText('No folders here')).toBeTruthy())
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New Folder' })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), { target: { value: 'Classics' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 'nas' }), 'pw', 'video/films', 'Classics')
    await waitFor(() =>
      expect(within(screen.getByRole('navigation', { name: 'Location' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'shared',
        'video',
        'films',
        'Classics'
      ])
    )
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(onPick).toHaveBeenCalledWith('video/films/Classics')
  })

  it('shows the server’s refusal and offers to try again', async () => {
    const list = vi.spyOn(window.api, 'autoListShareFolders')
    list.mockRejectedValueOnce(new Error('The server rejected that username or password.'))
    render(<ShareFolderDialog target={target} password="bad" onPick={() => undefined} onClose={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toContain('The server rejected that username or password.')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))
    await waitFor(() => expect(rows()).toEqual(['Backups', 'music', 'video']))
    list.mockRestore()
  })
})

describe('ShareForm', () => {
  it('opens the browser once a login is known, and writes the folder picked into the path', async () => {
    const onTarget = vi.fn()
    const { rerender } = render(
      <ShareForm target={{ ...target, username: '' }} onTarget={onTarget} password="" onPassword={() => undefined} passwordStored={false} />
    )
    expect((screen.getByRole('button', { name: 'Browse Share…' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ShareForm target={target} onTarget={onTarget} password="" onPassword={() => undefined} passwordStored />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browse Share…' })))
    await waitFor(() => expect(rows()).toEqual(['Backups', 'music', 'video']))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'video' })))
    await waitFor(() => expect(rows()).toEqual(['films', 'series']))
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(onTarget).toHaveBeenLastCalledWith(expect.objectContaining({ host: '192.168.1.10', share: 'shared', path: 'video' }))
    expect((screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('\\\\192.168.1.10\\shared\\video')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
