import { useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Copy, Loader2, Mail, RefreshCw, Send } from 'lucide-react'
import type { AppErrorCode } from '@shared/types'
import {
  buildMailto,
  isReportable,
  isUnsupportedSite,
  reportAnswerKey,
  type ReportPreview,
  type ReportStage,
  type SendFailure
} from '@shared/report'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import { collapse } from '../lib/motion'

/*
  Which site-and-error pairs the user has already answered this session, either
  way. A queue of twelve failures from one site is one question, not twelve —
  asking again after "not now" is how an offer turns into nagging.

  Module state rather than the store: it is session memory that nothing else
  reads, and it should survive this component unmounting when the user moves
  between screens. Subscribable, so answering one prompt quietly retires every
  other one on screen that asks the same thing.
*/
const answered = new Set<string>()
const listeners = new Set<() => void>()

function remember(key: string): void {
  if (answered.has(key)) return
  answered.add(key)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface ReportFailure {
  /** Main's handle on the failure. None means main decided not to keep it. */
  reportId?: string
  stage: ReportStage
  url: string
  errorCode?: AppErrorCode
}

const answerKey = (failure: ReportFailure): string => reportAnswerKey(failure.url, failure.errorCode)

/** Whether this failure should offer a report right now. */
export function useReportOffer(failure: ReportFailure): boolean {
  const enabled = useStore((s) => s.settings?.errorReports !== 'off')
  const key = answerKey(failure)
  const done = useSyncExternalStore(subscribe, () => answered.has(key))
  return Boolean(failure.reportId) && enabled && isReportable(failure.errorCode) && !done
}

type Phase = 'idle' | 'sending' | 'sent' | 'failed'

const FAILURE_TEXT: Record<SendFailure, TranslationKey> = {
  rejected: 'report.failed',
  notActivated: 'report.failed',
  network: 'report.failed',
  rateLimited: 'report.limit',
  expired: 'report.gone'
}

/**
 * An offer to send the developer a report about this failure.
 *
 * A question, never an action: nothing leaves the machine until "send" is
 * pressed for this particular failure, and "what will be sent" shows the exact
 * text first. When sending fails — no network, the relay not activated yet —
 * the same text can still go out through the mail app or the clipboard, so a
 * report the user decided to send is never simply lost.
 *
 * The accent here is a tint, not the solid fill. The solid button is the one
 * loud element on a screen, and on Home that is already "open in browser" —
 * the honest way forward for this very failure.
 */
export default function ReportPrompt(props: ReportFailure): JSX.Element | null {
  const t = useT()
  const offered = useReportOffer(props)
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<SendFailure | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  /** Undefined until asked for; null when main no longer holds the failure. */
  const [preview, setPreview] = useState<ReportPreview | null | undefined>(undefined)

  // Once answered, the card stays to say how it went; an idle one simply goes.
  if (!props.reportId || (phase === 'idle' && !offered)) return null
  const id = props.reportId
  const key = answerKey(props)

  const loadPreview = async (): Promise<void> => {
    if (preview !== undefined) return
    setPreview(await window.api.reportPreview(id).catch(() => null))
  }

  const send = async (): Promise<void> => {
    remember(key)
    setPhase('sending')
    const outcome = await window.api
      .reportSend(id)
      .catch(() => ({ ok: false, reason: 'network' }) as const)
    if (outcome.ok) {
      setPhase('sent')
      return
    }
    setFailure(outcome.reason)
    setPhase('failed')
    // The fallbacks need the text; fetch it now rather than on their click.
    void loadPreview()
  }

  const openMail = (): void => {
    if (preview) void window.api.openExternal(buildMailto(preview.subject, preview.text))
  }

  const copyReport = async (): Promise<void> => {
    if (!preview) return
    try {
      await navigator.clipboard.writeText(`${preview.subject}\n\n${preview.text}`)
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  const unsupported = isUnsupportedSite(props.stage, props.errorCode)
  const outcome =
    phase === 'sending'
      ? t('report.sending')
      : phase === 'sent'
        ? t('report.sent')
        : phase === 'failed' && failure
          ? t(FAILURE_TEXT[failure])
          : ''

  return (
    <div className="well mt-3 p-3.5">
      <div className="flex items-baseline gap-3">
        <span className="label shrink-0 text-accent-ink">{t('report.stamp')}</span>
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
          {unsupported ? t('report.unsupported') : t('report.generic')}
        </p>
      </div>

      {/* Present from the first render, so a screen reader hears it change. */}
      <span className="sr-only" role="status" aria-live="polite">
        {outcome}
      </span>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {phase === 'idle' && (
          <>
            <button className="btn-base bg-accent/12 text-accent-ink hover:bg-accent/20" onClick={send}>
              <Send size={14} /> {t('report.send')}
            </button>
            <button className="btn-quiet" onClick={() => remember(key)}>
              {t('report.notNow')}
            </button>
          </>
        )}
        {phase === 'sending' && (
          <button className="btn-base bg-accent/12 text-accent-ink" disabled>
            <Loader2 size={14} className="animate-spin" /> {t('report.sending')}
          </button>
        )}
        {phase === 'sent' && (
          <p className="flex items-center gap-1.5 text-[13px] text-good">
            <Check size={14} /> {outcome}
          </p>
        )}
        {phase === 'failed' && (
          <div className="w-full">
            <p className="text-[13px] leading-relaxed text-bad">{outcome}</p>
            {/*
              Answering already retired every other prompt for this site and
              error, so this card is the one way left to send it through the
              relay — after a dropped connection, the hour's limit, or once the
              relay is activated. A report main no longer holds has nothing to
              retry.
            */}
            {(failure !== 'expired' || preview) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {failure !== 'expired' && (
                  <button className="btn-base bg-accent/12 text-accent-ink hover:bg-accent/20" onClick={send}>
                    <RefreshCw size={14} /> {t('common.retry')}
                  </button>
                )}
                {preview && (
                  <>
                    <button className="btn-quiet" onClick={openMail}>
                      <Mail size={14} /> {t('report.mail')}
                    </button>
                    <button className="btn-quiet" onClick={copyReport}>
                      <Copy size={14} /> {t('report.copy')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {(phase === 'idle' || phase === 'failed') && (
        <>
          <button
            onClick={() => {
              setDetailsOpen((v) => !v)
              void loadPreview()
            }}
            aria-expanded={detailsOpen}
            className="mono mt-3 flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-ink-2 transition-colors duration-fast ease-ease hover:text-ink"
          >
            {t('report.details')}
            <motion.span animate={{ rotate: detailsOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
              <ChevronDown size={12} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div {...collapse} className="overflow-hidden">
                <p className="hint mt-2">{t('report.privacy')}</p>
                {preview === undefined ? (
                  <Loader2 size={14} className="mt-2 animate-spin text-ink-3" />
                ) : preview ? (
                  <pre className="selectable mono mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-1 bg-raise px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
                    {`${preview.subject}\n\n${preview.text}`}
                  </pre>
                ) : (
                  <p className="hint mt-2">{t('report.gone')}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}
