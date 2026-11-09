/*
  Typing a saved password into a page.

  This used to happen as soon as a form appeared, and the page's own scripts can
  read any field the moment it has a value. So a script on a signed-in site, an
  ad or a comment box that got script in, could add an invisible form and collect
  the password with nobody doing anything. Now it waits for the person: a real
  press on the field, or Tab landing on it, and only a field they can see, in a
  form that sends to this same origin.

  `focus()` will not do as the signal. A page can call it, and the event it fires
  is marked trusted. A press or a key is the only thing here a script cannot make.
*/

export interface PendingLogin {
  username: string
  password: string
}

/** What this needs of the page: the password rules live in site.ts beside the saving. */
export interface FillPage {
  passwordFields: () => HTMLInputElement[]
  usernameFor: (password: HTMLInputElement) => HTMLInputElement | undefined
  typeInto: (field: HTMLInputElement, value: string) => void
  /** Told what went into the form, so it is not then offered back as a new login. */
  filled: (login: PendingLogin) => void
}

/** On the page, on screen, and not see-through at any level. */
export function seenByPerson(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect()
  if (box.width < 2 || box.height < 2) return false
  const view = el.ownerDocument.defaultView
  if (!view) return false
  if (box.right <= 0 || box.bottom <= 0 || box.left >= view.innerWidth || box.top >= view.innerHeight) return false
  const own = view.getComputedStyle(el)
  if (own.visibility !== 'visible' && own.visibility !== '') return false
  for (let at: Element | null = el; at; at = at.parentElement) {
    const style = view.getComputedStyle(at)
    if (style.display === 'none' || Number(style.opacity || 1) < 0.1) return false
  }
  return true
}

function sameOriginAs(target: string | null, doc: Document): boolean {
  if (target === null) return true
  try {
    return new URL(target, doc.baseURI).origin === doc.location.origin
  } catch {
    return false
  }
}

/**
 * Whether the form around a field would send it to this origin. By attribute, not
 * `form.action`, which an input named "action" replaces; and a submit button can
 * carry an address of its own.
 */
export function sendsHere(field: HTMLInputElement): boolean {
  const form = field.form
  if (!form) return true
  if (!sameOriginAs(form.getAttribute('action'), field.ownerDocument)) return false
  return Array.from(form.querySelectorAll('[formaction]')).every((button) =>
    sameOriginAs(button.getAttribute('formaction'), field.ownerDocument)
  )
}

const isUsernameBox = (field: HTMLInputElement): boolean =>
  field.autocomplete === 'username' || field.type === 'email'

/**
 * The person has just gone to `target`. Fill what goes there, and say whether the
 * login has been used up. A two-step sign-in shows the username on its own first,
 * which gets the username and keeps the rest for the next step.
 */
export function fillAt(target: EventTarget | null, login: PendingLogin, page: FillPage): boolean {
  const field = target as HTMLInputElement | null
  if (field?.tagName !== 'INPUT' || !seenByPerson(field) || !sendsHere(field)) return false
  const password = page
    .passwordFields()
    .find((p) => !p.value && p.autocomplete !== 'new-password' && (p === field || page.usernameFor(p) === field))
  if (password) {
    if (!seenByPerson(password) || !sendsHere(password)) return false
    const user = page.usernameFor(password)
    if (user && !user.value && login.username && seenByPerson(user)) page.typeInto(user, login.username)
    page.typeInto(password, login.password)
    page.filled(login)
    return true
  }
  if (!page.passwordFields().length && isUsernameBox(field) && !field.value && login.username) {
    page.typeInto(field, login.username)
  }
  return false
}

/** Hold a login until the person goes to a field. `isTrusted` is read here, in the isolated world. */
export function watchForFill(doc: Document, page: FillPage): (login: PendingLogin) => void {
  let pending: PendingLogin | null = null
  let tabbing = false
  const go = (event: Event): void => {
    if (!pending || !event.isTrusted) return
    if (fillAt(event.target, pending, page)) pending = null
  }
  doc.addEventListener('pointerdown', go, true)
  doc.addEventListener('click', go, true)
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.isTrusted && event.key === 'Tab') tabbing = true
    },
    true
  )
  doc.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Tab') tabbing = false
    },
    true
  )
  doc.addEventListener(
    'focusin',
    (event) => {
      if (tabbing) go(event)
    },
    true
  )
  return (login) => {
    pending = login
  }
}
