import { describe, expect, it } from 'vitest'
import { engineFailureText, proxyMayBeWhy } from './engineError'

const t = ((key: string) => key) as never

describe('a failure with a proxy set', () => {
  it('names the proxy when the engine could not be fetched', () => {
    expect(engineFailureText(t, 'Failed to download yt-dlp (HTTP 407)', 'setup', 'http://192.168.1.10:3128')).toBe('engine.proxyFailed')
    expect(engineFailureText(t, 'net::ERR_PROXY_CONNECTION_FAILED', 'update', 'http://192.168.1.10:3128')).toBe('engine.proxyFailed')
    expect(proxyMayBeWhy('net::ERR_PROXY_CONNECTION_FAILED', 'http://192.168.1.10:3128')).toBe(true)
  })

  it('does not blame it for what no proxy could cause, or when there is none', () => {
    expect(engineFailureText(t, 'yt-dlp failed to start', 'setup', 'http://192.168.1.10:3128')).toBe('engine.startFailed')
    expect(proxyMayBeWhy('yt-dlp failed to start', 'http://192.168.1.10:3128')).toBe(false)
    expect(proxyMayBeWhy('No download engine is published for this system.', 'http://192.168.1.10:3128')).toBe(false)
    expect(proxyMayBeWhy('Failed to download yt-dlp (HTTP 407)', '  ')).toBe(false)
    expect(engineFailureText(t, 'Failed to download yt-dlp (HTTP 407)', 'setup', '')).toBe('engine.setupFailed')
  })
})

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
