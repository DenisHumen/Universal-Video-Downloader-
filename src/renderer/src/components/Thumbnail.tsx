import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  src?: string
  /** The page the poster belongs to — some CDNs only serve it with that referer. */
  pageUrl?: string
  alt?: string
  className?: string
  /** Shown while loading and when the image can't be had at all. */
  fallback: ReactNode
  loading?: 'lazy' | 'eager'
}

type Stage = 'direct' | 'proxied' | 'failed'

/**
 * A poster image that copes with hotlink protection.
 *
 * The direct load is tried first — it's free and covers most sites. When it
 * fails (typically a 403 because we deliberately send no referer), the main
 * process re-fetches the bytes with the headers the CDN wants and returns a
 * data: URL. If that fails too we show the fallback icon rather than the
 * browser's broken-image glyph.
 */
export default function Thumbnail({
  src,
  pageUrl,
  alt = '',
  className,
  fallback,
  loading = 'lazy'
}: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>('direct')
  const [resolved, setResolved] = useState<string | undefined>(src)

  // A new src restarts the whole sequence.
  useEffect(() => {
    setStage('direct')
    setResolved(src)
  }, [src])

  const onError = (): void => {
    if (!src || stage !== 'direct') {
      setStage('failed')
      return
    }
    setStage('proxied')
    void window.api
      .fetchThumbnail(src, pageUrl)
      .then((dataUrl) => {
        if (dataUrl) setResolved(dataUrl)
        else setStage('failed')
      })
      .catch(() => setStage('failed'))
  }

  if (!src || stage === 'failed') return <>{fallback}</>

  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      className={className}
      referrerPolicy="no-referrer"
      onError={onError}
    />
  )
}
