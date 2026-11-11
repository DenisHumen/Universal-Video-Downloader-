# Developing Universal Video Downloader

Everything a contributor needs that a user does not: the stack, the commands, how a release is cut, and where things live. The user-facing overview is the [README](../README.md).

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Electron 45 (Node 24); macOS 13+, Windows 10+, 64-bit only |
| Build | electron-vite + electron-builder |
| UI | React 18 + TypeScript + Tailwind CSS |
| Animation | Framer Motion |
| State | Zustand |
| Tests | Vitest |
| Engine | yt-dlp (downloaded and refreshed at runtime) + ffmpeg (bundled; release builds pin ffmpeg 9.0.2) + Deno for YouTube's challenges (downloaded at runtime, pinned by version and SHA-256 in `src/main/services/js-runtime.ts`) |
| SMB uploads | node-smb2 |
| Updates | electron-updater (GitHub provider) |

## Commands

Requires Node.js 22.12 or later; `.nvmrc` pins 24, which CI uses and which the Electron 45 binary wants for `npm run dev`. `npm run dev` and `npm start` first fetch the Electron binary if it is not there yet: since Electron 42, `npm install` no longer does. `npm test` never needs it.

The `allowScripts` field in package.json names the four packages whose install scripts are expected to run (electron, esbuild, ffmpeg-static, sharp). npm 11 does not read it yet: it is an allowlist kept ready for an install-script policy (npm's planned one, or `@lavamoat/allow-scripts`), and documentation of which install scripts this project relies on. Nothing in the build depends on it.

```bash
npm install              # install dependencies
npm run dev              # launch the app with hot reload
npm run lint             # ESLint
npm run typecheck        # type-check main + renderer
npm test                 # unit tests
npm run check:contrast   # WCAG AA gate over every theme
npm run build            # bundle main, preload and renderer
```

Extras worth knowing about:

```bash
npm run preview          # the renderer alone, in a browser, against a mock IPC bridge
npm run shots            # regenerate docs/screenshots (--lang=ru, --theme=day|both, --scale=2, --out=<dir>, --offscreen with the display locked)
npm run tour             # re-record docs/assets/tour.webp + tour.mp4 (needs ffmpeg)
npm run visual           # compare every screen with tests/visual/baseline
npm run visual:update    # accept the screens as they are now, after a change that was meant (--only=<scene>)
npm run check:scroll     # every pane that overflows scrolls with the wheel
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

A release that needs a newer macOS than the one before it says so in its notes, as `Requires macOS 13 or later.`: a Mac older than that is then told it is up to date instead of being handed an app that will not open (`offeredToThisMac` in `src/main/services/updater-rules.ts`). The first Electron 45 release needs that line, and only copies that already know to read it can act on it, so a release with the check has to ship before the first one on Electron 45.

## The look

**UVD · Adwaita (Yaru)**, since 4.0: the app follows GNOME's HIG as it looks on Ubuntu 24.04 with Yaru. That means a sidebar with a header bar per pane, boxed lists of rows (action, switch, combo, expander and entry rows), Settings laid out as GNOME Settings (eight panels, subpages that slide in, deep links like `network/proxy#address`), popovers, toasts and status pages. Type is Ubuntu Sans with tabular figures for numbers, and Ubuntu Sans Mono for paths, URLs and IDs. Icons are Yaru symbolics behind one `<Icon>` entry point. Fonts and icons ship with the app, so it looks the same offline and on every OS. Window controls are drawn as GNOME's on Linux (honouring `button-layout`), use `titleBarOverlay` on Windows, and are the native traffic lights on macOS. Motion is CSS only, critically damped, and nothing animates while idle.

There are three styles (day, night, follow the system) and nine GNOME accents (Yaru orange by default, or the system's). Each accent is darkened in OKLab only as far as white text on it needs. The day theme is designed on its own, not inverted from the night one. Text colours are named tokens, and `npm run check:contrast` checks every text, plane, fill and accent pairing across both themes, failing CI below WCAG AA (4.5:1). `npm run visual` diffs every view at 720, 1000 and 1220 px in English and Russian against `tests/visual/baseline`, and `npm run check:scroll` checks that the wheel scrolls every pane that overflows. README screenshots come from `npm run shots` and the tour video from `npm run tour` (both with `npx vite --config vite.preview.config.ts` serving).

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

Bug reports, site requests and pull requests are welcome. Before a PR, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run check:contrast`; CI runs the same checks. After a change to anything on screen, run `npm run visual` as well: no workflow does, so the baselines only stay true if whoever changes the interface updates them in the same commit.
