# UVD · v4 + Adwaita (Yaru) · Design System (MASTER)

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

## 1. Principles (4.0 + Adwaita/Yaru, amendments A1, A1.1, A1.2)

The user runs Ubuntu 24.04 GNOME with Yaru, and asked for the app to look
like it. 4.0 keeps what the v4 demo got right (the inset content sheet, its
depth, its density) and takes GNOME's *shape*: header bars, a sidebar of
rows, boxed lists, GNOME Settings' layout, Yaru's palette, Ubuntu Sans and
Yaru's icons. Every value was measured on the user's machine
(`docs/design/calibration.md`); none is from memory.

1. **The user's desktop is the reference.** Colours, sizes and radii come
   from D0 and the user's own Settings screenshot; where they disagree the
   screenshot wins, unless the contrast gate forbids it.
2. **AA everywhere.** Yaru's dim text, its orange as a text fill, and a
   checked toggle on a dark card all fail 4.5:1 as drawn; ours are corrected
   (`--text-2`, the OKLab-darkened accent fill, a .25 checked fill). The raw
   orange stays for shapes that carry no text (`--accent-bright`).
3. **Neutral controls, one accent.** Buttons, entries, toggles and selected
   rows are the text colour at an alpha, as libadwaita draws them. The accent
   is for the suggested action, switches, progress and the selection ring.
4. **Floating things cast shadows; nothing blurs.** Cards use libadwaita's
   light ring shadow (Night: v4's depth); popovers and dialogs v4's
   shadow-2/3. A1 removed the blur material and its machinery.
5. **Motion is CSS.** Pages slide on libadwaita's critically damped spring in
   `linear()`; no `requestAnimationFrame`, no view-host transforms, no
   fill-mode dependence, reduced motion respected.
6. **Tokens only**, gated by `npm run check:contrast`, pinned by the
   visual-diff harness (`npm run visual`).

## 2. Colour (Yaru, measured; R G B)

| Token | Role | Night | Day |
|---|---|---|---|
| `--bg` / `--surface` | window, sheet, header bars | 44 44 44 | 250 250 250 |
| `--sidebar` | app sidebar | 48 48 48 | 235 235 235 |
| `--sidebar-2` | Settings' panel list | 46 46 46 | 243 243 243 |
| `--card` | cards, boxed lists | 61 61 61 | 255 255 255 |
| `--surface-3` | popovers, dialogs | 56 56 56 | 255 255 255 |
| `--fill` | control colour (used at .10 / .15 / .25) | 247 247 247 | 61 61 61 |
| `--line` / `--line-soft` | pane divider / row separator | 31 / 39 | 219 / 237 |
| `--text` / `--text-2` | text / dim (AA-corrected) | 247 / 172 | 61 / 92 |
| `--accent` / `--accent-ink` | Yaru orange fill (AA) / text | 213 65 0 / 255 154 106 | 213 65 0 / 183 31 0 |
| `--accent-bright` | raw #E95420 for non-text shapes | 233 84 32 | 233 84 32 |
| `--destructive` | destructive fill (white label) | 192 28 72 | 192 28 72 |
| `--bad` | failure text, kept off the orange's hue | 255 170 190 | 192 28 72 |
| `--osd` / `--osd-fg` | tooltips, toasts | 30 / 255 | 30 / 255 |

**Accents:** GNOME's nine (orange = Yaru's, default; blue, teal, green,
yellow, red, pink, purple, slate), each derived by `scripts/accents.mjs`.
"System" follows the desktop where it answers (portal, getAccentColor, or
the Yaru variant from the GTK theme) and is hidden where it does not.

**Gate:** text on all planes, every accent in both themes, text on the
control fills, the destructive and OSD labels, a hue gap so a failure never
reads as the accent, Day hairlines and the skeleton.

## 3. Type

Ubuntu Sans and Ubuntu Sans Mono v1.006 (UFL 1.0), bundled unmodified.
libadwaita's classes at v4's density: title-1 26.67/800, title-2 20/800,
title-3 20/700, title-4 17.33/700, heading 14/700, body 14, control 13,
caption 12 (`text-*` in Tailwind). `.numeric` is tabular figures in the
sans; mono is for paths, URLs and ids. English titles, buttons and menu
items use HIG header capitalisation, descriptions sentence case; Russian is
sentence case; a label that opens more input ends in "…".

## 4. Shape and size

Radii 6 (buttons, entries, rows, menu items) / 12 (cards, boxed lists,
popovers, the sheet) / 16 (dialogs); pills for the main call to action,
toasts, badges and the switch. Header bars 46, sidebar rows 44, boxed rows
≥ 50, controls 34, switch 46 × 26, caption buttons 24 px circles in 36 px
targets; no hit area under 36.

## 5. Components (`src/renderer/src/ui/`)

HeaderBar · Button / IconButton · Field · Switch · Checkbox ·
SegmentedControl (GNOME 46 linked toggles) · Menu / Popover · Dialog
(AdwAlertDialog) · Toast (OSD pill) · Tooltip (OSD) · PreferencesPage /
PreferencesGroup · Action / Switch / Combo / Entry / PasswordEntry /
Expander rows · NavigationStack · StyleTiles · AccentSwatches · Badge ·
Banner · Spinner · EmptyState (AdwStatusPage) · Icon (Yaru symbolics,
CC-BY-SA-4.0, separate SVG files painted in currentColor).

The shell: the app sidebar (header with the app name and primary menu, 44 px
rows, the Activity badge) beside the inset sheet, each pane with its own
header bar; below 860 px the sidebar is an overlay; Settings follows GNOME
Settings (three columns from 1100, one rail at 860-1099, a stack below 860)
with deep links `settings/<panel>[/<subpage>][#row]`.

## 6. Motion

`--t-press` 90, `--t-fast` 140, `--t-base` 200, `--t-slow` 260 ms;
`--ease` for widgets; `--ease-spring` = libadwaita's damping-1 /
stiffness-1000 spring as `linear()`, over `--t-spring` 250 ms, for page
slides. Everything collapses under `prefers-reduced-motion`.

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
