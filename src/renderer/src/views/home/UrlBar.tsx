import { forwardRef } from 'react'
import { ArrowRight, ClipboardPaste, Loader2, Search } from '../../ui/icons'
import { linkIn } from '../../lib/shortcuts'
import { useT } from '../../i18n'
import Tooltip from '../../ui/Tooltip'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Enter or the button: detect a link, search a title. */
  onSubmit: () => void
  /** A link pasted or dropped on the field: it replaces the text and is detected. */
  onLink: (link: string) => void
  /** The paste button: read the clipboard. */
  onPaste: () => void
  busy: boolean
  /** The text is a title, not a link: the button searches. */
  searching: boolean
  /** The result for this text is already on screen: the button goes quiet. */
  done: boolean
}

/**
 * The one entry on the Download view (5.4): a link, several lines, or a title.
 * A GNOME linked entry + suggested button, raised on the page.
 */
const UrlBar = forwardRef<HTMLInputElement, Props>(function UrlBar(
  { value, onChange, onSubmit, onLink, onPaste, busy, searching, done },
  ref
) {
  const t = useT()
  return (
    <>
      <label className="sr-only" htmlFor="uvd-url">
        {t('home.linkLabel')}
      </label>
      <div className="field mt-6 flex items-center gap-1.5 rounded-3 p-1.5 shadow-[var(--shadow-2)]">
        <input
          id="uvd-url"
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // ⌘/Ctrl+Enter is "download now", answered by the view's window listener.
          onKeyDown={(e) => e.key === 'Enter' && !e.metaKey && !e.ctrlKey && onSubmit()}
          /*
            Fields take dropped text at the caret, and usePasteDetect leaves
            them to it — which here would splice a second link into the first.
            A link dropped on this field replaces it and is detected, as it is
            anywhere else in the window.
          */
          onDrop={(e) => {
            const link = linkIn(e.dataTransfer.getData('text'))
            if (!link) return
            e.preventDefault()
            onLink(link)
          }}
          /*
            The field is focused the moment Download opens, and usePasteDetect
            leaves pastes into fields alone — so ⌘/Ctrl+V of a link would only
            fill the field and wait for Enter. A pasted link replaces the field
            and is detected; any other text pastes at the caret.
          */
          onPaste={(e) => {
            const link = linkIn(e.clipboardData.getData('text'))
            if (!link) return
            e.preventDefault()
            onLink(link)
          }}
          placeholder={t('home.placeholder')}
          aria-label={t('home.placeholder')}
          className="no-drag min-w-0 flex-1 bg-transparent px-2.5 py-2 text-body text-ink outline-none placeholder:text-ink-3"
          spellCheck={false}
          autoComplete="off"
        />
        <Tooltip label={t('common.paste')}>
          <button type="button" className="btn-icon-bare" onClick={onPaste} aria-label={t('common.paste')}>
            <ClipboardPaste size={16} />
          </button>
        </Tooltip>
        <button
          type="button"
          className={done ? 'btn-quiet px-5' : 'btn-solid px-5'}
          data-uvd="detect"
          onClick={onSubmit}
          disabled={!value.trim() || busy}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : searching ? (
            <Search size={16} />
          ) : (
            <ArrowRight size={16} />
          )}
          {searching ? t('common.search') : t('home.get')}
        </button>
      </div>
    </>
  )
})

export default UrlBar
