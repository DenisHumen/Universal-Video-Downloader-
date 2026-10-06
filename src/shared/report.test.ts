import { describe, expect, it, vi } from 'vitest'
import type { AppErrorCode } from './types'
import {
  MAILTO_MAX,
  REPORT_TARGET,
  buildMailto,
  buildReport,
  createRateLimiter,
  formSubmitBody,
  isReportMailto,
  isReportable,
  isUnsupportedSite,
  outputTail,
  postReport,
  proxyCredentials,
  reportAnswerKey,
  reportHost,
  scrubText,
  type FailureContext,
  type FetchLike,
  type ReportEnv
} from './report'

/*
  A report leaves the machine, so most of what is tested here is what it must
  not carry. Every case below is a shape that really turns up in engine output
  on somebody's computer.
*/

const HOME = 'C:\\Users\\denis'

function env(overrides: Partial<ReportEnv> = {}): ReportEnv {
  return {
    appVersion: '3.20.0',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.26200',
    electron: '33.2.1',
    ytdlp: '2026.09.01',
    ffmpeg: '9.0.2',
    language: 'ru',
    scrub: {
      homeDir: HOME,
      userName: 'denis',
      cookiesFile: 'D:\\secret stuff\\my-cookies.txt',
      proxy: 'http://bob:hunter2@proxy.local:8080',
      secrets: ['smb-pass-123', '1234567890:FAKEfakeFAKEfakeFAKEfakeFAKEfake123']
    },
    ...overrides
  }
}

function context(overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    stage: 'download',
    url: 'https://www.example.com/watch?v=abc',
    message: 'Post-processing failed - the video downloaded but could not be merged or converted.',
    errorCode: 'postprocess',
    kind: 'download',
    mode: 'video',
    quality: '1080',
    flags: { cookies: true, proxy: true, customTemplate: false },
    at: Date.UTC(2026, 9, 5, 12, 0, 0),
    ...overrides
  }
}

describe('isReportable', () => {
  // The user's environment or the site's policy: nothing for the developer to add.
  const silent: AppErrorCode[] = [
    'canceled',
    'diskFull',
    'permission',
    'network',
    'timeout',
    'rateLimited',
    'geo',
    'ageRestricted',
    'signIn',
    'drm',
    'unavailable',
    'sourceMissing'
  ]
  const asks: AppErrorCode[] = [
    'noFormats',
    'emptyPage',
    'postprocess',
    'cutFailed',
    'damagedSource',
    'streamGone',
    'corruptLink',
    'forbidden',
    'unknownEncoder',
    'noAudioTrack',
    'ffmpegMissing'
  ]

  it.each(silent)('stays quiet for %s', (code) => {
    expect(isReportable(code)).toBe(false)
  })

  it.each(asks)('offers a report for %s', (code) => {
    expect(isReportable(code)).toBe(true)
  })

  it('offers a report for an error no rule recognised', () => {
    // The failure the developer has never seen is the most useful one.
    expect(isReportable(undefined)).toBe(true)
  })
})

describe('isUnsupportedSite', () => {
  it('reads a missing format or an empty page as an unsupported site', () => {
    expect(isUnsupportedSite('detect', 'noFormats')).toBe(true)
    expect(isUnsupportedSite('download', 'emptyPage')).toBe(true)
  })

  it('reads an unclassified detection failure as one too, but not a download', () => {
    expect(isUnsupportedSite('detect', undefined)).toBe(true)
    expect(isUnsupportedSite('download', undefined)).toBe(false)
    expect(isUnsupportedSite('detect', 'postprocess')).toBe(false)
  })
})

describe('reportHost', () => {
  it('names the site without its www', () => {
    expect(reportHost('https://www.example.com/a?b=c')).toBe('example.com')
    expect(reportHost('http://video.site.org/x')).toBe('video.site.org')
  })

  it('names an internal address by its scheme, and gives up on garbage', () => {
    expect(reportHost('uvd-rezka://123/456')).toBe('uvd-rezka')
    expect(reportHost('not a url')).toBe('')
  })

  it('names the site of a link pasted without https://', () => {
    expect(reportHost('example.com/video/1')).toBe('example.com')
    expect(reportHost('www.example.com/video/1')).toBe('example.com')
  })
})

describe('reportAnswerKey', () => {
  // Home passes the link as typed; the queue passes the one main normalised.
  it('is the same for one site however the link was written', () => {
    expect(reportAnswerKey('example.com/a', 'noFormats')).toBe(
      reportAnswerKey('https://www.example.com/b', 'noFormats')
    )
    expect(reportAnswerKey('example.com/a')).toBe('example.com|unclassified')
  })

  it('keeps different errors from one site apart', () => {
    expect(reportAnswerKey('example.com/a', 'noFormats')).not.toBe(
      reportAnswerKey('example.com/a', 'postprocess')
    )
  })
})

describe('buildReport — subject', () => {
  it('calls an unclassified detection failure an unsupported site', () => {
    const report = buildReport(
      context({ stage: 'detect', errorCode: undefined, kind: undefined, mode: undefined }),
      env()
    )
    expect(report.subject).toBe('[UVD 3.20.0] unsupported site: example.com')
  })

  it('calls noFormats an unsupported site at either stage', () => {
    expect(buildReport(context({ errorCode: 'noFormats' }), env()).subject).toBe(
      '[UVD 3.20.0] unsupported site: example.com'
    )
  })

  it('names the stage and the code for everything else', () => {
    expect(buildReport(context(), env()).subject).toBe(
      '[UVD 3.20.0] download failed: example.com (postprocess)'
    )
    expect(buildReport(context({ stage: 'detect', errorCode: 'forbidden' }), env()).subject).toBe(
      '[UVD 3.20.0] detection failed: example.com (forbidden)'
    )
    expect(buildReport(context({ errorCode: undefined }), env()).subject).toBe(
      '[UVD 3.20.0] download failed: example.com (unclassified)'
    )
  })

  it('names a local trim job without inventing a site for it', () => {
    const report = buildReport(
      context({ kind: 'trim', local: true, url: `${HOME}\\Videos\\clip.mp4`, errorCode: 'cutFailed' }),
      env()
    )
    expect(report.subject).toBe('[UVD 3.20.0] trim failed: local file (cutFailed)')
    expect(report.fields.link).toBe('~\\Videos\\clip.mp4')
  })
})

describe('buildReport — contents', () => {
  it('carries everything needed to add a site', () => {
    const report = buildReport(
      context({
        resolvedUrl: 'https://cdn.example.com/v.m3u8',
        extractor: 'Example',
        title: 'A video',
        rawError: 'ERROR: Postprocessing: Conversion failed!',
        engineOutput: '[download] 100%\nERROR: Postprocessing: Conversion failed!',
        range: { start: 30, end: 105 }
      }),
      env()
    )
    const f = report.fields
    expect(f['what failed']).toBe('download · video · quality 1080 · trim 0:30–1:45')
    expect(f.site).toBe('example.com')
    expect(f.link).toBe('https://www.example.com/watch?v=abc')
    expect(f['resolved link']).toBe('https://cdn.example.com/v.m3u8')
    expect(f.extractor).toBe('Example')
    expect(f.title).toBe('A video')
    expect(f['error code']).toBe('postprocess')
    expect(f.message).toContain('Post-processing failed')
    expect(f['raw error']).toBe('ERROR: Postprocessing: Conversion failed!')
    expect(f.app).toBe('3.20.0')
    expect(f.system).toBe('win32 x64 10.0.26200')
    expect(f.electron).toBe('33.2.1')
    expect(f['yt-dlp']).toBe('2026.09.01')
    expect(f.ffmpeg).toBe('9.0.2')
    expect(f.language).toBe('ru')
    expect(f.time).toBe('2026-10-05T12:00:00.000Z')
    expect(f.settings).toBe('cookies on · proxy on · custom filename template off')
    expect(f['engine output']).toContain('Conversion failed')
  })

  it('says what detection tried, from the trace alone', () => {
    const report = buildReport(
      context({
        stage: 'detect',
        errorCode: undefined,
        detection: { universal: { browserAllowed: false, stages: ['scraping'] } }
      }),
      env()
    )
    expect(report.fields['what failed']).toBe('detection')
    expect(report.fields.detection).toBe(
      'built-in resolver: none · universal detection: page scan (hidden browser off in settings), found nothing'
    )
  })

  it('keeps the plain text and the form fields in step', () => {
    const report = buildReport(context({ engineOutput: 'line one\nline two' }), env())
    for (const [name, value] of Object.entries(report.fields)) {
      expect(report.text).toContain(value.includes('\n') ? `${name}:\n${value}` : `${name}: ${value}`)
    }
  })

  it('reports settings as switches, never as their values', () => {
    const report = buildReport(context(), env())
    expect(report.text).not.toContain('proxy.local')
    expect(report.text).not.toContain('my-cookies')
  })
})

describe('buildReport — privacy', () => {
  const noisy = [
    `[debug] Loading cookies from "${HOME}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Network\\Cookies"`,
    '[debug] cookie file: D:\\secret stuff\\my-cookies.txt',
    '[debug] Proxy map: {"all": "http://bob:hunter2@proxy.local:8080"}',
    `ERROR: unable to write C:\\Users\\DENISH~1\\AppData\\Local\\Temp\\x.part`,
    `[download] Destination: ${HOME.replace(/\\/g, '/')}/Downloads/video.mp4`,
    '[smb] login with smb-pass-123',
    'POST api.telegram.org/bot1234567890:FAKEfakeFAKEfakeFAKEfakeFAKEfake123/sendMessage',
    'Cookie: session=abc123secret'
  ].join('\n')

  const report = buildReport(context({ engineOutput: noisy, rawError: noisy }), env())

  it('replaces the home directory and the user name with ~', () => {
    expect(report.text).not.toMatch(/denis/i)
    expect(report.text).toContain('~/Downloads/video.mp4')
    // The 8.3 short form os.homedir() never spells.
    expect(report.text).not.toContain('DENISH~1')
  })

  it('strips proxy credentials', () => {
    expect(report.text).not.toContain('hunter2')
    expect(report.text).not.toContain('bob:')
    expect(report.text).toContain('http://proxy.local:8080')
  })

  it('never leaks a cookie path, whichever one', () => {
    expect(report.text).not.toContain('my-cookies')
    expect(report.text).not.toContain('Network\\Cookies')
    expect(report.text).toContain('<cookies file>')
    expect(report.text).not.toContain('abc123secret')
  })

  it('removes stored passwords and the bot token', () => {
    expect(report.text).not.toContain('smb-pass-123')
    expect(report.text).not.toContain('FAKEfakeFAKE')
  })

  it('leaves the link itself whole — it is the point of the report', () => {
    const signed = 'https://example.com/v?id=1&token=abc&key=xyz'
    expect(buildReport(context({ url: signed }), env()).fields.link).toBe(signed)
  })

  it('takes a password out of the link, though', () => {
    const link = buildReport(context({ url: 'https://u:p4ss@example.com/v' }), env()).fields.link
    expect(link).toBe('https://example.com/v')
  })

  /*
    yt-dlp prints a cookies.txt line it cannot parse whole, value included, as
    its repr. Tabs turned into spaces by a copy-paste make every line one field
    long; a value with a tab in it makes one eight fields long.
  */
  it('never carries a cookies.txt line the engine quoted back', () => {
    const output = [
      '[debug] Command-line config: [...]',
      "WARNING: skipping cookie file entry due to invalid length 1: '.youtube.com    TRUE    /    TRUE    1767225600    SID    g.a000kQh2-SECRETSESSIONVALUE\\n'",
      "WARNING: skipping cookie file entry due to invalid length 8: '.youtube.com\\tTRUE\\t/\\tTRUE\\t1767225600\\tHSID\\tTABBED\\tSECRETVALUETWO\\n'",
      'ERROR: Unsupported URL: https://example.com/page/12'
    ].join('\n')
    const report = buildReport(
      context({ stage: 'detect', errorCode: undefined, rawError: output, engineOutput: output }),
      env()
    )
    for (const field of [report.fields['raw error'], report.fields['engine output'], report.text]) {
      expect(field).not.toContain('SECRETSESSIONVALUE')
      expect(field).not.toContain('SECRETVALUETWO')
      expect(field).not.toContain('youtube.com')
    }
    expect(report.fields['engine output']).toContain('skipping cookie file entry (contents removed)')
    // The line that matters survives the cleaning.
    expect(report.fields['engine output']).toContain('Unsupported URL: https://example.com/page/12')
  })

  it('removes a raw Netscape cookie line, whatever separates its fields', () => {
    const tabs = '.site.com\tTRUE\t/\tFALSE\t0\tsession\tRAWSECRET1'
    const spaces = '#HttpOnly_.site.com  TRUE  /  TRUE  1767225600  token  RAWSECRET2'
    const out = scrubText(`${tabs}\n${spaces}\n[info] done`, {})
    expect(out).not.toContain('RAWSECRET')
    expect(out).toContain('[info] done')
  })

  it('caps long engine output to its last lines', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
    const out = buildReport(context({ engineOutput: long }), env()).fields['engine output']
    expect(out.length).toBeLessThanOrEqual(6000)
    expect(out).toContain('line 499')
    expect(out).not.toContain('line 400 ')
    expect(out.split('\n').length).toBeLessThanOrEqual(61)
  })
})

describe('scrubText', () => {
  it('does not mistake a web address for a home directory', () => {
    const s = { homeDir: '/home/ann', userName: 'ann' }
    expect(scrubText('see https://site.com/home/videos/1', s)).toBe('see https://site.com/home/videos/1')
    expect(scrubText('saved to /home/ann/x.mp4', s)).toBe('saved to ~/x.mp4')
  })

  it('does not turn YouTube /user/ links into /~/ for an account called user', () => {
    const s = { homeDir: 'C:\\Users\\user', userName: 'user' }
    expect(scrubText('https://www.youtube.com/user/someone', s)).toBe('https://www.youtube.com/user/someone')
    expect(scrubText('D:\\Profiles\\user\\x.txt', s)).toBe('D:\\Profiles\\~\\x.txt')
  })

  it('leaves yt-dlp’s advice about cookies alone', () => {
    const advice =
      "Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp for how to manually pass cookies. You're welcome, it's fine"
    expect(scrubText(advice, {})).toBe(advice)
  })

  it('does not touch C:\\Users\\Public, where the engine itself lives', () => {
    const path = 'C:\\Users\\Public\\UniversalVideoDownloader\\bin\\yt-dlp.exe'
    expect(scrubText(path, { homeDir: HOME })).toBe(path)
  })

  it('is safe with a home directory of /', () => {
    expect(scrubText('/usr/bin/ffmpeg', { homeDir: '/' })).toBe('/usr/bin/ffmpeg')
  })

  /*
    On Windows the engine reports a file error through Python's repr, which
    doubles every backslash: `[Errno 2] No such file or directory: 'C:\\Users\\...'`.
  */
  describe('paths as a repr spells them', () => {
    it('finds the cookies file with its backslashes doubled', () => {
      const s = { homeDir: HOME, userName: 'denis', cookiesFile: 'C:\\Users\\denis\\Documents\\yt.txt' }
      expect(
        scrubText("[Errno 2] No such file or directory: 'C:\\\\Users\\\\denis\\\\Documents\\\\yt.txt'", s)
      ).toBe("[Errno 2] No such file or directory: '<cookies file>'")
      expect(scrubText("open 'D:\\\\keys\\\\yt.txt'", { cookiesFile: 'D:\\keys\\yt.txt' })).toBe(
        "open '<cookies file>'"
      )
    })

    it('finds the home folder, and a profile folder named user.DOMAIN', () => {
      const s = { homeDir: 'C:\\Users\\denis.CORP', userName: 'denis' }
      const line =
        "[WinError 32] The process cannot access the file because it is being used by another process: 'C:\\\\Users\\\\denis.CORP\\\\Downloads\\\\x.mp4'"
      expect(scrubText(line, s)).toBe(
        "[WinError 32] The process cannot access the file because it is being used by another process: '~\\\\Downloads\\\\x.mp4'"
      )
      // Another account's folder, spelled the same way.
      expect(scrubText("'C:\\\\Users\\\\other.CORP\\\\x.mp4'", {})).toBe("'~\\\\x.mp4'")
    })
  })

  it('takes a user name with a space in it whole', () => {
    const s = { homeDir: 'C:\\Users\\Denis Humen', userName: 'Denis Humen' }
    expect(scrubText("'C:\\\\Users\\\\Denis Humen\\\\Downloads\\\\a?b.mp4'", s)).toBe(
      "'~\\\\Downloads\\\\a?b.mp4'"
    )
    expect(scrubText('saved D:\\Denis Humen\\Videos\\x.mp4', s)).toBe('saved D:\\~\\Videos\\x.mp4')
    // Somebody else's profile, with no home directory to match it against.
    expect(scrubText('C:\\Users\\Anna Maria\\Videos\\x.mp4', {})).toBe('~\\Videos\\x.mp4')
    // Two profiles on one line: the first must not run on into the second.
    expect(scrubText('from C:\\Users\\bob and C:\\Users\\ann\\x.mp4', {})).toBe('from ~ and ~\\x.mp4')
  })

  it('finds a profile folder behind ffmpeg’s file: prefix, short name included', () => {
    expect(scrubText("Output #0, mp4, to 'file:C:\\Users\\DENIS~1\\Videos\\x.mp4':", {})).toBe(
      "Output #0, mp4, to 'file:~\\Videos\\x.mp4':"
    )
    expect(scrubText('file:///C:/Users/DENIS~1/x.mp4', {})).toBe('file:///~/x.mp4')
  })

  it('still leaves the same words in a web address alone', () => {
    const s = { homeDir: 'C:\\Users\\Denis Humen', userName: 'Denis Humen' }
    const link = 'https://site.com/Users/Denis Humen'
    expect(scrubText(link, s)).toBe(link)
  })
})

describe('proxyCredentials', () => {
  it('finds credentials with or without a scheme', () => {
    expect(proxyCredentials('http://bob:hunter2@p:8080')).toEqual(['bob:hunter2', 'hunter2'])
    expect(proxyCredentials('bob:hunter2@p:8080')).toEqual(['bob:hunter2', 'hunter2'])
    expect(proxyCredentials('http=a:b1234@p:80;https=c:d5678@q:443')).toEqual([
      'a:b1234',
      'b1234',
      'c:d5678',
      'd5678'
    ])
  })

  it('finds nothing in a proxy without them', () => {
    expect(proxyCredentials('http://proxy:8080')).toEqual([])
    expect(proxyCredentials('')).toEqual([])
  })
})

describe('outputTail', () => {
  it('keeps short output as it is', () => {
    expect(outputTail('a\nb\n\n')).toBe('a\nb')
  })

  it('splits ffmpeg’s carriage-return status lines', () => {
    expect(outputTail('frame=1\rframe=2\rerror', 2)).toBe('[… earlier output omitted]\nframe=2\nerror')
  })

  it('never opens on half a line, and never exceeds the cap', () => {
    const out = outputTail(`${'a'.repeat(100)}\n${'b'.repeat(100)}`, 60, 150)
    expect(out.length).toBeLessThanOrEqual(150)
    expect(out).toBe(`[… earlier output omitted]\n${'b'.repeat(100)}`)
  })
})

describe('createRateLimiter', () => {
  it('refuses the sixth report inside an hour', () => {
    let now = 0
    const limiter = createRateLimiter(undefined, () => now)
    for (let i = 0; i < 5; i++) {
      expect(limiter.take()).toBe(true)
      now += 60_000
    }
    expect(limiter.take()).toBe(false)
  })

  it('slides: an hour after the first, there is room for one more', () => {
    let now = 0
    const limiter = createRateLimiter(undefined, () => now)
    // One every ten minutes: 0, 10, 20, 30, 40.
    for (let i = 0; i < 5; i++) {
      now = i * 600_000
      limiter.take()
    }
    now = 3_599_999
    expect(limiter.take()).toBe(false)
    // The report from minute 0 has left the window; the one from minute 10 has not.
    now = 3_600_000
    expect(limiter.take()).toBe(true)
    expect(limiter.take()).toBe(false)
  })

  it('stops at twenty a day however they are spread', () => {
    let now = 0
    const limiter = createRateLimiter(undefined, () => now)
    let sent = 0
    for (let hour = 0; hour < 23; hour++) {
      now = hour * 3_600_000
      while (limiter.take()) sent++
    }
    expect(sent).toBe(20)
    now = 24 * 3_600_000
    expect(limiter.take()).toBe(true)
  })
})

describe('buildMailto', () => {
  it('addresses the developer and encodes the subject and body', () => {
    const link = buildMailto('[UVD] a & b', 'line 1\nline 2 ?=&')
    expect(link.startsWith(`mailto:${REPORT_TARGET.address}?subject=`)).toBe(true)
    expect(link).toContain(encodeURIComponent('[UVD] a & b'))
    expect(link).toContain(encodeURIComponent('line 1\nline 2 ?=&'))
    expect(decodeURIComponent(link.split('&body=')[1])).toBe('line 1\nline 2 ?=&')
  })

  it('cuts a long body to fit, says so, and never goes over the cap', () => {
    const body = 'x'.repeat(10_000)
    const link = buildMailto('subject', body)
    expect(link.length).toBeLessThanOrEqual(MAILTO_MAX)
    const decoded = decodeURIComponent(link.split('&body=')[1])
    expect(decoded).toContain('shortened')
    expect(decoded.startsWith('xxxx')).toBe(true)
  })

  it('measures the encoded length, which is what Cyrillic blows up', () => {
    const body = 'видео не скачивается 🙂 '.repeat(200)
    for (const cap of [MAILTO_MAX, 600, 400]) {
      const link = buildMailto('тема', body, cap)
      expect(link.length).toBeLessThanOrEqual(cap)
      // Throws on a cut through a surrogate pair or a percent escape.
      expect(() => decodeURIComponent(link.split('&body=')[1])).not.toThrow()
    }
  })

  it('shortens a subject that alone would not fit', () => {
    const link = buildMailto('s'.repeat(3000), 'body', 500)
    expect(link.length).toBeLessThanOrEqual(500)
    expect(isReportMailto(link)).toBe(true)
  })
})

describe('isReportMailto', () => {
  it('lets through only mail to the developer', () => {
    expect(isReportMailto(buildMailto('s', 'b'))).toBe(true)
    expect(isReportMailto('mailto:someone@else.com?subject=x')).toBe(false)
    expect(isReportMailto(`mailto:${REPORT_TARGET.address}.evil.com?subject=x`)).toBe(false)
    expect(isReportMailto(`mailto:${REPORT_TARGET.address}?body=${'x'.repeat(MAILTO_MAX)}`)).toBe(false)
  })
})

describe('postReport', () => {
  const report = buildReport(context(), env())

  function reply(body: unknown, ok = true): FetchLike {
    return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  }

  it('posts flat JSON to FormSubmit with the subject and the table template', async () => {
    const fetchImpl = reply({ success: 'true' })
    await postReport(report, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(REPORT_TARGET.endpoint)
    expect(url).toBe(`https://formsubmit.co/ajax/${REPORT_TARGET.address}`)
    expect(init.method).toBe('POST')
    /*
      FormSubmit refuses a submission that names no page ("open this page
      through a web server"), and a request from main has none of its own.
    */
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Origin only: a cross-site Referer with a path is blocked by Chromium before it leaves.
      Referer: 'https://github.com/'
    })
    const body = JSON.parse(init.body)
    expect(body).toEqual(formSubmitBody(report))
    expect(body._subject).toBe(report.subject)
    expect(body._template).toBe('table')
    expect(body._url).toBe(REPORT_TARGET.formUrl)
    expect(REPORT_TARGET.formUrl).toMatch(/^https:\/\//)
    expect(body.link).toBe('https://www.example.com/watch?v=abc')
    // Flat: FormSubmit renders one row per field and nothing nested.
    expect(Object.values(body).every((v) => typeof v === 'string')).toBe(true)
  })

  it('takes FormSubmit’s string "true" and a real true as success', async () => {
    expect(await postReport(report, reply({ success: 'true' }))).toEqual({ ok: true })
    expect(await postReport(report, reply({ success: true }))).toEqual({ ok: true })
  })

  it('treats the not-yet-activated answer as a failure the user can route around', async () => {
    const answer = {
      success: 'false',
      message: "This form needs Activation. We've sent you an email containing an 'Activate Form' link."
    }
    // FormSubmit's own words come back for the log: they are about the form, not the report.
    expect(await postReport(report, reply(answer))).toEqual({
      ok: false,
      reason: 'notActivated',
      detail: answer.message
    })
  })

  it('treats anything short of a clear yes as a no', async () => {
    expect(await postReport(report, reply({ success: 'false' }))).toEqual({ ok: false, reason: 'rejected' })
    expect(await postReport(report, reply({ success: 'true' }, false))).toEqual({
      ok: false,
      reason: 'rejected'
    })
    const notJson: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      }
    })
    expect(await postReport(report, notJson)).toEqual({ ok: false, reason: 'rejected' })
  })

  it('reports a request that never got an answer as a network failure', async () => {
    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await postReport(report, offline)).toMatchObject({ ok: false, reason: 'network' })
  })

  it('gives up on a relay that never answers', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    expect(await postReport(report, hang, 20)).toMatchObject({ ok: false, reason: 'network' })
  })
})
