# Automation — watch a series, download it, put it somewhere, say so

The plan for the automation feature, written before the code so the code has
something to answer to. Work proceeds stage by stage down this file; each stage
names what has to be true before it counts as done.

Status of this document: **stages 1–8 planned. Sections 9 and 11 (SMB and
Telegram) are still marked `PENDING RESEARCH`; they are needed by stages 5 and
6, so stages 1–4 are not blocked on them.**

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

## 9. `PENDING RESEARCH` — SMB

The library choice, with a version and a justification, plus the shape of the
upload: streaming rather than buffering (a 10 GB file cannot be read into
memory), remote directory creation, and distinguishing an authentication failure
from an unreachable host so the user is told which.

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

## 11. `PENDING RESEARCH` — Telegram

Exact request shape using Electron's `net`, HTML vs MarkdownV2 escaping, cover
art via `sendPhoto`, size and rate limits, and which errors to report distinctly.

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
