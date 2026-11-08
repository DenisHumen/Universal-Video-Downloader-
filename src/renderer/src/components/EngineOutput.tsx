import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

interface Props {
  id: string
  /** Still producing output, so worth asking again. */
  running: boolean
}

const REFRESH_MS = 1000

/**
 * What the engine has been saying, for a row that is still at it.
 *
 * Asked for while open rather than pushed: the main process keeps a running
 * row's output to itself because an engine can print hundreds of lines a minute,
 * and each would otherwise be a new item and a redraw of the row for everybody
 * who never opens this. The text is this component's own state, so a new line
 * redraws this box and nothing else.
 */
export default function EngineOutput({ id, running }: Props): JSX.Element {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const box = useRef<HTMLPreElement>(null)
  // Reading further up is not to be undone by the next line arriving.
  const following = useRef(true)

  useEffect(() => {
    let gone = false
    const read = (): void => {
      void window.api.downloadLog(id).then((log) => {
        if (!gone) setText(log)
      })
    }
    read()
    if (!running) return () => void (gone = true)
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      gone = true
      clearInterval(timer)
    }
  }, [id, running])

  useEffect(() => {
    if (following.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text])

  return (
    <pre
      ref={box}
      data-engine-output={id}
      onScroll={(e) => {
        const el = e.currentTarget
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className="selectable mono max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-1 bg-sink px-3 py-2.5 text-caption leading-relaxed text-ink-2"
    >
      {text || t('queue.logEmpty')}
    </pre>
  )
}
