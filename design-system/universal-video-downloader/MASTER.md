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
monochrome + a single blue and the pattern discarded.

**Implementation:** `src/renderer/src/index.css` (tokens + component classes) ·
`tailwind.config.js` (token → utility mapping) · `src/renderer/src/lib/motion.ts`
(motion vocabulary). `npm run check:contrast` gates the palette.

---

## 1. Principles

1. **One saturated colour.** Everything else is a neutral plane or a text tier.
   The accent appears at full strength in exactly one place per screen.
2. **Rules, not shadows.** Elevation is a hairline plus a flat fill. No blur, no
   glow, no gradient, no ambient light source.
3. **Data is mono.** Every measurement, path, identifier and count is set in
   JetBrains Mono with tabular figures. Prose and labels are Inter.
4. **Structure over decoration.** Indicators are part of the layout — a rule on
   the bar's own edge, progress on the row's own bottom border — not shapes
   floating behind content.
5. **Motion explains, never decorates.** Nothing animates while idle.

## 2. Colour tokens

Declared as `R G B` triples on `[data-theme]` so Tailwind can alpha them and a
theme swap is one attribute on `<html>`. Two themes, no accent picker.

| Token | Role | Night | Day |
|---|---|---|---|
| `--bg` | window canvas | `#09090B` | `#F0F0F3` |
| `--surface` | raised plane (`.block`) | `#141417` | `#FFFFFF` |
| `--surface-2` | inset plane (`.field`, `.well`) | `#1C1C20` | `#F8F8FA` |
| `--line` | hairline | `#27272C` | `#E0E0E5` |
| `--line-strong` | emphasised border | `#3F3F46` | `#C6C6CE` |
| `--text` | primary | `#F4F4F5` | `#09090B` |
| `--text-2` | secondary | `#A8A8B2` | `#52525B` |
| `--text-3` | tertiary / meta | `#878792` | `#64646E` |
| `--accent` | brand fill | `#2F5BFF` | `#254EEB` |
| `--accent-fg` | label on accent fill | `#FFFFFF` | `#FFFFFF` |
| `--accent-ink` | accent-coloured **text** | `#8AA8FF` | `#1E40D6` |
| `--good` | success | `#4ADE80` | `#146B35` |
| `--warn` | caution | `#FACC15` | `#8C5806` |
| `--bad` | failure | `#FB7185` | `#C82028` |

**Why `--accent-ink` exists:** the fill colour never clears 4.5:1 as text on its
own canvas. Accent text uses a lighter (Night) or darker (Day) cut of the same
hue. **Never write text in `--accent`.**

**Gate:** `npm run check:contrast` verifies all 7 text colours against all 3
planes in both themes, plus `--accent-fg` on `--accent` — 44 pairings, all
≥ 4.5:1. Tightest today: Night `--text-3` on `--surface-2` at 4.78:1.

Tailwind names: `canvas` · `raise` · `sink` · `edge` · `edge-strong` · `ink` ·
`ink-2` · `ink-3` · `accent` · `accent-fg` · `accent-ink` · `good` · `warn` ·
`bad`.

## 3. Typography

- **Inter Variable** — interface. Bundled via `@fontsource-variable/inter`.
- **JetBrains Mono Variable** — all data. Bundled via
  `@fontsource-variable/jetbrains-mono`. Applied with `.mono`, which sets
  `font-variant-numeric: tabular-nums` so a column of percentages never shifts.
- **`.label`** — the system's one heading style: 10px mono, uppercase,
  `letter-spacing: 0.14em`, `--text-3`. It marks every group, so hierarchy never
  needs a larger size or a heavier weight.

Scale in use: 22px view titles · 15px focal input · 13px body and controls ·
12px dense rows · 11px meta · 10px labels.

Both faces are bundled, never fetched: the window's CSP blocks remote
stylesheets and the app must look identical offline.

## 4. Shape

Four steps, no in-between values.

| Token | Value | Used for |
|---|---|---|
| `--r-1` | 8px | tags, icon buttons, episode toggles |
| `--r-2` | 14px | fields, list rows, thumbnails |
| `--r-3` | 22px | blocks, dialogs, the focal input |
| `--r-pill` | 999px | buttons, choices, filter fields |

Tailwind: `rounded-1` · `rounded-2` · `rounded-3` · `rounded-full`.

## 5. Components

| Class | What it is |
|---|---|
| `.block` | Raised plane: one hairline, one flat fill, no shadow |
| `.well` | Inset plane, nests inside `.block` |
| `.btn-solid` | The one loud action per screen — accent fill, pill |
| `.btn-quiet` | Neutral filled control |
| `.btn-danger` | Destructive — `bad` at 12% |
| `.btn-icon` | 32px square, tertiary until hovered |
| `.field` / `.field-lg` | Text entry; focus = accent border + 3px accent ring at 16% |
| `.choice` / `.choice-on` | **The only single-select control.** A wrapping row of pills; selected is a solid accent fill |
| `.tab` / `.tab-on` | Top-bar navigation; active marked by a 2px accent rule sitting on the bar's own hairline |
| `.tag` | Read-only fact (extractor, container, count) |
| `.kbd` | Keyboard key |
| `.skeleton` | Placeholder plane; pulses in place |

React: `components/Choice.tsx` (choice row) and `Switch` inside `SettingsView`
(booleans).

**Deliberately absent:** segmented controls with a sliding indicator · sweeping
shimmer gradients · hover lift · card borders inside grids · an icon on every
list row · gradient text · glassmorphism · ambient light blobs · film grain.

## 6. Motion

One curve, three durations. Defined in `src/renderer/src/lib/motion.ts`.

- **Ease:** `cubic-bezier(0.2, 0, 0, 1)` — decelerate-emphasised.
- **Durations:** `--t-fast` 160ms (hover, colour) · `--t-base` 240ms (entrances)
  · `--t-slow` 320ms (height reveals).
- **Springs:** dialogs `damping 30 / stiffness 320`; queue reorder
  `damping 32 / stiffness 340`.
- **The app's one entrance:** fade + 6px rise.
- **Stagger:** 30ms per item, 8px rise. A longer cascade reads as slowness.
- `prefers-reduced-motion: reduce` collapses every animation and transition.

## 7. Layout

- **Chrome:** a single 48px bar carrying identity, tab navigation, engine state
  and window controls. There is no sidebar anywhere in the app.
- **Notices** (update, macOS, clipboard) are full-width strips under the chrome
  that push content down — never floating cards.
- **Each view owns its own scrolling**, so it can pin its header and keep a
  sticky index in sync.
- **Measures:** 680px home · 720px settings · 860px queue · 1080px search.
- **Search results:** a 2/3/4-column grid of frameless tiles; the gaps do the
  separating.
- **Settings:** one scrolling document with a sticky pill index driven by an
  `IntersectionObserver` — not nine mutually exclusive panes.
- **Queue:** one ruled list; per-row actions stay dim until hover or focus.

## 8. Pre-delivery checklist

- [x] No emoji as icons — Lucide SVG only
- [x] `cursor-pointer` on every clickable element
- [x] Hover transitions 160–320ms
- [x] Text contrast ≥ 4.5:1 in **both** themes, machine-verified
- [x] Focus rings visible on every interactive class
- [x] `prefers-reduced-motion` respected
- [x] Status never conveyed by colour alone (dot **and** label)
