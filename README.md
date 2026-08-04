<div align="center">

<img src="assets/logo.svg" width="120" alt="Universal Video Downloader" />

# Universal Video Downloader

**A beautiful, cross-platform desktop app that detects and downloads video from almost any website.**

Paste a link → it finds the video stream → pick a quality → download.
Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, wrapped in a modern, animated UI.

![platform](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-supported-7c5cff)
![license](https://img.shields.io/badge/license-MIT-22d3ee)

</div>

---

## ✨ Features

### Universal detection — no per-site work required

Most downloaders only handle sites someone wrote code for. This one tries three
strategies in order, cheapest first, and stops at the first that works:

1. **The engine** — yt-dlp knows 1800+ sites natively.
2. **A static scrape** — if the engine doesn't know the site, the app reads the
   page itself: JSON-LD `VideoObject`, OpenGraph `og:video`, `<video>`/`<source>`
   tags, JW Player / Video.js / Plyr configs, and one level of player iframes.
3. **A headless browser pass** — still nothing? The app opens the page in a
   hidden Chromium window, starts the player, and captures the manifest request
   *off the wire* — together with the exact `Referer` / `Origin` / `Cookie`
   headers the CDN demands. Those headers are handed to the download engine, so
   the stream downloads the same way the browser would have played it.

Candidate URLs are scored (HLS manifest ≫ DASH ≫ progressive MP4; trailers,
sprite strips, ad-network media and individual HLS segments are demoted), so the
app picks the real video rather than the pre-roll. Stream links expire, so the
queue stores the *page* URL and re-runs detection on every start and retry.

The headless pass can be switched off in **Settings → detection** if you'd rather
the app never load a remote page on its own.

### Hand-written resolvers, for the sites that need them

Some players hide their stream behind a signed AJAX call that no generic scraper
can reach. Those get a small dedicated module in `src/main/resolvers/sites/` —
currently **HDrezka** (and its mirror domains), **YummyAnime** (via the Kodik
player) and **CumGloryHole**. Adding one is a single file plus one line in the
registry; nothing else in the app changes.

For streaming sites the app reads the available **voiceovers (озвучки)**,
**seasons**, **episodes** and **qualities**, lets you multi-select episodes, and
queues each as `Title - S01E02`. Premium-only translations are flagged and can't
be downloaded.

### Trim and convert, without leaving the app

- **Cut before you download.** Set a start and end on the video's timeline and
  the engine fetches *only that section* — clipping 30 seconds out of a
  two-hour stream costs 30 seconds of bandwidth, not the whole file.
- **Trim what you already have.** Any finished download can be re-cut. The
  default is a frame-accurate cut (re-encoded, so "remove the intro" actually
  removes the intro); a stream-copy mode is one click away when speed matters
  more than precision — it's near-instant but the clip can start seconds early.
- **Convert** to MP4, MKV, WebM, MOV or an animated GIF, extract audio as MP3,
  M4A, OPUS, FLAC, WAV or AAC, and downscale on the way. Conversions run in the
  same queue as downloads, with progress, cancel and open-when-done.

### Built-in browser, for when nothing is found

Automatic detection is good, not omniscient. When it comes up empty, the app
opens a real Chromium view: browse to the video, play it, and every media
request the page makes appears in a side panel, one click from the queue. If the
capture is ambiguous, **pick mode** highlights elements as you hover — click the
player and the app takes that element's source.

It shares its session with the headless detector, so a consent banner you
dismiss or a login you complete here still applies when a queued item is
re-resolved later.

### Everything else

- **Title search** — type a title instead of a link. Search **all services at
  once** or pick one: YouTube, SoundCloud, Dailymotion, Bilibili, Niconico,
  PornHub and the YummyAnime catalogue. Results carry thumbnails, durations and
  a best-available-quality badge.
- **Playlists & channels** — a playlist, channel or set link expands into a
  pickable list with per-item checkboxes, "select all", a range picker for
  taking items 1–50 of a big channel, and bulk download. How deep to list is a
  setting (up to 5000 videos).
- **Batch links** — paste a whole list of URLs and queue them in one go.
- **Quality your way** — automatic **best** by default, one-click presets
  (4K…360p) or an exact stream. A preset above what the video offers falls back
  to the best available; it never fails. Audio-only extraction to MP3, M4A,
  OPUS, FLAC, WAV, AAC.
- **Smart queue** — parallel downloads, live speed & ETA, pause / resume /
  retry / cancel, filters (all · active · done · failed), title search, bulk
  pause/resume/retry, and automatic retries for transient network failures.
  Every card can show the engine's raw output when something goes wrong.
- **Post-processing** — embed thumbnails, metadata, chapters and subtitles;
  write subtitles as separate `.srt` files; SponsorBlock segment removal;
  per-site subfolders; a download speed limit.
- **Restricted sites** — age-verification, login-only and members-only videos
  work by reading cookies from your browser, or from a `cookies.txt` file:
  **Settings → access & cookies**.
- **Themes & language** — two designed themes, night and day, and a full
  **English / Русский** interface that follows your system locale by default.
- **Convenience** — desktop notifications, taskbar/dock progress, an optional
  tray icon that keeps downloads running when the window is closed, an optional
  clipboard watcher, drag-and-drop, paste-anywhere, a native menu bar and
  keyboard shortcuts (⌘/Ctrl+1…4, ⌘/Ctrl+, and ⌘/Ctrl+/ for the full list).
- **Self-updating** — checks for new releases on launch and installs them.
  Builds that can't self-install (unsigned macOS, `.deb`/`.rpm`) say so and open
  the download page instead of failing silently. The yt-dlp engine keeps itself
  up to date too.
- **Private & local** — everything runs on your machine. No accounts, no telemetry.

### The look

**UVD — Precision**, a Swiss-modernist system: a strict grid, hairline rules
instead of shadows, near-monochrome planes, and exactly one saturated colour.
Depth comes from stacking flat surfaces, never from blur or glow. Navigation is
a text tab strip on a single 48px bar — no sidebar anywhere. Interface type is
Inter; every measurement, path and identifier is set in JetBrains Mono with
tabular figures, so data is always distinguishable from labels at a glance. Both
faces ship with the app rather than being fetched, so it looks identical
offline. One easing curve — `cubic-bezier(0.2, 0, 0, 1)` — and three durations
cover every transition, and nothing animates while idle.

The full specification lives in
[`design-system/universal-video-downloader/MASTER.md`](design-system/universal-video-downloader/MASTER.md).

Text colours are named tokens rather than alphas over a foreground, because the
same alpha reads very differently on every surface it lands on — which is how a
palette silently drifts under AA. `npm run check:contrast` parses the real
values out of the stylesheet and checks all 44 text/plane pairings across both
themes, failing CI below WCAG AA (4.5:1).

## 📦 Install

Grab the latest installer for your OS from the [**Releases**](https://github.com/DenisHumen/Universal-Video-Downloader-/releases) page:

| OS | File |
| --- | --- |
| **Windows** | `Universal Video Downloader-<version>-windows-x64-setup.exe` |
| **macOS** | `Universal Video Downloader-<version>-mac-<arm64\|x64>.dmg` |
| **Ubuntu / Debian** | `.deb` or `.AppImage` |
| **Fedora / RHEL** | `.rpm` or `.AppImage` |

> **macOS note:** builds are currently unsigned. On first launch, right-click the app → **Open**, or run
> `xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app"`.
> Because they're unsigned, macOS builds can't apply updates in place — the app
> offers you the download page instead.

On first run the app downloads the small yt-dlp engine binary automatically.

## 🛠 Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Electron 33 |
| Build | electron-vite + electron-builder |
| UI | React 18 + TypeScript + Tailwind CSS |
| Animation | Framer Motion |
| State | Zustand |
| Tests | Vitest |
| Engine | yt-dlp (managed at runtime) + ffmpeg (bundled) |
| Updates | electron-updater (GitHub provider) |

## 🚀 Development

```bash
npm install        # install dependencies
npm run dev        # launch the app with hot reload
npm run typecheck        # type-check main + renderer
npm test                 # unit tests
npm run check:contrast   # WCAG AA gate over every theme
npm run build            # bundle main, preload and renderer
```

Build distributables locally:

```bash
npm run dist:mac     # .dmg + .zip
npm run dist:win     # .exe (NSIS)
npm run dist:linux   # .AppImage + .deb + .rpm
```

## 🏗 Project structure

```
src/
├── main/                      # Electron main process
│   ├── index.ts               # windows, menu, tray, lifecycle
│   ├── ipc.ts                 # IPC handlers ↔ renderer
│   ├── resolvers/             # turning a link into a downloadable stream
│   │   ├── index.ts           # registry + internal uvd-*:// schemes
│   │   ├── http.ts            # shared fetch/parse helpers
│   │   ├── sites/             # one module per hand-written site
│   │   └── universal/         # site-agnostic detection
│   │       ├── static.ts      #   HTML/JSON-LD/OpenGraph/player configs
│   │       ├── sniffer.ts     #   hidden browser + network capture
│   │       └── candidates.ts  #   scoring & ranking of media URLs
│   │       ├── capture.ts     #   shared, ref-counted webRequest hooks
│   │       └── direct.ts      #   uvd-direct:// — a stream picked by hand
│   └── services/
│       ├── ytdlp.ts           # downloads & manages the yt-dlp binary
│       ├── detector.ts        # the engine → scrape → browser cascade
│       ├── downloader.ts      # queue: downloads, trims and conversions
│       ├── ffmpeg.ts          # bundled ffmpeg: trim, convert, probe
│       ├── browser.ts         # the built-in browser window
│       ├── search.ts          # title search across services
│       ├── updater.ts         # auto-update (+ manual fallback)
│       ├── clipboard.ts       # optional clipboard watcher
│       ├── options.ts         # engine flags & error humanisation
│       └── settings.ts        # persisted user settings
├── preload/
│   ├── index.ts               # secure contextBridge API
│   └── site.ts                # injected into pages in the built-in browser
├── renderer/                  # React UI
│   └── src/
│       ├── components/        # TitleBar, Sidebar, cards, banners…
│       ├── views/             # Home, Search, Queue, Settings
│       ├── BrowserApp.tsx     # shell around the built-in browser view
│       ├── i18n/              # en + ru dictionaries
│       └── store.ts           # Zustand store wired to IPC events
└── shared/                    # types & IPC channel names
```

### Adding a site by hand

1. Create `src/main/resolvers/sites/<site>.ts` exporting a `SiteResolver[]`.
2. Add it to the `resolvers` array in `src/main/resolvers/index.ts`.

A resolver returns the real stream URL plus any headers it needs — or a list of
entries, or a full episode/quality picker. Everything downstream (queue, retries,
re-resolution) already handles all three shapes.

## 🤝 Releasing

Pushing a `v*` tag triggers the [release workflow](.github/workflows/release.yml), which builds
on macOS, Windows and Linux runners and publishes artifacts to GitHub Releases —
including the `latest*.yml` metadata that powers in-app auto-updates.

```bash
npm version patch        # bump version + create tag
git push --follow-tags   # CI builds & publishes the release
```

## ⚖️ Legal

This tool is for downloading content you have the right to access. Respect the terms of
service and copyright of the sites you use it with.

## 📄 License

[MIT](LICENSE) © Denis Humen
