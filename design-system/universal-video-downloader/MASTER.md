# UVD — Precision · Design System (MASTER)

> **LOGIC:** When building a specific page, first check `pages/<page-name>.md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

**Project:** Universal Video Downloader
**Style:** Minimalism & Swiss Style / Swiss Modernism 2.0 (`ui-ux-pro-max`)
**Dials:** Variance 3/10 (centred, minimal) · Motion 3/10 (subtle) · Density 8/10 (dense)

Generated from the `ui-ux-pro-max` database, then reconciled with what actually
shipped — every value below is the implemented one, not the generator's default.
The generator proposed a navy/green enterprise palette on a "documentation
landing" pattern; the app is a desktop tool, so the palette was rebuilt as
monochrome + a single accent and the pattern discarded. §1–6 were rewritten
for 4.0 (coalition plan, item 2.8); §7–8 describe the 3.x shell until the
4.0 shell (plan 4.2) replaces it.

**Implementation:** `src/renderer/src/index.css` (tokens + component classes) ·
`tailwind.config.js` (token → utility mapping, type scale) ·
`src/shared/accent.ts` (accents, system-accent clamp) ·
`src/shared/theme-boot.ts` (theme before first paint). `npm run check:contrast`
gates the palette, `npm run visual` diffs every view against committed
baselines.

---

## 1. Principles

4.0 keeps the 3.x system's discipline and amends one of its rules on purpose
(see 1.2). The redesign brief: a visibly modern refresh of every view and menu,
not a new personality.

1. **One saturated colour, the user's choice.** Everything else is a neutral
   plane or a text tier. The accent (Blue by default; Violet, Teal, Orange,
   Pink, Graphite or the OS accent) appears at full strength once per screen.
2. **Rules for structure, shadows for elevation.** *Amended in 4.0.* 3.x said
   "no shadow, no blur". Planes that sit *in* the layout (sheet, card, field,
   list row) still separate with a hairline and a fill step, never a shadow.
   Things that *float above* it (menus, popovers, toasts, dialogs) now cast a
   tokenised shadow (`--shadow-2/3`) and sit on `--surface-3`, because a
   hairline alone could not tell a menu from the card beneath it. Blur exists
   only as the overlay *material* (§2.4): opt-in per platform, with an opaque
   fallback, a reduce-transparency override and a contrast gate. Still absent:
   glow, gradients, ambient light.
3. **Data is mono.** Measurements, paths, identifiers and counts are JetBrains
   Mono with tabular figures. Prose and labels are Inter. Mono is no longer
   used for *labels* (the uppercase mono `.label` goes in 5.8).
4. **Structure over decoration.** Indicators are part of the layout. Where
   structure would be too quiet to read, it loses: progress is a real bar.
5. **Motion explains, never decorates.** Nothing animates while idle, all new
   motion is CSS, and nothing load-bearing depends on the frame clock (§6).
6. **Tokens only.** No hardcoded colour, size, radius, shadow or duration in a
   component. A value that is not a token is either added to the scale on
   purpose or not used. `stylesheet.test.ts` refuses arbitrary type sizes and
   millisecond literals.

## 2. Colour tokens

`R G B` triples on `[data-theme]` (Night is also the unqualified default), so
Tailwind can alpha them and a theme swap is one attribute on `<html>`. The
theme is stamped by the preload before first paint (`shared/theme-boot.ts`),
and the native window background is derived from `--bg`.

### 2.1 Planes, lines and text

| Token | Role | Tailwind | Night | Day |
|---|---|---|---|---|
| `--bg` | window canvas, sidebar | `canvas` | `10 10 13` | `238 238 242` |
| `--surface` | content sheet, cards (`.panel`) | `raise` | `20 20 24` | `255 255 255` |
| `--surface-2` | fields, wells, quiet controls | `sink` | `28 28 33` | `246 246 249` |
| `--surface-3` | floating planes: menus, popovers, toasts, dialogs | `float` | `34 34 40` | `255 255 255` |
| `--line` | hairline | `edge` | `44 44 52` | `222 222 228` |
| `--line-soft` | dividers inside a sheet or card | `edge-soft` | `32 32 38` | `236 236 240` |
| `--line-strong` | emphasised border | `edge-strong` | `63 63 70` | `198 198 206` |
| `--text` | primary | `ink` | `244 244 245` | `12 12 16` |
| `--text-2` | secondary | `ink-2` | `170 170 180` | `78 78 88` |
| `--text-3` | tertiary / meta | `ink-3` | `140 140 152` | `98 98 110` |
| `--skeleton` | loading placeholder | — | `44 44 50` | `222 222 228` |
| `--control-edge` | hairline round quiet/icon buttons | — | none | `--line` |

Status colours are unchanged from 3.x: `--good`, `--warn`, `--bad`, and
`--bad-fg` (the label on a solid `bad` fill, which flips between themes).

### 2.2 Accent

Each accent is a designed triple per theme, set under `[data-accent]`:
**fill** (`--accent`, primary buttons and selected states), **ink**
(`--accent-ink`, accent-coloured *text*: the fill never clears 4.5:1 as text on
every plane) and **label on fill** (`--accent-fg`). Never write text in
`--accent`.

| Accent | Night fill / ink / label | Day fill / ink / label |
|---|---|---|
| Blue (default) | `61 99 255` / `140 170 255` / white | `37 78 235` / `30 64 214` / white |
| Violet | `124 77 255` / `184 160 255` / white | `109 59 232` / `94 48 204` / white |
| Teal | `13 148 136` / `78 214 196` / `10 10 13` | `15 118 110` / `13 102 95` / white |
| Orange | `234 88 12` / `255 166 110` / `10 10 13` | `194 65 12` / `160 53 9`\* / white |
| Pink | `219 39 119` / `249 150 196` / white | `190 24 93` / `165 20 80` / white |
| Graphite | `228 228 231` / same / `12 12 16` | `24 24 27` / same / white |

\* VD spec `170 56 10`, darkened one notch: on the hover tint (`accent/20` over
`--bg`) it measured 4.18:1.

**System accent** (`accent: 'system'`): the OS colour from
`systemPreferences.getAccentColor()` (Windows, macOS) is clamped at runtime by
`deriveAccent` (`shared/accent.ts`): the label is white or the theme's
near-black, the fill is nudged away from the label until the pair clears 4.5:1,
and the ink is moved towards white (Night) or black (Day) until it clears 4.5:1
on every plane. If it cannot, or the OS reports none (Linux), Blue applies.

### 2.3 Elevation

| Token | Night | Day | Used by |
|---|---|---|---|
| `--shadow-1` | `inset 0 1px 0 rgb(255 255 255/.04), 0 1px 2px rgb(0 0 0/.4)` | `0 1px 2px rgb(0 0 0/.06)` | primary button, raised controls |
| `--shadow-2` | `0 8px 24px -4px rgb(0 0 0/.5), 0 2px 6px rgb(0 0 0/.3)` | `… /.16, … /.08` | `.surface-float`: menus, popovers, toasts |
| `--shadow-3` | `0 24px 64px -12px rgb(0 0 0/.6), 0 8px 16px -8px rgb(0 0 0/.4)` | `… /.28, … /.12` | `.surface-dialog` |

Dialogs sit over a `.scrim` (`--scrim` at 60%).

### 2.4 Overlay material (the amendment's limits)

`[data-material='translucent']` (set by the renderer on Windows and macOS)
turns `.surface-float` into `--surface-3` at 86% with `blur(20px)
saturate(1.4)`, and the scrim into 40% with `blur(6px)`. Rules:

- **Opaque is the base.** Every translucent surface has a blur-free base rule;
  one that carries text is fully opaque there.
- **Linux never gets it.** `backdrop-filter` is software-rendered under the
  GL most Linux desktops give Electron, and costs every frame behind a menu.
- **The OS wins.** `prefers-reduced-transparency: reduce` restores the opaque
  base everywhere (a user-facing "reduce transparency" setting arrives with
  the window material, plan 4.3).
- **Gated.** Text on a translucent surface is checked flattened over every
  plane it can float on.

### 2.5 Gate

`npm run check:contrast` reads index.css and fails under 4.5:1 for: every text
colour on every plane (`--bg`, `--surface`, `--surface-2`, `--surface-3`) in
both themes; status colours on a 12% tint of themselves; label-on-fill for
`bad`; **every accent in every theme** (label on fill, ink on each plane, ink on
the `accent/12` and `accent/20` tints); and **every translucent surface** on its
opaque floor (plus the fallback/override checks above). It also holds Day's
`--line` to 1.12:1 and `--skeleton` to 1.3:1 on `--surface`.

The 3.x corrections still stand (skeleton contrast, `--bad-fg`,
`--control-edge`, the tint checks that caught `.btn-danger` at 4.14:1).

## 3. Typography

- **Inter Variable** for the interface, **JetBrains Mono Variable** for data
  (`.mono`, tabular figures). Both bundled; the CSP blocks remote stylesheets.

**The type scale** lives in `tailwind.config.js` (`fontSize`). Seven steps and
nothing between them; `text-[Npx]` is refused by `stylesheet.test.ts`.

| Token | Size | Use |
|---|---|---|
| `text-hero` | 28 / 1.15 / 600 | Home's one question |
| `text-title` | 22 / 1.2 / 600 | A view's title (`.h1`) |
| `text-section` | 16 / 1.35 | A section inside a view (`.h2`, 600) |
| `text-body` | 14 | Prose, row titles, the body default |
| `text-control` | 13 | Buttons, choices, menu items, nav |
| `text-meta` | 12 | Secondary lines, hints (`.hint`) |
| `text-caption` | 11 | Badges, keys, tags, short numerics |

The four UI sizes carry no line-height and keep the body's 1.5, so a label on
a token sits where it did. Nothing carrying prose goes below 12px.

**Copy voice (4.0):** sentence case in English and Russian ("Save location",
not "save location" or "SAVE LOCATION"). The shell's strings switch first
(nav, sidebar footer, view titles); the rest follows in 5.8. Mono uppercase
`.label` is retired as views are restyled.

## 4. Shape

| Token | Value | Used for |
|---|---|---|
| `--r-1` | 6px | tags, swatches, icon buttons, menu items |
| `--r-2` | 8px | fields, buttons, choices, list rows |
| `--r-3` | 12px | cards, menus, popovers, toasts, the content sheet |
| `--r-4` | 16px | dialogs, the home input |
| `--r-pill` | 999px | **only** badges, the switch and progress tracks |

Tailwind: `rounded-1` … `rounded-4`, `rounded-pill`.

> **Correction (4.0).** 3.x made buttons, choices and filter fields pills next
> to square fields, which read as two systems in one row. Controls are r-2 now.

## 5. Components

The 3.x classes remain until each view moves to the primitives (plan 3.1,
`src/renderer/src/ui/`), which are token-only and tested:

| Class / primitive | What it is |
|---|---|
| `.panel` | In-layout plane: hairline + `--surface`, no shadow |
| `.well` | Inset plane inside a `.panel` |
| `.surface-float` | Floating plane: `--surface-3`, r-3, `--shadow-2`; translucent material where enabled |
| `.surface-dialog` | Dialog plane: `--surface-3`, r-4, `--shadow-3` |
| `.scrim` | Behind a dialog |
| `.btn-solid` | The one loud action per screen: accent fill, r-2, `inset 0 1px 0 rgb(255 255 255/.12)` + `--shadow-1` |
| `.btn-quiet`, `.btn-danger`, `.btn-base` | As in 3.x, on r-2 |
| `.btn-icon`, `.btn-icon-bare` | Icon-only. Visual box 28/34px, **hit area ≥ 36px**, `aria-label` required |
| `.field` / `.field-lg` | Focus ring `0 0 0 3px` accent at 24%. Home's input: 52px, r-4, `--shadow-2` |
| `.choice` | Independent choices; `SegmentedControl` (2–5 options) replaces it where one value is picked |
| `Menu` / `Popover` | One positioning and focus implementation (lifted from `RowMenu` and `Modal`); items 30px |
| `Dialog` | Wraps `Modal`: role and name on the panel, focus in and back, Tab kept inside, Esc for the top dialog |
| `Tooltip` | 500ms delay; replaces `title` on icon-only controls |
| `EmptyState` | 48px icon tile on `--surface-2` at r-3, 24px icon in accent ink, 16/600 title, 13px hint, a primary action, centred at ~40% height |
| `CaptionButtons` | Windows and Linux min/max/close; never removed by a shell change |

**Control heights:** 28 / 34 / 40 (sm / md / lg). Nav item 32, menu item 30,
queue row 56. Nothing interactive has a hit area under 36px.

**Focus** is an `outline` in `--accent`, offset 2px, on every control.

Component classes must not collide with Tailwind utility names (the 3.x
`.block` lesson).

**Deliberately absent:** sliding segmented indicators · shimmer gradients ·
hover lift · gradient text · glow · ambient blobs · film grain · blur outside
the overlay material.

## 6. Motion

CSS custom properties in index.css; Tailwind points at them.

| Token | Value | Use |
|---|---|---|
| `--t-press` | 90ms | the down state of a control (`active:scale`) |
| `--t-fast` | 140ms | hover, colour, small reveals |
| `--t-base` | 200ms | entrances |
| `--t-slow` | 260ms | height reveals |
| `--t-view` | 120ms | the view host's fade (opacity only) |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | everything by default |
| `--ease-spring` | `cubic-bezier(0.3, 1.25, 0.5, 1)` | things that *arrive* (menu, toast); never colour |

Rules (all carried over from 3.x, now binding for 4.0 work):

- **New motion is CSS.** framer-motion moves to `LazyMotion` + `m` (plan 3.3)
  and is not used for anything new. Its remaining transitions use the same
  durations.
- **No `requestAnimationFrame` motion** and **no transforms on the view host**:
  a throttled (backgrounded) window stops the frame clock, which once left a
  blank view at opacity 0. Screen swaps fade the host with a keyframe.
- **No fill-mode dependence.** An element at rest is at its final state
  whether its animation ran or not.
- **Nothing dismissed by an external event has an exit animation.**
- `prefers-reduced-motion: reduce` collapses every animation and transition;
  `stylesheet.test.ts` checks the override and refuses millisecond literals
  outside the tokens.
- Timers that count (detect elapsed time, taskbar progress) are `setInterval`.

## 7. Layout

- **Chrome:** a single 48px bar carrying identity, tab navigation, engine state
  and window controls. There is no sidebar anywhere in the app.
- **Notices** (update, macOS, clipboard) are full-width strips under the chrome
  that push content down — never floating cards.
- **Each view owns its own scrolling**, so it can pin its header and keep a
  sticky index in sync.
- **Measures:** 680px home (840px from 880px wide, for the two-column result
  card) · 720px settings · 860px queue · 1080px search.
- **Home result card:** from 880px, two columns — left 240px (16:9 poster,
  title, uploader · duration, tags), right the choices (format, quality, exact
  stream, cut, save location). Narrower, one column. Either way the download
  bar is `sticky bottom-0` inside the card (`overflow-clip`, not
  `overflow-hidden`, so the card is not a scroll container), and its label
  states the outcome: "download · 1080p · MP4 · ~412 MB".
- **Home while detecting:** the card is drawn in the result's shape at once —
  a YouTube poster straight from the video id, title/uploader/poster from the
  site's oEmbed when it answers (≤2s, five allowlisted hosts), skeletons for
  the rest — with an elapsed counter after 3s and a "download now" button that
  queues with the default quality without waiting for the format list
  (⌘/Ctrl+Enter does the same). Not for collections, which need the picker.
- **Home below the card:** on first run, the capability list. Once there is a
  history, "active" (up to 3 compact live rows with a 2px track) and "recent"
  (the last 5 finished, play / show in folder), then "open the queue".
- **Search results:** a 2/3/4-column grid of frameless tiles; the gaps do the
  separating.
- **Settings:** one scrolling document with a sticky index rail driven by an
  `IntersectionObserver` — not nine mutually exclusive panes, and not pills,
  which would look identical to the `.choice` groups it scrolls to. The rail
  opens with a search field (matches every word of the query against each
  row's label and hint in the language on screen, folding case, accents and
  ё; a section whose name matches shows whole; empty sections hide, via
  `:has()` on the rows' own `hidden`), then two `.label`-headed tiers:
  **essentials** (appearance, downloads, post-processing, watching, system)
  and **advanced** (detection, access & cookies, network, updates, backup,
  about). The page runs in the rail's order.
- **Navigation tabs** go icon-only — the label becomes `aria-label` and
  `title` — below 760px, or 960px in Russian, whose labels run ~30% longer.
  The queue tab's badge shows the overall % while anything is downloading, the
  count otherwise; the taskbar/dock icon mirrors the same figure.
- **Overflowing tab rows** use `TabStrip`: the scrollbar is hidden and arrows
  appear on whichever side still has content. A 10px scrollbar inside a 48px
  bar of chrome is a band of grey noise, and it is the one affordance you
  cannot use before noticing it.
- **Queue row anatomy.** Two lines. Line 1: mono index, 64×36 poster, title.
  Line 2, mono `text-ink-2`: status dot + label · 42% · 3.1 MB/s · 1:12 left ·
  1080p. A 3px track runs the full width of the row along its bottom edge —
  accent while running, `edge-strong` while paused, an indeterminate band when
  no total is known, and absent for queued and finished rows. A failed row
  prints its error inline in `text-bad`.
- **Queue row actions:** the state's one primary action (pause · resume ·
  retry · play + show in folder), then remove (cancel while still working),
  then a `RowMenu` with the rest (copy link, open source, move up, trim,
  convert, copy error). All always visible; nothing is hidden behind hover.
  Eight equal icons made the row's own action one square among many and left
  the title ten characters at 660px.
- **Queue list:** unfiltered, it is drawn in sections — active, failed, done —
  under `.label` headers, each in list order. The header carries the totals
  (count, combined speed, what is left) and labelled "pause all" / "clear
  finished" beside the icon-only rest.

## 8. Pre-delivery checklist

- [x] No emoji as icons — Lucide SVG only
- [x] `cursor-pointer` on every clickable element
- [x] Hover transitions 160–320ms
- [x] Text contrast ≥ 4.5:1 in **both** themes, machine-verified
- [x] Focus rings visible on every interactive class
- [x] `prefers-reduced-motion` respected
- [x] Status never conveyed by colour alone (dot **and** label)
- [x] No control revealed only on hover
- [x] Every icon-only button carries an `aria-label`
- [x] Every screen opens with an `h1` and a sentence saying what it is for
- [x] Every empty state offers a next step
