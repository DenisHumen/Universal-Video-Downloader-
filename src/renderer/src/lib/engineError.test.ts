import { describe, expect, it } from 'vitest'
import { engineFailureText } from './engineError'

const t = ((key: string) => key) as never

describe('engineFailureText', () => {
  // What ytdlp.ts throws, word for word.
  it('sends an engine that will not start to the antivirus, not the internet', () => {
    for (const raw of [
      'The download engine was installed but failed to start on this system.',
      'The onedir engine was unpacked but failed to start on this system.'
    ]) {
      expect(engineFailureText(t, raw, 'setup')).toBe('engine.startFailed')
      expect(engineFailureText(t, raw, 'update')).toBe('engine.startFailed')
    }
  })

  it('says when there is no build for this system', () => {
    expect(engineFailureText(t, 'No download engine is published for this system.', 'setup')).toBe('engine.noBuild')
  })

  it('says an update is waiting after a failed attempt', () => {
    expect(engineFailureText(t, 'The engine update is waiting after a failed attempt.', 'update')).toBe(
      'engine.updateWaiting'
    )
  })

  it('gives an update a reason when the connection is why', () => {
    expect(engineFailureText(t, 'Failed to download yt-dlp (HTTP 503)', 'update')).toBe('engine.updateNoConnection')
    expect(engineFailureText(t, 'net::ERR_INTERNET_DISCONNECTED', 'update')).toBe('engine.updateNoConnection')
  })

  it('falls back to the plain line for each, never the raw text', () => {
    expect(engineFailureText(t, 'Something new', 'update')).toBe('settings.engineFailed')
    expect(engineFailureText(t, undefined, 'update')).toBe('settings.engineFailed')
    expect(engineFailureText(t, 'Failed to download yt-dlp (HTTP 503)', 'setup')).toBe('engine.setupFailed')
  })
})
