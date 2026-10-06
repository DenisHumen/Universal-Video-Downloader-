import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
  /** Stop the countdown while someone is reading or reaching for the toast. */
  pause: (id: number) => void
  /** Start it again once they've moved on. */
  resume: (id: number) => void
}

/*
  Every toast used to vanish after the same 3.4 seconds. That is plenty for
  "copied", and nowhere near enough for a two-line failure from a share or a
  step - errors that, for some actions, appear nowhere else on screen.
*/
export const TOAST_MS: Record<ToastKind, number> = { info: 3400, success: 3400, error: 8000 }

/** However little was left when the pointer arrived, leave time to look again. */
export const RESUME_MIN_MS = 1500

/** Repeated failures otherwise pile up over the very controls they're about. */
export const MAX_TOASTS = 3

type Clock =
  | { timer: ReturnType<typeof setTimeout>; due: number }
  | { timer?: undefined; left: number }

const clocks = new Map<number, Clock>()

function arm(id: number, ms: number): void {
  const timer = setTimeout(() => useToasts.getState().dismiss(id), ms)
  clocks.set(id, { timer, due: Date.now() + ms })
}

function disarm(id: number): void {
  clearTimeout(clocks.get(id)?.timer)
  clocks.delete(id)
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = ++seq
    const toasts = [...get().toasts, { id, message, kind }]
    // The oldest go first: whatever just happened is what the user is waiting on.
    for (const old of toasts.splice(0, Math.max(0, toasts.length - MAX_TOASTS))) disarm(old.id)
    set({ toasts })
    arm(id, TOAST_MS[kind])
  },
  dismiss: (id) => {
    disarm(id)
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  pause: (id) => {
    const clock = clocks.get(id)
    if (!clock?.timer) return
    clearTimeout(clock.timer)
    clocks.set(id, { left: Math.max(0, clock.due - Date.now()) })
  },
  resume: (id) => {
    const clock = clocks.get(id)
    if (!clock || clock.timer) return
    arm(id, Math.max(clock.left, RESUME_MIN_MS))
  }
}))

export const toast = (message: string, kind?: ToastKind): void =>
  useToasts.getState().push(message, kind)
