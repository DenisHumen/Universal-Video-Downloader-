import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/*
  What a screen was showing, kept while another screen is up.

  Each screen is unmounted when its tab is left, and its state went with it:
  the search results after opening one of them, thirty pasted links after a
  look at Settings, the video just found and the quality picked for it. People
  move between tabs in the middle of things, and coming back to an empty
  screen is losing work.

  This is `useState` whose value outlives the component, for as long as the
  window does. Nothing is written to disk: a new launch starts clean.
*/
const kept = new Map<string, unknown>()

/**
 * `useState`, remembered under `key` across unmounts.
 *
 * `restore` adjusts a remembered value on the way back in - a "searching" that
 * nothing is doing any more becomes idle, say.
 */
export function useKept<T>(
  key: string,
  initial: T | (() => T),
  restore?: (value: T) => T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (kept.has(key)) {
      const was = kept.get(key) as T
      return restore ? restore(was) : was
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    kept.set(key, value)
  }, [key, value])
  return [value, setValue]
}

/** Forget everything, as a new launch would. For tests, which share one window. */
export function forgetKept(): void {
  kept.clear()
}
