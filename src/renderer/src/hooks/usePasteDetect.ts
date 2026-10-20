import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { isEditableTarget, linkIn } from '../lib/shortcuts'

/** Something is open over the screen, and a paste must not pull the user off it. */
function modalOpen(): boolean {
  return useStore.getState().shortcutsOpen || document.querySelector('[aria-modal="true"]') !== null
}

/**
 * Paste or drop a link anywhere in the window to detect it.
 *
 * This lived in HomeView, which exists only while Home is on screen — so the
 * ⌘/Ctrl+V the shortcut list advertises as global did nothing on the other
 * four. From here the link goes through `requestDetect`, which opens Home and
 * leaves the link in the store for Home to pick up; on Home itself the same
 * state change reaches the mounted view, so a paste there detects once.
 */
export function usePasteDetect(): boolean {
  /*
    Whether a link is being dragged over the window, for the drop overlay.
    Counted, because every child the pointer crosses fires its own enter and
    leave; a boolean flipped by them flickered off over every button. A file
    drag is left out: dropping one does nothing here, and the overlay would
    promise otherwise.
  */
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const carriesLink = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types ?? []
      return !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/plain'))
    }
    const onDragEnter = (e: DragEvent): void => {
      if (!carriesLink(e)) return
      depth++
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!carriesLink(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const endDrag = (): void => {
      depth = 0
      setDragging(false)
    }

    const onPaste = (e: ClipboardEvent): void => {
      // A field gets its paste; a dialog keeps the user where they are.
      if (isEditableTarget(e.target as HTMLElement | null) || modalOpen()) return
      const link = linkIn(e.clipboardData?.getData('text'))
      if (link) useStore.getState().requestDetect(link)
    }

    /*
      Every drop is ours unless it is text landing in a field, which takes it
      the ordinary way. Left to the browser, a link dropped anywhere but Home
      opened in the system browser instead of being detected, and a dropped
      file navigated the app window itself to that file.
    */
    const onDrop = (e: DragEvent): void => {
      endDrag()
      const files = e.dataTransfer?.types.includes('Files') ?? false
      if (!files && isEditableTarget(e.target as HTMLElement | null)) return
      e.preventDefault()
      if (files || modalOpen()) return
      const link = linkIn(e.dataTransfer?.getData('text'))
      if (link) useStore.getState().requestDetect(link)
    }
    // Without this the window never becomes a drop target, and `drop` never fires.
    const onDragOver = (e: DragEvent): void => e.preventDefault()

    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    // A drag cancelled with Esc, or released outside the window, ends here.
    window.addEventListener('dragend', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragend', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])
  return dragging
}
