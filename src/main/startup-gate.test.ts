import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createStartupGate } from './startup-gate'

describe('the startup gate (a second launch during startup)', () => {
  it('holds a show request until the first window exists, then applies it once', () => {
    const gate = createStartupGate()
    const show = vi.fn()
    gate.requestShow(show)
    gate.requestShow(show)
    expect(show).not.toHaveBeenCalled()
    gate.started()
    expect(show).toHaveBeenCalledTimes(1)
    gate.requestShow(show)
    expect(show).toHaveBeenCalledTimes(2)
  })

  it('is what index.ts uses: second-instance goes through the gate, and the window opens it', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const handler = src.slice(src.indexOf("app.on('second-instance'"), src.indexOf("app.whenReady()"))
    expect(handler).toContain('gate.requestShow(showMainWindow)')
    expect(handler).not.toMatch(/^\s*showMainWindow\(\)/m)
    expect(src).toMatch(/createWindow\(startHidden\)\s*\n\s*gate\.started\(\)/)
    expect(src).toContain('initSecretsWithin(SECRETS_STARTUP_CAP_MS)')
  })
})
