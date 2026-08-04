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
4. **Structure over decoration.** Indicators are part of the layout — the active
   tab's rule sits on the bar's own hairline — not shapes floating behind
   content. Where structure would be *too quiet to read*, it loses: queue
   progress is a real bar, not the row's border.
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
| `--warn` | caution | `#FACC15` | `#865406` |
| `--bad` | failure | `#FB7185` | `#B81C24` |

**Why `--accent-ink` exists:** the fill colour never clears 4.5:1 as text on its
own canvas. Accent text uses a lighter (Night) or darker (Day) cut of the same
hue. **Never write text in `--accent`.**

**Gate:** `npm run check:contrast` verifies all 7 text colours against all 3
planes in both themes, `--accent-fg` on `--accent`, **and each status colour on
a 12% tint of itself over each plane** — 62 pairings, all ≥ 4.5:1. Tightest
today: Day `--bad` on `--bad/12` over `--bg` at 4.70:1.

> **Correction.** The tint checks were added after a live measurement caught
> `.btn-danger` at 4.14:1 in Day while the gate reported the palette clean:
> `bad` text on a `bad/12` fill puts the colour on *both* sides, so the margin
> is far thinner than the same text on a plain plane. Checking text-on-plane
> alone will never see it. Adding the case immediately turned up a second one
> (`--warn` at 4.47:1); both colours were darkened.

Tailwind names: `canvas` · `raise` · `sink` · `edge` · `edge-strong` · `ink` ·
`ink-2` · `ink-3` · `accent` · `accent-fg` · `accent-ink` · `good` · `warn` ·
`bad`.

## 3. Typography

- **Inter Variable** — interface. Bundled via `@fontsource-variable/inter`.
- **JetBrains Mono Variable** — all data. Bundled via
  `@fontsource-variable/jetbrains-mono`. Applied with `.mono`, which sets
  `font-variant-numeric: tabular-nums` so a column of percentages never shifts.
**Five type roles**, and every screen is built from these rather than ad-hoc
sizes:

| Role | Size | Use |
|---|---|---|
| `.h1` | 24px / 600 | The one heading per screen |
| `.h2` | 15px / 600 | A section inside a screen |
| `.lead` | 14px, `--text-2`, max 62ch | The sentence under an `h1` |
| `.hint` | 12px, `--text-2`, max 62ch | Explanation under a control |
| `.label` | 11px mono, uppercase, 0.08em, `--text-2` | Marks a **group of controls** — never what a screen is |

Base body text is **14px / 1.5**. Nothing carrying prose goes below 12px; 11px
is reserved for tags, badges, keys and short numerics.

> **Correction.** The first cut ran on 13px body with 10px labels in `--text-3`,
> and used `.label` as the home screen's headline — so the app's main question
> was set smaller than its own metadata. Restraint is a job for colour and
> spacing, never for legibility.

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
| `.panel` | Raised plane: one hairline, one flat fill, no shadow |
| `.well` | Inset plane, nests inside `.panel` |
| `.btn-solid` | The one loud action per screen — accent fill, pill |
| `.btn-quiet` | Neutral filled control |
| `.btn-danger` | Destructive — `bad` at 12% |
| `.btn-icon` | 36px square, filled surface, always visible |
| `.btn-icon-bare` | 36px square, transparent — for toolbars on their own plane |
| `.field` / `.field-lg` | Text entry; focus = accent border + 3px accent ring at 16% |
| `.choice` / `.choice-on` | **The only single-select control.** A wrapping row of pills, min 36px; unselected carries a real fill, selected is solid accent |
| `.tab` / `.tab-on` | Top-bar navigation; active marked by a 2px accent rule sitting on the bar's own hairline |
| `.tag` | Read-only fact (extractor, container, count) |
| `.kbd` | Keyboard key |
| `.skeleton` | Placeholder plane; pulses in place |
| `EmptyState` | The one "nothing here" layout: icon, heading, hint, and always a way out |
| `TabStrip` | A tab row that scrolls with arrows, never a scrollbar |

React: `components/Choice.tsx` (choice row), `components/EmptyState.tsx`, and
`Switch` inside `SettingsView` (booleans).

**Minimum sizes.** Buttons 38px, icon buttons and choices 36px, fields 42px.
This sits under the 44px touch floor on purpose — the app is pointer-only
Electron — but nothing goes below 36.

**Focus** is an `outline`, not a ring with an offset colour: these controls sit
on three different planes, so any single offset colour paints a wrong-coloured
halo on two of them.

> **Rule: component classes must not collide with utility names.** The raised
> plane was called `.block` at first — and Tailwind ships `.block` as the
> `display: block` utility, so every element that merely wanted to be a block
> silently gained a bordered, rounded, filled card. Field labels, capability
> hints and the search thumbnail all rendered inside a stray panel. Check a
> proposed class against Tailwind's utility names before adding it.

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

> **Nothing load-bearing may depend on the frame clock.** A throttled window —
> a backgrounded downloader, which is the normal case here — stops firing
> `requestAnimationFrame`, and with it framer-motion's `animate`, CSS
> `scroll-behavior: smooth`, and the `scroll` event. Measured with the clock
> stalled: progress bars froze at their initial width, smooth `scrollIntoView`
> and `scrollBy` moved nothing, and tab arrows never updated. Progress,
> scrolling a result into view, and arrow state are all plain styles, instant
> scrolls and synchronous measurements now. Motion is for entrances only.
>
> Related: `AnimatePresence mode="popLayout"` needs a ref on each child to
> measure it. Function components cannot take one, so it silently failed to lift
> exiting children out of flow — the reason three home-screen states once
> stacked on top of each other. Exit animations were dropped from the state
> swaps entirely.

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
- **Settings:** one scrolling document with a sticky **underline** index driven
  by an `IntersectionObserver` — not nine mutually exclusive panes, and not
  pills, which would look identical to the `.choice` groups it scrolls to.
- **Overflowing tab rows** use `TabStrip`: the scrollbar is hidden and arrows
  appear on whichever side still has content. A 10px scrollbar inside a 48px
  bar of chrome is a band of grey noise, and it is the one affordance you
  cannot use before noticing it.
- **Queue:** one ruled list. Per-row actions are **always visible** and progress
  is a real bar with a track — an action the user cannot see is an action they
  do not have, and nobody reads a hairline as "62% downloaded".

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
