import { useEffect, useState } from 'react'
import { ACCENTS, type AccentChoice } from '@shared/accent'
import { SUPPORTED_COOKIE_BROWSERS, type AppSettings, type ThemeId } from '@shared/types'
import { Folder } from '../ui/icons'
import { AccentSwatches, ActionRow, ComboRow, Dialog, PreferencesGroup, StyleTiles, SwitchRow, type TileStyle } from '../ui'
import { useT } from '../i18n'
import { useStore } from '../store'
import { ACCENT_LABEL } from '../views/settings/panels'

/** The three steps (6.3). */
export const SETUP_STEPS = ['folder', 'cookies', 'look'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/**
 * First-run setup (6.3): three skippable steps — where files go, which
 * browser's cookies to use, then notifications, style and accent. Every
 * choice saves as it is made, so leaving at any step keeps what was chosen.
 * Shown once (`setupDone`), and again from the primary menu.
 */
export default function FirstRunSetup(): JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const open = useStore((s) => s.setupOpen)
  const setOpen = useStore((s) => s.setSetupOpen)
  const ready = useStore((s) => s.ready)

  // The first launch of a new install opens it by itself, once.
  useEffect(() => {
    if (ready && settings && !settings.setupDone) setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings?.setupDone])

  if (!open || !settings) return null
  return <Steps settings={settings} onClose={() => setOpen(false)} />
}

function Steps({ settings, onClose }: { settings: AppSettings; onClose: () => void }): JSX.Element {
  const t = useT()
  const save = useStore((s) => s.saveSettings)
  const systemAccent = useStore((s) => s.appInfo?.systemAccent)
  const [step, setStep] = useState(0)
  const at: SetupStep = SETUP_STEPS[step]
  const last = step === SETUP_STEPS.length - 1

  const finish = (): void => {
    if (!settings.setupDone) void save({ setupDone: true })
    onClose()
  }
  const next = (): void => (last ? finish() : setStep(step + 1))

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) void save({ downloadDir: dir })
  }

  // "System" only where the desktop answered: GNOME 46's portal has no accent key (E2).
  const accents: AccentChoice[] = systemAccent ? [...ACCENTS, 'system'] : [...ACCENTS]

  const TITLES: Record<SetupStep, [string, string]> = {
    folder: [t('setup.folderTitle'), t('setup.folderBody')],
    cookies: [t('setup.cookiesTitle'), t('setup.cookiesBody')],
    look: [t('setup.lookTitle'), t('setup.lookBody')]
  }

  return (
    <Dialog
      size="md"
      title={TITLES[at][0]}
      description={TITLES[at][1]}
      onClose={finish}
      actions={
        <>
          {step > 0 ? (
            <button type="button" className="btn-quiet" onClick={() => setStep(step - 1)}>
              {t('setup.back')}
            </button>
          ) : (
            <button type="button" className="btn-quiet" onClick={finish}>
              {t('setup.skipAll')}
            </button>
          )}
          {!last && (
            <button type="button" className="btn-quiet" onClick={next} data-uvd="setup-skip">
              {t('setup.skip')}
            </button>
          )}
          <button type="button" className="btn-solid" onClick={next} data-uvd="setup-next">
            {last ? t('setup.done') : t('setup.next')}
          </button>
        </>
      }
    >
      <p className="mb-4 text-center text-meta text-ink-2" aria-live="polite">
        {t('setup.stepOf', { step: step + 1, count: SETUP_STEPS.length })}
      </p>
      {at === 'folder' && (
        <PreferencesGroup>
          <ActionRow
            title={t('home.saveTo')}
            subtitle={settings.downloadDir}
            monoSubtitle
            suffix={
              <button type="button" className="btn-quiet" onClick={() => void chooseDir()}>
                <Folder size={14} /> {t('common.change')}
              </button>
            }
          />
        </PreferencesGroup>
      )}
      {at === 'cookies' && (
        <PreferencesGroup>
          <ComboRow
            title={t('prefs.row.cookiesFrom')}
            value={settings.cookiesFromBrowser}
            onChange={(v) => void save({ cookiesFromBrowser: v })}
            options={[
              { value: '', label: t('prefs.value.none') },
              ...SUPPORTED_COOKIE_BROWSERS.map((b) => ({ value: b, label: b.charAt(0).toUpperCase() + b.slice(1) }))
            ]}
          />
        </PreferencesGroup>
      )}
      {at === 'look' && (
        <div className="space-y-6">
          <PreferencesGroup>
            <SwitchRow
              title={t('setup.notifications')}
              subtitle={t('setup.notificationsHint')}
              checked={settings.notifications}
              onChange={(v) => void save({ notifications: v })}
            />
          </PreferencesGroup>
          <PreferencesGroup title={t('prefs.group.style')}>
            <div className="px-3 py-5">
              <StyleTiles
                label={t('prefs.group.style')}
                value={settings.theme as TileStyle}
                onChange={(v) => void save({ theme: v as ThemeId })}
                options={[
                  { value: 'day', label: t('prefs.style.day') },
                  { value: 'night', label: t('prefs.style.night') },
                  { value: 'system', label: t('prefs.style.system') }
                ]}
              />
            </div>
          </PreferencesGroup>
          <PreferencesGroup title={t('prefs.group.accent')}>
            <div className="px-4 py-4">
              <AccentSwatches
                label={t('prefs.group.accent')}
                value={settings.accent}
                onChange={(v) => void save({ accent: v as AccentChoice })}
                options={accents.map((a) => ({ value: a, label: t(ACCENT_LABEL[a]) }))}
              />
            </div>
          </PreferencesGroup>
        </div>
      )}
    </Dialog>
  )
}
