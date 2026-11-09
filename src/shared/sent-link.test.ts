import { describe, expect, it } from 'vitest'
import { BOOKMARKLET, linkFromArgv, linkFromSentUrl, MAX_LINK_LENGTH, safeWebLink } from './sent-link'

const send = (url: string): string => `uvd://open?url=${encodeURIComponent(url)}`

describe('a link sent from a browser', () => {
  const longest = `https://example.com/${'a'.repeat(MAX_LINK_LENGTH - 20)}`

  it.each([
    ['the plain case', send('https://example.com/watch?v=1&t=2'), 'https://example.com/watch?v=1&t=2'],
    ['http', send('http://example.com/a'), 'http://example.com/a'],
    ['the scheme and host in capitals', `UVD://OPEN?url=${encodeURIComponent('https://example.com/')}`, 'https://example.com/'],
    ['a slash before the query', `uvd://open/?url=${encodeURIComponent('https://example.com/')}`, 'https://example.com/'],
    ['an address on the local network', send('http://192.168.1.10/video'), 'http://192.168.1.10/video'],
    ['a long link that still fits', send(longest), longest],
    ['a look-alike host, spelled so it shows', send('https://ex\u0430mple.com/'), 'https://xn--exmple-4nf.com/'],
    // Read and ignored, which is the point: none of these means anything.
    ['autostart', `${send('https://example.com/')}&download=1&autostart=true`, 'https://example.com/'],
    ['a folder', `${send('https://example.com/')}&dir=${encodeURIComponent('C:\\Windows')}`, 'https://example.com/'],
    ['cookies', `${send('https://example.com/')}&cookies=${encodeURIComponent('file:///etc/passwd')}&settings=x`, 'https://example.com/']
  ])('accepts %s', (_name, sent, link) => {
    expect(linkFromSentUrl(sent)).toBe(link)
  })

  it.each([
    ['nothing', ''],
    ['no url', 'uvd://open'],
    ['an empty url', 'uvd://open?url='],
    ['another action', send('https://example.com/').replace('open', 'download')],
    ['a path', `uvd://open/download?url=${encodeURIComponent('https://example.com/')}`],
    ['no host', `uvd:open?url=${encodeURIComponent('https://example.com/')}`],
    ['a port', `uvd://open:80?url=${encodeURIComponent('https://example.com/')}`],
    ['a user name', `uvd://me@open?url=${encodeURIComponent('https://example.com/')}`],
    ['a look-alike scheme outside', `uvd-x://open?url=${encodeURIComponent('https://example.com/')}`],
    ['file', send('file:///etc/passwd')],
    ['file on Windows', send('file:///C:/Windows/win.ini')],
    ['file, encoded twice', `uvd://open?url=${encodeURIComponent(encodeURIComponent('file:///etc/passwd'))}`],
    ['javascript', send('javascript:alert(1)')],
    ['data', send('data:text/html,<script>alert(1)</script>')],
    ['blob', send('blob:https://example.com/1')],
    ['about', send('about:blank')],
    ['view-source', send('view-source:https://example.com/')],
    ['ftp', send('ftp://example.com/a')],
    ['a queue address', send('uvd-kodik://abc/1/720')],
    ['another queue address', send('uvd-anilib://abc/1/720')],
    ['itself', send(send('https://example.com/'))],
    ['a Windows path', send('C:\\Windows\\System32\\calc.exe')],
    ['a network path', send('\\\\192.168.1.10\\share')],
    ['a switch', send('--gpu-launcher=calc.exe')],
    ['https with no slashes', send('https:example.com')],
    ['no host inside', send('https://')],
    ['two answers, good first', `${send('https://example.com/')}&url=${encodeURIComponent('file:///etc/passwd')}`],
    ['two answers, good last', `uvd://open?url=${encodeURIComponent('file:///etc/passwd')}&url=${encodeURIComponent('https://example.com/')}`],
    ['a user name inside', send('https://bank.example@example.com/')],
    ['a password inside', send('https://me:secret@example.com/')],
    ['a newline, encoded', send('https://example.com/\nX-Evil: 1')],
    ['a newline, raw', 'uvd://open?url=https://example.com/\n'],
    ['a tab, raw, which URL would drop', 'uvd://open?url=htt\tps://example.com/'],
    ['a NUL', send('https://example.com/\0')],
    ['DEL', send('https://example.com/\x7f')],
    ['a space', send('https://example.com/a b')],
    ['a plus, read as a space', 'uvd://open?url=https://example.com/a+b'],
    ['a backslash', send('https://example.com\\@another.example/')],
    ['right-to-left text', send('https://example.com/\u202Egnp.exe')],
    ['a zero-width space', send('https://exam\u200Bple.com/')],
    ['a broken escape', 'uvd://open?url=https://example.com/%E0%A4%A'],
    ['one character over the limit', send(`${longest}a`)],
    ['a megabyte', send(`https://example.com/${'a'.repeat(1 << 20)}`)],
    ['a megabyte of parameters', `${send('https://example.com/')}&x=${'a'.repeat(1 << 20)}`]
  ])('refuses %s', (_name, sent) => {
    expect(linkFromSentUrl(sent)).toBeNull()
    expect(linkFromArgv([sent]).link).toBeUndefined()
  })

  it('does not take another scheme for its own', () => {
    expect(linkFromSentUrl(`https://open?url=${encodeURIComponent('https://example.com/')}`)).toBeNull()
  })
})

describe('the same rules for a plain link on the command line', () => {
  it.each([
    ['file:///etc/passwd'],
    ['https://example.com/\n'],
    ['https://me@example.com/'],
    [`https://example.com/${'a'.repeat(MAX_LINK_LENGTH)}`]
  ])('refuses %s', (link) => {
    expect(safeWebLink(link)).toBeNull()
  })
})

describe('the link on a command line', () => {
  const good = send('https://example.com/v')

  it('finds it among switches', () => {
    expect(linkFromArgv(['app', '--ozone-platform=x11', '--no-sandbox', good])).toEqual({ link: 'https://example.com/v', refused: false })
  })

  it('still takes the "open with" link it always did', () => {
    expect(linkFromArgv(['app', 'https://example.com/v'])).toEqual({ link: 'https://example.com/v', refused: false })
  })

  it('has nothing to say about an ordinary launch', () => {
    expect(linkFromArgv(['app', '--hidden', 'C:\\some\\file.mp4'])).toEqual({ refused: false })
  })

  it('takes the first good one, past what is not a link at all or a plain link that is no good', () => {
    const list = ['app', '--cli', '--gpu-launcher=calc.exe', 'javascript:alert(1)', 'https://me@example.com/', good, 'https://example.com/later']
    expect(linkFromArgv(list)).toEqual({ link: 'https://example.com/v', refused: false })
  })

  it('takes nothing from a list with one bad uvd: link in it, wherever it stands', () => {
    const bad = send('file:///etc/passwd')
    expect(linkFromArgv(['app', bad, 'https://example.com/v'])).toEqual({ refused: true })
    expect(linkFromArgv(['app', 'https://example.com/v', bad])).toEqual({ refused: true })
    expect(linkFromArgv(['app', good, 'uvd://x', '--cli'])).toEqual({ refused: true })
  })

  it('says when every attempt was refused, so a second launch can stay quiet', () => {
    expect(linkFromArgv(['app', send('file:///etc/passwd'), 'uvd://evil'])).toEqual({ refused: true })
  })
})

describe('the bookmarklet', () => {
  it('sends the page it runs on, in the form the app reads, and nothing else', () => {
    const location = { href: 'https://example.com/watch?v=1&t=2#x' }
    new Function('location', BOOKMARKLET.replace(/^javascript:/, ''))(location)
    expect(linkFromSentUrl(location.href)).toBe('https://example.com/watch?v=1&t=2#x')
  })
})
