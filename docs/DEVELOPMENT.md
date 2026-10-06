# Developing Universal Video Downloader

Everything a contributor needs that a user does not: the stack, the commands, how a release is cut, and where things live. The user-facing overview is the [README](../README.md).

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Electron 33 |
| Build | electron-vite + electron-builder |
| UI | React 18 + TypeScript + Tailwind CSS |
| Animation | Framer Motion |
| State | Zustand |
| Tests | Vitest |
| Engine | yt-dlp (downloaded and refreshed at runtime) + ffmpeg (bundled; release builds pin ffmpeg 9.0.2) |
| SMB uploads | node-smb2 |
| Updates | electron-updater (GitHub provider) |

## Commands

Requires Node.js (CI uses Node 20) and npm.

```bash
npm install              # install dependencies
npm run dev              # launch the app with hot reload
npm run typecheck        # type-check main + renderer
npm test                 # unit tests
npm run check:contrast   # WCAG AA gate over every theme
npm run build            # bundle main, preload and renderer
```

Extras worth knowing about:

```bash
npm run preview          # the renderer alone, in a browser, against a mock IPC bridge
npm run shots            # regenerate docs/screenshots (--theme=day|both, --scale=2, --out=<dir>)
npm run make:icons       # rasterise the logo into app, tray and DMG artwork
npm run fetch:ffmpeg     # replace ffmpeg-static's binary with the pinned ffmpeg 9.0.2 (as CI does)
npm run check:ffmpeg     # verify the bundled ffmpeg matches the target architecture
```

`npm run preview` is how the UI gets worked on without booting Electron: `src/renderer/src/lib/mockApi.ts` stands in for the preload bridge, including states the real app only reaches occasionally (the first-run engine download, the update banner, every queue row state).

The terminal mode runs from a development checkout too, after `npm run build`:

```bash
npx electron . --cli https://www.youtube.com/watch?v=jNQXAC9IVRw
```

Build distributables locally:

```bash
npm run pack         # unpacked app in release/<version>/ (quick packaging check)
npm run dist:mac     # .dmg + .zip
npm run dist:win     # .exe (NSIS)
npm run dist:linux   # .AppImage + .deb + .rpm
```

## Releasing

Pushing a `v*` tag runs the [release workflow](../.github/workflows/release.yml). It checks that the tag matches `package.json`, builds on macOS (arm64 and x64), Windows and Linux runners, publishes the installers with the `latest*.yml` metadata the in-app updater reads, then refreshes the signed apt and dnf repositories. The AUR and winget jobs run once their secrets are configured; [`packaging/README.md`](../packaging/README.md) has the setup.

```bash
npm version minor        # bump version + create tag
git push --follow-tags   # CI builds & publishes the release
```

## The look

**UVD — Precision**, a Swiss-modernist system: a strict grid, hairline rules instead of shadows, near-monochrome planes, and exactly one saturated colour. Depth comes from stacking flat surfaces, never from blur or glow. Navigation is a text tab strip on a single 48px bar. Interface type is Inter; every measurement, path and identifier is set in JetBrains Mono with tabular figures. Both faces ship with the app, so it looks identical offline. One easing curve, `cubic-bezier(0.2, 0, 0, 1)`, and three durations cover every transition, and nothing animates while idle.

Two themes, one accent, and the light one is not a tint-inverted copy of the dark one: a light interface needs a canvas *darker* than the planes on it, or every block dissolves into the page. Text colours are named tokens, and `npm run check:contrast` checks every text/plane pairing across both themes, failing CI below WCAG AA (4.5:1).

The full specification lives in [`design-system/universal-video-downloader/MASTER.md`](../design-system/universal-video-downloader/MASTER.md).

## Project structure

```
src/
├── main/                      # Electron main process
│   ├── index.ts               # windows, menu, tray, lifecycle
│   ├── ipc.ts                 # IPC handlers ↔ renderer
│   ├── automation-ipc.ts      # IPC for watches, shares and Telegram
│   ├── cli/                   # `uvd <link>`: the app without its window
│   ├── resolvers/             # turning a link into a downloadable stream
│   │   ├── index.ts           # registry + internal uvd-*:// schemes
│   │   ├── sites/             # one module per hand-written site
│   │   └── universal/         # site-agnostic detection (scrape, hidden browser, scoring)
│   └── services/
│       ├── ytdlp.ts           # downloads & manages the yt-dlp binary
│       ├── detector.ts        # the engine → scrape → browser cascade
│       ├── downloader.ts      # queue: downloads, trims and conversions
│       ├── ffmpeg.ts          # bundled ffmpeg: trim, convert, probe
│       ├── report.ts          # error reports, sent only when the user agrees
│       ├── options.ts         # engine flags & error classification
│       ├── settings.ts        # persisted user settings
│       ├── cli-install.ts     # puts `uvd` on the PATH from Settings (macOS link, AppImage script)
│       └── automation/        # watches: detect, schedule, pipeline, SMB, Telegram
├── preload/                   # the contextBridge API, and the script for the built-in browser
├── renderer/src/              # React UI: components, views, i18n (en + ru), the Zustand store
└── shared/                    # types, IPC channel names, URL canonicalisation, report building
```

Other top-level folders: `scripts/` (ffmpeg, icons, screenshots, contrast and packaging helpers, each with tests), `build/` (packaging artwork, the Linux install scripts and the `uvd` wrapper), `packaging/` (the AUR recipe), `design-system/` and `docs/`.

## Adding a site by hand

Most sites need no code: the engine, the page scrape and the hidden browser cover them. For a player that hides its stream behind a signed request:

1. Create `src/main/resolvers/sites/<site>.ts` exporting a `SiteResolver[]`.
2. Add it to the `resolvers` array in `src/main/resolvers/index.ts`.

A resolver returns the real stream URL plus any headers it needs, or a list of entries, or a full episode/quality picker. Everything downstream (queue, retries, re-resolution) already handles all three shapes.

## Contributing

Bug reports, site requests and pull requests are welcome. Before a PR, run `npm run typecheck`, `npm test` and `npm run check:contrast`; CI runs the same checks.
