# Automation — watch a series, download it, put it somewhere, say so

The plan for the automation feature, written before the code so the code has
something to answer to. Work proceeds stage by stage down this file; each stage
names what has to be true before it counts as done.

Status of this document: **complete — every section settled, and the SMB and
Telegram choices were verified against the real share and the published limits
rather than chosen from a search result. Ready to build from.**

---

## 1. What it does

A *watch* is a series page the app keeps an eye on. On a schedule it asks the
site what episodes exist. Anything it has not handled before is new, and a new
episode runs the watch's *pipeline*: download it, rename it, put it on a remote
share, send a notification.

Fifty watches, each with its own pipeline, is the intended scale.

## 2. Decisions already taken

These were settled with the user before design began, and are not open:

| Question | Answer |
| --- | --- |
| Reaching the SMB share | The app connects itself — host, share, user, password |
| On a new episode | Download automatically, no confirmation |
| Sources for the first version | Sites with built-in resolvers only (rezka, yummyani) — but see §3: rezka is currently down |
| Running with the window closed | Yes — tray, and start with the system |

Two things follow that are worth stating plainly. Connecting to SMB ourselves
means a new runtime dependency in an app that has deliberately had only two
(`electron-updater`, `ffmpeg-static`), so the choice of library is a decision in
its own right — see §9. And automatic downloading means a bug here spends the
user's bandwidth and disk without them watching, so the scheduler's failure
behaviour matters more than its success behaviour.

## 3. What has been verified, not assumed

Run against the live site on 2026-08-25, before any of this was designed.

**The resolver works on the user's series.** `yummyaniResolvers` resolved both
`tabakoshka` and `mushoku-tensei-iii-...` to a full `StreamingInfo`: title,
poster, `isSeries`, qualities (360p/480p/720p), a translator list, and
per-translator episode lists.

**Translators have genuinely different episode counts.** For Tabakoshka the
default dub had 8 episodes while others had 5, 5, 5, 4, 3 and 2 — a fourfold
spread. This is the single most important finding for the design:

> A watch must compare against `episodesByTranslator[chosenTranslator]`, never
> the top-level `seasons`. Comparing against the top-level list would tell a
> user who picked a dub with 2 episodes that 6 more are "new", and produce six
> failed downloads for episodes that do not exist for their choice.

**A specific episode resolves to a real stream.** `uvd-yummy://<tid>/<ep>/<q>`
returned a playable CDN URL with the right Referer for both the newest and the
first episode.

**Asking for an episode that does not exist fails cleanly**, with
`Episode not found in the Kodik player` — a distinct, recognisable error rather
than a hang or a bad URL. A scheduler needs to tell "not out yet" from "the site
broke", and that distinction already exists.

**Titles come back in Russian** (`Табакошка`). This is exactly the case the
rename module's text replacement is for.

**The internal URL has no season component** for yummyani:
`uvd-yummy://<translatorId>/<episode>/<quality>`. The translator id is itself a
base64url kodik *season* URL, so season is baked into the translator choice.
Rezka's is different — `uvd-rezka://<host>/<id>/<translatorId>/<season|movie>/<episode>/<quality>`
— so the watch model must not assume one shape.

**The test share is reachable and writable.** A file was created, read back and
removed under `\\<host>\shared\test`, which is currently empty. The credentials
themselves are *not* yet proven: Windows refused a second authenticated
connection to that server (error 1219) because one already exists from this
machine, so the write went through the existing session. A real SMB library
opens its own TCP session and is not subject to that limit — which is a point in
favour of the chosen approach, and a thing to confirm in stage 5.


**Rezka is not currently usable, and that is not this feature's doing.** Three
signals from a plain HTTP client with a real browser user-agent, across
`rezka.ag`, `hdrezka.ag` and `hdrezka.me`: every mirror answers with about 2.4 KB
where a catalogue page is hundreds; the responses carry `X-Powered-By: Express`,
while rezka itself runs nginx; and the bodies contain no title, no scripts and
none of rezka's markup. Whatever the mechanism, the site is not handing a
parseable page to the kind of request `resolvers/http.ts` makes, so the rezka
resolver is broken end to end today, independently of anything here.

Consequences for scope. The first version is verified against **yummyani**,
which is also what both of the user's links are. The model stays
provider-agnostic — nothing assumes yummyani's URL shape, and §3 already notes
that rezka's differs — so rezka slots back in when it works. One thing to know
when it does: rezka never populates `episodesByTranslator`, so the
per-translator comparison that yummyani needs has no data behind it there yet.

### What a check costs

Worth knowing before choosing a default interval, because this runs unattended
against someone else's server:

- yummyani: **3 GETs** per check from the page URL, or 2 from `uvd-yummy-item://<id>`
- rezka: **1 GET** per check
- downloading one episode adds 1 GET + 1 POST (yummyani) or 1 POST (rezka)

yummyani's `/videos` response also carries a `video_id` and a `date` per entry
that the current `YaniVideo` interface discards. Those are a cheaper and more
reliable change detector than comparing episode-number lists, and picking them
up is a small change to an existing type.

## 4. Data model

Lives in `src/shared/automation.ts` so main and renderer share one definition.

```
Watch
  id, url, title, thumbnail          title and thumbnail auto-filled on first check
  provider     rezka | yummyani
  translatorId, quality              the user's choice, fixed per watch
  enabled
  intervalMinutes, nextCheckAt       absolute wall-clock, not an elapsed timer
  lastCheckedAt, lastError, failures backoff state
  seen: EpisodeKey[]                 "s1e4" — pairs, not a high-water mark
  steps: PipelineStep[]
  createdAt
```

`nextCheckAt` is an absolute timestamp on purpose. A `setInterval` of six hours
does not survive a laptop sleeping for four of them; a stored due-time compared
against the wall clock does.

`seen` is a set of season/episode pairs rather than "the last episode number"
because sites insert episodes retroactively, renumber, and add a translator late
whose list starts from 1. A high-water mark misses all three.

```
PipelineStep = DownloadStep | RenameStep | UploadStep | NotifyStep
  every step: id, kind, enabled

  DownloadStep   (nothing to configure — it is the head of the chain)
  RenameStep     template, replacements[{ from, to, regex? }]
  UploadStep     targetId, remotePath, createDirs, deleteLocalAfter
  NotifyStep     (uses the Telegram settings; per-step on/off only)

Run                                  one per detected episode
  id, watchId, season, episode, title
  state    running | done | failed
  steps[]  { kind, state, message, startedAt, finishedAt }
  downloadId                         links to the existing queue item
  filepath, remotePath
  startedAt, finishedAt
```

`SmbTarget` (host, share, domain, username, id, name) lives in **settings**, not
in a watch: one server serves many series. The password never appears in it —
see §5.

### Template tokens

Shared by the rename template and the remote path, so one implementation and one
set of rules:

`{title}` `{season}` `{episode}` `{season2}` `{episode2}` (zero-padded)
`{quality}` `{ext}` `{year}` `{date}`

`{title}` is the series title *after* the replacement rules have run, which is
what makes "Табакошка" → "Tabakoshka" work.

## 5. Secrets

The SMB password and the Telegram bot token are encrypted with Electron's
`safeStorage` and stored separately from `watches.json` and `settings.json`,
which stay plain JSON. Neither ever enters a log line, an IPC payload to the
renderer, or an error message. The renderer learns only whether a secret is
*set*, never its value.

This follows the same rule already applied to captured site cookies: the
renderer and the disk get a redacted view, the value stays in main.

## 6. Storage

`watches.json` in `userData`, written with the pattern `settings.ts` and the
download history already use: debounced, through a temp file and a rename, with
a migrate-on-read that tolerates a file from an older build rather than throwing
the user's list away.

Runs are kept per watch with a cap (most recent N), so a series watched for a
year does not grow without bound.

## 7. Scheduler

One timer, short interval, wall-clock comparison. Every tick it looks for
watches whose `nextCheckAt` has passed and runs at most a small number of checks
concurrently so fifty watches do not all hit a site at once.

**This pattern already exists in the codebase and should be generalised, not
reinvented.** `refreshEngineIfDue` in `services/ytdlp.ts` persists a next-due
timestamp to disk and compares it against the wall clock precisely because a
long `setInterval` does not survive a sleeping laptop. The watcher wants the
same thing with a list instead of one entry: a 60-second `setInterval` that
compares, plus a `powerMonitor` `resume` listener so waking up checks
immediately rather than waiting for the next tick.

- **Jitter** on each reschedule, so watches added together do not stay in
  lockstep for ever.
- **Backoff** on failure — the interval grows with consecutive failures up to a
  ceiling, and resets on success. A site being down must not become a hammering
  loop.
- **Minimum interval** enforced regardless of what the user types.

### Staying alive with the window closed

Not free, and not currently true. Today `trayEnabled` defaults to `false`, and
`window-all-closed` calls `app.quit()` on Windows and Linux — so closing the
window ends the process and the watcher with it. "Keep running in the
background" therefore has to be a first-class setting that *implies* the tray,
rather than something the user is expected to discover by turning two unrelated
switches on.

### Starting with the system

`app.setLoginItemSettings`, gated on `app.isPackaged`, works on Windows and
macOS. **It does nothing on Linux in Electron 33** — the implementation is an
empty function — so Linux needs a hand-written `~/.config/autostart/*.desktop`
file, which is a few lines of `fs` and no dependency. The `auto-launch` package
is not worth adding for that: it is stale and its Linux half is the same few
lines.

On macOS the Dock icon stays. `LSUIElement` would hide it permanently for
everyone, including people who never wanted a tray-only app;
`app.setActivationPolicy('accessory')` at runtime is the escape hatch if the
user ever asks for that look explicitly.

## 8. Execution

A run is a small state machine over its steps. Rules:

- **The download step drives the existing queue.** It calls `startDownload` with
  the internal `uvd-*://` URL and follows that item. Pause, cancel, retry,
  concurrency limits, partial-file cleanup and history all keep working exactly
  as they do today, because it is the same queue — there is no second downloader.
- A failed step stops that run and is recorded. Other watches are unaffected.
- A run that fails is retried on the next check, not in a tight loop.
- Everything is logged (§10).

## 9. SMB

**`node-smb2@1.3.5`.** Tested against the real share before being chosen, not
picked from a search result.

### Why that one

Queried the npm registry directly for every candidate. Three are dead: `smb2`
last published 2018, `@marsaud/smb2` 2021, `v9u-smb2` 2022. Two are alive and
are the same codebase — `@awo00/smb2` (May 2025) and `node-smb2` (October 2025),
whose README still tells you to install the other one. `node-smb2` is the more
recent, ships TypeScript declarations, and needs no native build, which keeps
electron-builder out of it.

The cost is honest: eight packages arrive where the app had two, and one of them
is `moment-timezone`, which is large and superseded. That is the price of the
decision to authenticate ourselves rather than write to a path the user has
mounted.

### The one thing that makes it work

```js
await client.authenticate({ domain: '', username, password, forceNtlmVersion: 'v2' })
```

Without `forceNtlmVersion: 'v2'` it does not work at all. Left to negotiate, the
library chooses **NTLMv1** — it announces this on stdout — and a modern server
refuses, returning `STATUS_LOGON_FAILURE` for a perfectly correct password.
Verified all three ways against the live share: `v2` authenticates, `v1` fails,
and auto-negotiation fails. Three different `domain` values made no difference.

This is also why the error message has to be worded carefully. A wrong password
and a refused authentication method produce the **same** status code, so an app
that let the library negotiate would tell users their password was wrong when it
was not. Forcing v2 is what makes "wrong username or password" an honest thing
to say.

### The upload, verified

`tree.createFileWriteStream(path)` returns a real `Writable`, so an episode is
piped from disk to the share without being read into memory. Measured: 200 MB in
9.1 seconds, about 22 MB/s, with resident memory *falling* over the transfer.
The rest of what the module needs is there — `createDirectory`, `exists`,
`renameFile`, `removeFile`, `removeDirectory`, `readDirectory`,
`createFileReadStream` — and all of it was exercised end to end against the
share: directory created, file streamed up, renamed in place, removed, directory
removed.

Upload to a temporary name and rename on success, so a share never briefly holds
a half-written episode under its final name.

### Two quirks that cost time if you do not know them

- **`readDirectory` prefixes every filename with `./`.** The entry for
  `episode.mkv` comes back as `./episode.mkv`. A "did it land?" check comparing
  bare names silently fails while the upload was in fact fine — which is exactly
  what happened during this testing. Strip the prefix.
- **Failures are thrown as raw protocol `Response` objects, not `Error`s.** No
  `message`, no `code`; the reason is a numeric status on `.header.status`,
  sometimes a BigInt. Everything from this library has to be caught and wrapped
  before it reaches the rest of the app, mapping at least `0xC000006D`
  (logon failure), `0xC00000CC` (no such share) and `0xC0000022` (access denied)
  onto sentences a person can act on. An unreachable host is distinguishable —
  it surfaces as `connect_timeout` rather than a status — which is what §8 needs.

It also writes to stdout unconditionally during authentication. That line must
not be allowed to land in the app's own log as if the app had written it.

## 10. Logging

One file, `uvd.log`, in `app.getPath('logs')` — which is `~/Library/Logs/...` on
macOS and a `logs` folder inside `userData` on Windows and Linux. Written only by
main. Hand-rolled, about 120 lines, split the way this repo already splits
testable logic: the formatting and the redaction are Electron-free and unit
tested; the stream and the rotation are not.

`electron-log` is not worth adding. It keeps one 1 MB archive, which is too
little history for something that runs overnight, and it has no redaction at
all — which is the hardest requirement here.

**Format.** One event per line, every line self-describing:

```
2026-08-25 18:32:23.386+03:00  INFO   watcher   New episode found: "Show S01E04"  id=7f3a91c2 site=yummyani
```

Local time with an explicit offset, not UTC: somebody attaching a bug report
says "it broke around six", and the offset survives a DST change mid-run.
Multi-line output — a stack trace, engine stderr — is split so **every physical
line carries the prefix**; otherwise `grep ERROR uvd.log` misses exactly the
lines that matter. Each line carries an `id=`, the first 8 characters of the
item's uuid, which is what lets one episode be followed from detection through
download, upload and notification.

Each session opens with a header naming the app version, platform, Electron and
Node versions — values `ipc.ts` already assembles for `IPC.appInfo` and
currently throws away.

**Rotation** is by size: 2 MB per file, five files, 10 MB ceiling. Date-based
rotation cannot bound the disk here — a quiet day of polling is tens of
kilobytes and one large download is tens of megabytes.

> Rotation on Windows has a trap that was reproduced on this machine under
> Electron 33's own Node: renaming a file that still has an open write stream
> **succeeds**, and the descriptor follows the renamed file. Every subsequent
> line then lands in the archive and the current log stays empty for ever — a
> failure invisible until somebody attaches a zero-byte file to a bug report.
> The stream must be closed first, then the chain renamed, then reopened, with
> lines arriving during the swap buffered.

**Redaction happens in the sink**, on the finished line, not at call sites — so
nothing can bypass it by forgetting. It covers: secret request headers (Cookie,
Set-Cookie, Authorization and friends), credentials embedded in a URL's
`user:pass@host`, Telegram bot tokens (which live in the URL *path*, so a
query-parameter rule would miss them entirely), signed-CDN query parameters, and
`key=value` or JSON fields whose key names a password, token or key.

Two details that are easy to get wrong and are therefore tests:

- The placeholder is a bare word. A bracketed one re-matches itself on a second
  pass, because the value patterns exclude the closing bracket — so redacting
  twice must be proven to equal redacting once.
- The logger never accepts an object. Its signature is
  `(subsystem, message, fields?)` with `fields` a flat record of named values,
  so there is no `log.info('config', settings)` path for a whole settings object
  — which holds the proxy string today and will hold the SMB password and bot
  token tomorrow — to slip through a denylist that never anticipated its shape.

**A gap to close in the same change.** `publicItem` strips `headers`, but
`DownloadItem.log` — the engine output tail — is not stripped, and goes into
`history.json` and out to every renderer on each update. Engine output routinely
quotes signed CDN URLs, and the header arguments the app builds are literally
`--add-header Cookie:<value>`. No secret was observed in that channel on this
machine (the history file is empty), so this is a hole rather than a proven
leak — but it is the same hole, and the same redactor closes it. It also makes
the in-app "engine output" drawer and its copy-to-clipboard button safe, which
is what users actually paste into bug reports.

**Getting at it.** The `showInFolder` channel already exists end to end. One new
channel returns the log's path, and a button in Settings → About reveals it. It
also goes in the **tray menu**: an automation user has the window closed, which
is precisely when the application menu is out of reach.

**From the renderer.** Only two callers — the error boundary and a global error
handler — over a one-way channel, not `invoke`. Every `ipcMain.handle` is
reachable from *every* webContents in the app, and this app deliberately loads
untrusted sites in one of them; a general "append to my log" handler would be a
disk-fill and log-forgery primitive handed to whatever page the user browsed to.
The channel checks the sender, clamps the level, strips control characters so a
second line cannot be forged, truncates, and rate-limits.

**Level.** Default INFO; engine stdout goes at DEBUG so an automation does not
spend its 10 MB on progress percentages. A setting flips it to DEBUG when a bug
report is being prepared.

## 11. Telegram

A plain HTTPS POST to `api.telegram.org/bot<token>/<method>` through Electron's
own `net`, the same way `resolvers/http.ts` already talks to sites. No webhook —
that is only for *receiving* updates, and this bot only speaks. No client
library.

### The notification cannot carry the episode

A bot may send files **up to 50 MB**. An episode is several hundred megabytes to
a couple of gigabytes, so the file is never the message. The notification says
what arrived and where it was put; the file is on the share, which is the whole
point of the upload step.

### Shape

`sendPhoto` with the series cover and a caption, falling back to `sendMessage`
when there is no cover or the text would not fit. The limits differ and both
matter: **1024 characters for a caption, 4096 for a message**, so the composer
has to know which one it is aiming at and truncate the title rather than have
Telegram reject the whole thing.

Suggested caption, which fits comfortably:

```
🎬 <b>Tabakoshka</b> — S01E09
<i>Озвучка РуАниме / DEEP · 720p</i>

Uploaded to <code>shared/test/Tabakoshka</code>
1.24 GB · 4 min 12 s
```

### HTML, not MarkdownV2

`parse_mode: "HTML"` needs three characters escaped — `&`, `<`, `>` — and
nothing else. MarkdownV2 needs roughly eighteen, including `.`, `-`, `!`, `(`
and `)`, every one of which turns up in ordinary series titles. A single
unescaped character makes Telegram reject the entire message, so the format with
three rules is the one that keeps working on titles nobody anticipated.

Escaping is applied to each interpolated value — title, dub name, path — never
to the assembled string, or the tags would be escaped too.

### Failures

Telegram answers with `{ "ok": false, "error_code": …, "description": … }` and a
matching HTTP status, so unlike the SMB library the reason arrives in a readable
form. Worth distinguishing for the user: a bad token, a chat id the bot has
never been spoken to, and a bot the user has blocked all mean different things
and have different fixes.

Sending happens one message at a time with a small gap. Telegram documents
roughly one message per second to a single chat; a check that finds four new
episodes at once would otherwise be a burst.

### Setup, in the settings screen

The token comes from BotFather and the chat id from the user writing to their
own bot once. Both are secrets under §5, and the token is worth calling out
twice: it sits in the **URL path**, not in a header or a query parameter, so the
redaction rule in §10 has to match it there — a rule written for query
parameters would miss every single request.

A "send a test message" button, because the first thing anyone wants to know is
whether they pasted the right thing.

## 12. UI

A two-pane screen, in the shape the user described: the list on the left, the
selected thing on the right — the same arrangement a desktop chat app uses,
because it suits "many small things, one of them open" and needs no explaining.

**Left:** watches, each a row with poster, title, and a line of state (next
check, or what it is doing now). An add button at the top.

**Right, for the selected watch:**
- a header — poster, title, dub and quality, next check, enable/disable
- what has happened — recent runs, newest first, each expandable to its steps
- the pipeline — the module tiles, vertically: `Download` first and fixed, then
  each configured module, with a `+` below the last one. Clicking a tile opens
  its settings; clicking `+` offers the modules not yet added.

It uses the existing design system — `panel`, `btn`, `field`, `label`, `hint`,
the theme tokens — and adds no new colours. `npm run check:contrast` gates the
palette and must stay green.

Both dictionaries get every string; `i18n.test.ts` fails the build on a key that
is missing or unused, in either direction.

## 13. Stages

Each stage ends with something demonstrable. Nothing moves to the next stage
until the current one's check passes.

| # | Stage | Done when |
| --- | --- | --- |
| 1 | Types, store, secrets, logger | A watch survives a restart; a secret round-trips through `safeStorage`; the log file exists and redacts. Unit tests. |
| 2 | Episode detection | Given the two real series, it lists episodes for a chosen dub and correctly reports which are new. Tested against fixtures captured from the live site. |
| 3 | Scheduler + background | Due-time, jitter and backoff have tests. The app keeps checking with the window closed and starts with the system. |
| 4 | Pipeline engine + rename | A run drives the existing queue to download one episode and renames it by template. Rename is pure and unit-tested. |
| 5 | SMB upload | An episode lands in the real test share, at the right path, with the real credentials. Auth failure and unreachable host are reported differently. |
| 6 | Telegram | A real notification arrives, formatted, with the cover. |
| 7 | UI | The screen builds a watch and its pipeline end to end, in both languages, contrast green. |
| 8 | End to end | A watch on a live series detects an episode and carries it through download, rename, upload and notification without help. |

The first release ships stages 1–7 with stage 8 as its acceptance test.

## 14. What could go wrong

- **Automatic downloading, unattended.** A detection bug spends bandwidth and
  disk while nobody is looking. Mitigation: the per-translator comparison above,
  a cap on how many episodes one check may enqueue, and the log.
- **A site changing its markup.** Detection returns nothing or throws; backoff
  and a clear log line, never a retry storm.
- **A new network dependency.** SMB is a real protocol library talking to a real
  server on the user's LAN; it needs timeouts, and its failures must not be able
  to wedge the scheduler.
- **Secrets.** Covered in §5, and the reason the redaction rule is written down
  rather than assumed.
