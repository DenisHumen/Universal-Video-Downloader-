<div align="center">

<img src="assets/logo.svg" width="120" alt="Universal Video Downloader" />

# Universal Video Downloader

**A beautiful, cross-platform desktop app that detects and downloads video from almost any website.**

Paste a link → it automatically finds the video stream → pick a quality → download.
Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, wrapped in a modern, animated dark UI.

![platform](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-supported-7c5cff)
![license](https://img.shields.io/badge/license-MIT-22d3ee)

</div>

---

## ✨ Features

- **Universal detection** — automatically discovers the video/audio stream behind a link. 1800+ sites supported via yt-dlp, plus a generic extractor for everything else.
- **Restricted sites** — age-verification, login-only and members-only videos (including adult sites) work by reading cookies from your browser: **Settings → Access & cookies → Use cookies from browser**.
- **Quality your way** — one-click presets (Best, 4K, 1080p, 720p…) or pick an exact stream. Audio-only extraction to MP3, M4A, OPUS, FLAC, WAV, AAC.
- **Smart download queue** — parallel downloads, live progress, speed & ETA, pause / resume / retry / cancel.
- **Post-processing** — embed thumbnails, metadata and subtitles; automatic merging of separate video+audio streams with bundled ffmpeg.
- **Self-updating** — the app checks for new releases on launch and can download, install and relaunch itself. The yt-dlp engine also keeps itself up to date.
- **Minimal dark UI** — a clean, monochrome cobalt-inspired interface: a left nav, floating rounded panels, segmented controls and smooth Framer Motion transitions in a frameless window.
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

On first run the app downloads the small yt-dlp engine binary automatically.

## 🛠 Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Electron 33 |
| Build | electron-vite + electron-builder |
| UI | React 18 + TypeScript + Tailwind CSS |
| Animation | Framer Motion |
| State | Zustand |
| Engine | yt-dlp (managed at runtime) + ffmpeg (bundled) |
| Updates | electron-updater (GitHub provider) |

## 🚀 Development

```bash
npm install        # install dependencies
npm run dev        # launch the app with hot reload
npm run typecheck  # type-check main + renderer
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
├── main/                 # Electron main process
│   ├── index.ts          # window lifecycle & bootstrap
│   ├── ipc.ts            # IPC handlers ↔ renderer
│   └── services/
│       ├── ytdlp.ts      # downloads & manages the yt-dlp binary
│       ├── detector.ts   # stream/format detection (yt-dlp -J)
│       ├── downloader.ts # download queue, progress, pause/resume
│       ├── ffmpeg.ts     # bundled ffmpeg resolution
│       ├── updater.ts    # auto-update via electron-updater
│       └── settings.ts   # persisted user settings
├── preload/index.ts      # secure contextBridge API
├── renderer/             # React UI
│   └── src/
│       ├── components/   # TitleBar, Sidebar, cards, banners…
│       ├── views/        # Home, Downloads, Settings
│       └── store.ts      # Zustand store wired to IPC events
└── shared/               # types & IPC channel names
```

Adding a new feature is intentionally easy: define a channel in `src/shared/ipc.ts`,
implement it in a `services/*` module, expose it through `src/preload/index.ts`, and
consume it from the renderer store.

## 🤝 Releasing

Pushing a `v*` tag triggers the [release workflow](.github/workflows/release.yml), which builds
on macOS, Windows and Linux runners and publishes signed-by-hash artifacts to GitHub Releases —
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
