import { TELEGRAM_NO_TOKEN } from '@shared/automation'
import { LIST_CHANGED } from '@shared/channel'
import type { TranslateFn, TranslationKey } from '../i18n/translate'

/**
 * The main process's fixed sentences, in the user's language.
 *
 * Main writes these in English, and they are stored as they are: on a watch, on
 * a run's steps, in the log, in a message to Telegram. A table here rather than
 * codes across the bridge, because what a watch already has on disk is English
 * and would stay English for as long as nothing replaced it, and because a
 * sentence with a host or a file name in it needs nothing added to its shape.
 *
 * Anything not in the table is shown as written, so a remote path, a file name
 * or the engine's own words pass straight through. `mainText.test.ts` reads the
 * main process's source and fails on a sentence that has no entry.
 *
 * Main reads this table too, for what it sends to Telegram and prints in a
 * terminal, so it stays free of anything that needs a window.
 */

const EXACT: Record<string, TranslationKey> = {
  // The share
  'The server rejected that username or password.': 'main.smb.badLogin',
  'The server rejected that password.': 'main.smb.badPassword',
  'The server does not know that username.': 'main.smb.badUser',
  'That account is not allowed to write there.': 'main.smb.noWrite',
  'There is no share by that name on the server.': 'main.smb.noShare',
  'That path does not exist on the share.': 'main.smb.noPath',
  'The share does not accept that file name.': 'main.smb.badName',
  'A file with that name already exists on the share.': 'main.smb.nameTaken',
  'The share is full.': 'main.smb.full',
  'The account has used up its space on the share.': 'main.smb.quota',
  'That file is open on the server, so it cannot be replaced right now.': 'main.smb.fileOpen',
  'The server is still deleting an earlier copy of that file.': 'main.smb.deleting',
  'The share could not be reached.': 'main.smb.unreachable',
  'Enter the password again to use it with another server.': 'main.smb.otherServer',
  'This download link is corrupted — pick the video again.': 'err.corruptLink',

  // Telegram
  'Telegram did not answer in time.': 'main.telegram.noAnswer',
  'Telegram sent something that was not an answer.': 'main.telegram.badAnswer',
  'Telegram refused the message.': 'main.telegram.refused',
  'That bot token is not valid.': 'main.telegram.badToken',
  'That chat id is not one this bot can write to. Send the bot a message first.': 'main.telegram.badChat',
  'The bot has been blocked by that chat.': 'main.telegram.blocked',
  'Telegram is rate-limiting this bot: too many messages went to that chat at once.': 'main.telegram.rate',
  'Telegram is not set up.': 'main.telegram.notSetUp',
  [TELEGRAM_NO_TOKEN]: 'main.telegram.noToken',
  'Connected.': 'main.connected',

  // What a watch finds on its page
  'The translation this watch follows is no longer listed on the page.': 'main.watch.dubGone',
  'That page is not a series, channel or playlist this app can follow.': 'main.watch.notSeries',
  // What the two sentences said before lists could be followed, for a watch or a run that has one stored.
  'That page is not a series this app can follow.': 'main.watch.notSeries',
  'That is a single video, not a series, channel or playlist — there is nothing to wait for.': 'main.watch.singleVideo',
  'That is a single video, not a series — there is nothing to wait for.': 'main.watch.singleVideo',
  [LIST_CHANGED]: 'main.watch.listChanged',
  'This upload no longer says where it is. It will be found again at the next check.': 'main.watch.noUploadAddress',
  'No videos found on this page.': 'err.emptyPage',
  'This is not a link the app can open.': 'err.notALink',
  'The page no longer looks like a series.': 'main.watch.noLongerSeries',
  'The check stopped without an answer.': 'main.watch.noAnswer',
  'This series is no longer being watched.': 'main.watch.gone',
  'That episode is no longer in the history.': 'main.watch.runGone',
  'Only an episode that failed or was skipped can be tried again.': 'main.watch.cannotRetry',

  // An episode on its way through the chain
  'Paused in the queue; resume it there to continue.': 'main.run.paused',
  'Done by the earlier attempt.': 'main.run.kept',
  'Stopped: the series is no longer watched.': 'main.run.stoppedRemoved',
  'Stopped: the series was paused.': 'main.run.stoppedPaused',
  'The share this watch uploads to is no longer configured.': 'main.run.noTarget',
  'The download finished but the file is not where it should be.': 'main.run.fileMissing',
  'The downloaded file is no longer where it was saved.': 'main.run.fileGone',
  'The download was cancelled.': 'main.run.cancelled',
  'The download was removed from the queue.': 'main.run.removed',
  'The download is not in the queue.': 'main.run.notQueued',
  'The download failed.': 'main.run.failed',

  // The Russian sites' resolvers, as a check on a watch meets them
  'HDrezka answered with a bot check instead of the video.': 'err.siteBotCheck',
  'This translation requires HDrezka Premium — it can’t be downloaded.': 'err.premiumOnly',
  'HDrezka has no stream for this translation and episode.': 'err.noStream',
  'No playable stream found for this episode.': 'err.noStream',
  'No streams returned by Kodik': 'err.noStream',
  'No streams returned by Aksor': 'err.noStream',
  'AniLiberty has no stream for this episode.': 'err.noStream',
  'No downloadable streams found for this title.': 'err.noStream',
  'Episode not found in the Kodik player': 'err.noStream',
  'Episode not found in the Aksor player': 'err.noStream',
  'Episode not found on this AniLiberty release.': 'err.noStream',
  'No episodes found in this Kodik player.': 'err.noStream',
  'Kodik player params not found': 'err.playerChanged',
  'HDrezka answered with something other than its player data.': 'err.playerChanged',
  'HDrezka did not list the episodes of this translation.': 'err.playerChanged',
  'Cannot tell which HDrezka title this link is.': 'err.playerChanged',
  "AniLiberty's answer did not say which release it was.": 'err.playerChanged',
  'AniLiberty does not stream this release in your region.': 'err.geo',
  "This release has been removed from AniLiberty's player at the rights holder's request.": 'main.site.copyright',
  'This AniLiberty release has no episodes, so there is nothing to download.': 'main.site.noEpisodes',
  'This Kodik /uv/ player is not supported yet.': 'err.unsupportedPlayer',
  "This title isn't available on YummyAnime, where Shikimori links are downloaded from.": 'err.notOnYummyAnime',

  // The engine's reasons as `classifyYtdlpError` words them, which is how a followed list's check meets them.
  'YouTube is asking this computer to prove it is not a bot. That is about your network, not this video: cookies from a browser where you are signed in to YouTube get past it, or try again later or from another network.': 'err.botCheck',
  'This video requires you to be signed in.': 'err.signIn',
  'The site is rate-limiting us. Wait a minute and retry, or set a proxy in Settings → Network.': 'err.rateLimited',
  'The site refused the request.': 'err.forbidden',
  'Network problem reaching the site. Check your connection or proxy and try again.': 'err.network',
  'The site took too long to answer. Check your connection or proxy and try again.': 'err.timeout',
  'This video is private. If the author gave you access, sign in and retry.': 'err.privateVideo',
  'This video is for channel members only. If you are one, sign in and retry.': 'err.membersOnly',
  'This video is not available in your region.': 'err.geo',
  "The site's server is having trouble; it isn't you. Try again later.": 'err.serverError',
  'Could not connect to the site. Check your connection or proxy and try again.': 'err.network',
  'Detection timed out. The site may be unsupported or unreachable.': 'err.timeout',

  // The request itself
  'Request timed out': 'err.timeout',
  'Request canceled.': 'err.canceled'
}

/** Sentences that quote something: the parts captured are its parameters, in order. */
const QUOTING: [RegExp, TranslationKey, ...string[]][] = [
  [/^Could not reach (.+)\. Is it on, and on this network\?$/, 'main.smb.noServer', 'host'],
  [/^The server refused the request \(0x([0-9a-f]+)\)\.$/, 'main.smb.refused', 'code'],
  [/^Connected\. (.+) does not exist yet, and will be created\.$/, 'main.smb.connectedNew', 'folder'],
  [/^Connected\. (\d+) item\(s\) in (.+)\.$/, 'main.smb.connected', 'n', 'where'],
  [/^Connected as @(.+)\.$/, 'main.telegram.connected', 'name'],
  [/^No password is stored for "(.*)"\. Enter it again in Settings\.$/, 'main.run.noPassword', 'name'],
  [/^No way to download an episode from (.+)\.$/, 'main.watch.noProvider', 'site'],
  [/^.+ answered with a page instead of release data$/, 'err.playerChanged'],
  [/^.+ answered with no release data$/, 'err.playerChanged']
]

/*
  `describeNetError` and `describeProxyRefusal`: "Could not reach <host>: <reason>.
  <advice> (<code>)". Put back together here so the reason reads as part of a
  Russian sentence. The code stays behind: it is for a search engine or a bug
  report, and the line's tooltip and the log still have it.
*/
const UNREACHABLE = /^Could not reach (.+): ([^:]+)\. (Check [^()]+\.) \((?:ERR_[A-Z_0-9]+|HTTP 407)\)$/

const NET_REASON: Record<string, TranslationKey> = {
  'the proxy address is not in a form the app can use for its own requests': 'main.netReason.proxyForm',
  'the SOCKS proxy did not let the connection through': 'main.netReason.socks',
  'the connection was refused': 'main.netReason.refused',
  'the connection was dropped': 'main.netReason.dropped',
  'could not resolve host': 'main.netReason.noHost',
  'the network is unreachable': 'main.netReason.noNetwork',
  'the connection timed out': 'main.netReason.timedOut',
  'the proxy did not let the connection through': 'main.netReason.proxy',
  'the secure connection could not be established': 'main.netReason.secure',
  'a network error occurred': 'main.netReason.other',
  'the proxy asks for a user name and password': 'main.netReason.proxyAsks',
  'the proxy did not accept the user name and password': 'main.netReason.proxyRefused'
}

const NET_ADVICE: Record<string, TranslationKey> = {
  'Check your connection or proxy.': 'main.netAdvice.connection',
  'Check the proxy in Settings → Network.': 'main.netAdvice.proxy'
}

/** A site's bare status, which is all `http.ts` has to say about a refusal. */
function httpKey(status: number): TranslationKey {
  if (status === 429) return 'main.http.rate'
  if (status === 401 || status === 403) return 'main.http.refused'
  if (status === 404 || status === 410) return 'main.http.gone'
  return status >= 500 ? 'main.http.server' : 'main.http.other'
}

const COOKIE_ADVICE = ' Try enabling browser cookies in Settings → Access.'

/** One of main's sentences in the interface language, or the text as it came. */
export function localizeMainText(t: TranslateFn, text: string): string {
  const said = text.trim()
  // What `classifyYtdlpError` adds when no cookies are set up: the sentence is the one in the table, and so is its advice.
  if (said.endsWith(COOKIE_ADVICE)) {
    const reason = said.slice(0, -COOKIE_ADVICE.length)
    const translated = localizeMainText(t, reason)
    return translated === reason ? text : `${translated} ${t('err.cookieHint')}`
  }
  const exact = Object.prototype.hasOwnProperty.call(EXACT, said) ? EXACT[said] : undefined
  if (exact) return t(exact)

  for (const [re, key, ...names] of QUOTING) {
    const found = said.match(re)
    if (found) return t(key, Object.fromEntries(names.map((name, i) => [name, found[i + 1]])))
  }

  const net = said.match(UNREACHABLE)
  const reason = net && NET_REASON[net[2]]
  const advice = net && NET_ADVICE[net[3]]
  if (net && reason && advice) {
    return t('main.net.unreachable', { host: net[1], reason: t(reason), advice: t(advice) })
  }

  const http = said.match(/^HTTP (\d{3})$/)
  if (http) return t(httpKey(Number(http[1])), { code: http[1] })

  return text
}
