import { act, render, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { axeViolations } from '../../../test/axe'
import { installMockApi } from './lib/mockApi'
import { useStore, type ViewId } from './store'
import App from './App'

/*
  An axe pass over every view of the real shell, against the same mock bridge
  the browser preview and the visual harness run on. Structure and names only
  (see test/axe.ts): contrast has its own gate.
*/

const VIEWS: ViewId[] = ['home', 'search', 'downloads', 'automation', 'settings']

beforeAll(() => {
  installMockApi()
})

describe('every view passes axe', () => {
  it.each(VIEWS)('%s', async (view) => {
    const { container } = render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true), { timeout: 5000 })
    await act(async () => useStore.getState().setView(view))
    // The view itself, not the "starting" placeholder.
    expect(container.querySelector('main')?.textContent?.length ?? 0).toBeGreaterThan(40)
    expect(await axeViolations(container)).toEqual([])
  })
})
