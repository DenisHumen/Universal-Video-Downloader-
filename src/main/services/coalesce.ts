/**
 * Fold a run of calls into one, at most once per window.
 *
 * The first call starts a timer and the ones that land while it is pending are
 * absorbed into it; when it fires, the work runs once and the next call starts
 * a fresh window. The timer is deliberately not pushed back by later calls. A
 * debounce that restarts on every call never fires for as long as the calls
 * keep coming - and a long episode moving through its steps, or several watches
 * being checked back to back, is exactly the steady stream that would keep the
 * screen frozen until it stopped.
 */
export function coalesce(work: () => void, windowMs: number): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      work()
    }, windowMs)
  }
}
