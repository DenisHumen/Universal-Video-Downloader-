import { useT } from '../i18n'
import { helpParts } from '../lib/help'

/** A help string, with the names of buttons and sections in bold: they are what the eye looks for on screen. */
export default function HelpText({ text }: { text: string }): JSX.Element {
  const t = useT()
  return (
    <>
      {helpParts(text, t).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <b key={i} className="font-bold text-ink">
            {part.name}
          </b>
        )
      )}
    </>
  )
}
