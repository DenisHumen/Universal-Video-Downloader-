// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fillAt, seenByPerson, sendsHere, watchForFill, type FillPage } from './site-fill'

const LOGIN = { username: 'me@example.com', password: 'example-password' }

/** jsdom lays nothing out, so a field reports the box a browser would give it. */
function box(el: HTMLElement, width = 200, height = 30): void {
  el.getBoundingClientRect = () => ({ width, height, left: 10, top: 10, right: 10 + width, bottom: 10 + height, x: 10, y: 10 }) as DOMRect
}

function pageOf(): FillPage & { typed: [HTMLInputElement, string][]; used: unknown[] } {
  const typed: [HTMLInputElement, string][] = []
  const used: unknown[] = []
  return {
    typed,
    used,
    passwordFields: () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')),
    usernameFor: (password) => (password.form ?? document).querySelector<HTMLInputElement>('input[type="email"], input[type="text"]') ?? undefined,
    typeInto: (field, value) => {
      field.value = value
      typed.push([field, value])
    },
    filled: (login) => used.push(login)
  }
}

function form(action = ''): { user: HTMLInputElement; pass: HTMLInputElement; el: HTMLFormElement } {
  document.body.innerHTML = `<form ${action}><input type="email"><input type="password"><button>Go</button></form>`
  const user = document.querySelector<HTMLInputElement>('input[type="email"]')!
  const pass = document.querySelector<HTMLInputElement>('input[type="password"]')!
  box(user)
  box(pass)
  return { user, pass, el: document.querySelector('form')! }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fillAt', () => {
  it('fills both boxes from the password box', () => {
    const { user, pass } = form()
    const page = pageOf()
    expect(fillAt(pass, LOGIN, page)).toBe(true)
    expect(user.value).toBe(LOGIN.username)
    expect(pass.value).toBe(LOGIN.password)
    expect(page.used).toEqual([LOGIN])
  })

  it('fills both boxes from the username box', () => {
    const { user, pass } = form()
    expect(fillAt(user, LOGIN, pageOf())).toBe(true)
    expect(pass.value).toBe(LOGIN.password)
  })

  it('types over nothing the person has written', () => {
    const { user, pass } = form()
    user.value = 'typed-by-hand'
    fillAt(pass, LOGIN, pageOf())
    expect(user.value).toBe('typed-by-hand')
    pass.value = 'typed-too'
    expect(fillAt(pass, LOGIN, pageOf())).toBe(false)
    expect(pass.value).toBe('typed-too')
  })

  it('leaves a field nobody can see', () => {
    const { pass } = form()
    box(pass, 0, 0)
    expect(fillAt(pass, LOGIN, pageOf())).toBe(false)
    expect(pass.value).toBe('')
  })

  it('leaves a see-through field, and one under a see-through parent', () => {
    const { pass, el } = form()
    pass.style.opacity = '0'
    expect(seenByPerson(pass)).toBe(false)
    pass.style.opacity = ''
    el.style.opacity = '0.01'
    expect(seenByPerson(pass)).toBe(false)
    expect(fillAt(pass, LOGIN, pageOf())).toBe(false)
  })

  it('leaves a field moved off the page', () => {
    const { pass } = form()
    pass.getBoundingClientRect = () => ({ width: 200, height: 30, left: -9000, top: 10, right: -8800, bottom: 40, x: -9000, y: 10 }) as DOMRect
    expect(seenByPerson(pass)).toBe(false)
  })

  it('does not fill a form that sends to another origin', () => {
    const { pass } = form('action="https://collector.example/steal"')
    expect(sendsHere(pass)).toBe(false)
    expect(fillAt(pass, LOGIN, pageOf())).toBe(false)
    expect(pass.value).toBe('')
  })

  it('is not fooled by an input named action', () => {
    const { el, pass } = form('action="https://collector.example/steal"')
    el.insertAdjacentHTML('beforeend', '<input name="action" value="x">')
    expect(sendsHere(pass)).toBe(false)
  })

  it('does not fill a form whose button sends elsewhere', () => {
    const { el, pass } = form()
    el.querySelector('button')!.setAttribute('formaction', 'https://collector.example/steal')
    expect(sendsHere(pass)).toBe(false)
  })

  it('fills a form that sends to this origin, by path or in full', () => {
    expect(sendsHere(form('action="/login"').pass)).toBe(true)
    expect(sendsHere(form(`action="${location.origin}/login"`).pass)).toBe(true)
  })

  it('gives a two-step sign-in its username and keeps the password for the next step', () => {
    document.body.innerHTML = '<form><input type="email"></form>'
    const user = document.querySelector<HTMLInputElement>('input')!
    box(user)
    expect(fillAt(user, LOGIN, pageOf())).toBe(false)
    expect(user.value).toBe(LOGIN.username)
  })
})

describe('watchForFill', () => {
  it('fills nothing for an event a script made, or on its own', () => {
    const { pass } = form()
    const page = pageOf()
    const typeInto = vi.spyOn(page, 'typeInto')
    const hold = watchForFill(document, page)
    hold(LOGIN)
    // Everything dispatched from a script reads isTrusted false, here as in a browser.
    pass.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    pass.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    pass.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    pass.focus()
    expect(typeInto).not.toHaveBeenCalled()
    expect(pass.value).toBe('')
  })
})
