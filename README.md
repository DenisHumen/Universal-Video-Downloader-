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

### Everything else

- **Title search** — type a title instead of a link. Search **all services at
  once** or pick one: YouTube, SoundCloud, Dailymotion, Bilibili, Niconico,
  PornHub and the YummyAnime catalogue. Results carry thumbnails, durations and
  a best-available-quality badge.
- **Playlists & channels** — a playlist, channel or set link expands into a
  pickable list with per-item checkboxes, "select all" and bulk download.
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
- **Themes & language** — four themes (midnight, carbon, nebula and a real light
  theme) × six accent colours, and a full **English / Русский** interface that
  follows your system locale by default.
- **Convenience** — desktop notifications, taskbar/dock progress, an optional
  tray icon that keeps downloads running when the window is closed, an optional
  clipboard watcher, drag-and-drop, paste-anywhere, a native menu bar and
  keyboard shortcuts (⌘/Ctrl+1…4, ⌘/Ctrl+, and ⌘/Ctrl+/ for the full list).
- **Self-updating** — checks for new releases on launch and installs them.
  Builds that can't self-install (unsigned macOS, `.deb`/`.rpm`) say so and open
  the download page instead of failing silently. The yt-dlp engine keeps itself
  up to date too.
- **Private & local** — everything runs on your machine. No accounts, no telemetry.

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
npm run typecheck  # type-check main + renderer
npm test           # unit tests
npm run build      # bundle main, preload and renderer
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
│   └── services/
│       ├── ytdlp.ts           # downloads & manages the yt-dlp binary
│       ├── detector.ts        # the engine → scrape → browser cascade
│       ├── downloader.ts      # queue, progress, retries, pause/resume
│       ├── search.ts          # title search across services
│       ├── ffmpeg.ts          # bundled ffmpeg resolution
│       ├── updater.ts         # auto-update (+ manual fallback)
│       ├── clipboard.ts       # optional clipboard watcher
│       ├── options.ts         # engine flags & error humanisation
│       └── settings.ts        # persisted user settings
├── preload/index.ts           # secure contextBridge API
├── renderer/                  # React UI
│   └── src/
│       ├── components/        # TitleBar, Sidebar, cards, banners…
│       ├── views/             # Home, Search, Queue, Settings
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
