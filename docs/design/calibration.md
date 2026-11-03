# D0 calibration: the user's GNOME (Ubuntu 24.04, Yaru)

Amendment A1.2 (Y2, Y5, E1, L3) locks every "≈" value of the Adwaita
revision against what the user's own desktop renders. This file is that
record. Taken on 2026-11-03.

## The machine

| | |
|---|---|
| OS | Ubuntu 24.04.5, GNOME Shell 46, Wayland |
| libadwaita | 1.5.0-1ubuntu2 (Ubuntu's patched build) |
| GTK theme | `Yaru-dark`, colour scheme `prefer-dark` |
| Font | `Ubuntu Sans 11` (Ubuntu Sans v1.006, `fonts-ubuntu`) |
| Icons | Yaru (`yaru-theme-icon` 24.04.2) |
| `button-layout` | `:minimize,maximize,close` |
| Portal `org.freedesktop.appearance accent-color` | **NotFound** (a GNOME 47+ key): "System accent" must stay hidden here (E2) |
| Portal `color-scheme` | `1` (prefer dark) |

## Method, and why not the apps themselves

E1 asks for samples from Files and Settings. Driving them from an agent is
not practical on this machine:

- GNOME 46 on Wayland refuses `org.gnome.Shell.Screenshot` to any caller not
  on its allow-list ("Screenshot is not allowed"), `gnome-screenshot` is not
  installed, and installing anything is out of bounds (E1);
- `GTK_DEBUG=interactive` opens the inspector, which needs a person to click
  through it.

So the reference renders were made with the **same toolkit the apps are built
from**, on the user's machine, in the user's session: `render.js` (gjs, no
installs) builds the widgets Files and Settings use (AdwNavigationSplitView,
ToolbarView + AdwHeaderBar, a `navigation-sidebar` list, AdwPreferencesGroup
with Action/Switch/Combo rows, linked toggle buttons, buttons, entry, card)
with the user's libadwaita, theme, font and icons, and snapshots them.
Light and dark are forced **per process** through `AdwStyleManager`; the
desktop's own scheme was never changed. Colours were then read from the PNG
pixels, and sizes from the widgets' allocations.

Important finding: on 24.04 the libadwaita apps do **not** use the Yaru GTK 4
stylesheet. Ubuntu's libadwaita draws Adwaita's widgets with Yaru's palette:
the orange accent, Yaru's `#3D3D3D` light text and `#2C2C2C` dark window. The
Yaru gtk-4.0 CSS on disk (GPL-3.0+, read for values only, never copied: L3)
styles plain GTK 4 apps; its values are listed at the end for reference.

Reference images: `calibration/yaru-light.png`, `calibration/yaru-dark.png`.
Raw measurements: `calibration/yaru-{light,dark}.json`.

## Measured values (R G B)

| What (libadwaita name) | Light | Dark |
|---|---|---|
| Window / content header bar (`window_bg`, `headerbar_bg`) | 250 250 250 | 44 44 44 |
| Sidebar pane + its header (`sidebar_bg`) | 235 235 235 | 48 48 48 |
| View (`view_bg`) | 255 255 255 | 30 30 30 |
| Card / boxed list (`card_bg`) | 255 255 255 | 61 61 61 |
| Row separator inside a boxed list | 237 237 237 | 39 39 39 |
| Pane divider (sidebar end border) | 219 219 219 | 31 31 31 |
| Card edge (light: shadow ring) | 226 / 240 | 40 / 42 |
| Text (`window_fg`) | 61 61 61 | 247 247 247 |
| Dim label / row subtitle (`dim-label`, 55%) | 146–153 | 156–158 |
| Button and entry fill | 231 231 231 | 64 64 64 |
| Selected sidebar row | 216 216 216 | 69 69 69 |
| Checked toggle button | 193 193 193 | 105 105 105 |
| Switch, off track | 226 226 226 | 89 89 89 |
| Switch, on track / suggested button (accent) | 233 84 32 | 233 84 32 |
| Destructive button | 211 39 59 | 199 22 43 |
| Switch knob | 255 255 255 | 255 255 255 |

**Fills are the text colour at an alpha**, which is how libadwaita builds
them: button/entry `(250−231)/(250−61)` = **.10**; selected sidebar row
`(235−216)/(235−61)` = **.11** (≈.10); checked toggle `(250−193)/(250−61)` =
**.30**; switch off track on a card `(255−226)/(255−61)` = **.15**. Dark gives
the same alphas against `247`: .10 / .105 / .30 / .15.

## Sizes

| | px |
|---|---|
| Header bar | 46 |
| Sidebar row (`navigation-sidebar`) | 36 |
| Boxed-list row (no subtitle and with one) | 50 |
| Button / entry / linked toggle | 34 |
| Switch | 46 × 26, knob white |
| Radius: button, entry, sidebar row, toggle group end | 6 |
| Radius: card, boxed list (and in the Yaru CSS: popover, dialog) | 12 |
| Body font | Ubuntu Sans 11 pt (14.67 px) |

The toggle group on GNOME 46 is linked toggle buttons (AdwToggleGroup is
libadwaita 1.7): one row of `.10` buttons, 1 px apart, outer corners 6 px,
the checked one at `.30`.

## AA corrections (the vetoes stand)

- Light dim text (146–153 on 250–255) is **2.8–3.0:1**: fails. `--text-2`
  becomes **92 92 92**, ≥ 5.5:1 on every light plane, sidebar included.
- Dark dim text (~158) is 5.2:1 on the window but **4.0:1 on a card (61)**:
  fails. `--text-2` becomes **172 172 172**, ≥ 4.6:1 on a card and popover.
- Yaru orange `233 84 32` carries white text at **3.5:1**: fails as a fill.
  The fill is darkened in OKLab until white reaches 4.5:1 (Y1); the switch
  track and other non-text accent shapes keep the same AA fill so there is
  one orange. Inks are clamped as A1 describes (`scripts/accents.mjs`).
- Status: a failed row uses `--bad` text and the destructive red, never the
  accent; both reds are kept visibly redder than Yaru orange (hue gap
  checked in the gate).

## Window corners (E4)

Electron 45 frameless windows on GNOME Wayland are drawn by the app (no
server-side decorations), and Mutter does not round client-drawn windows, so
they are **square**; Electron has no option that rounds them without
`transparent: true`. Square stays the default. This follows from how
frameless windows work on Wayland; it was not confirmed visually, since no
screenshot of the desktop can be taken here (see Method).

## Yaru gtk-4.0 stylesheet values (plain GTK 4 apps; reference only)

| | Light | Dark |
|---|---|---|
| `theme_bg_color` | #FAFAFA | #2C2C2C |
| `theme_base_color` | #FFFFFF | #272727 |
| `theme_fg_color` | #3D3D3D | #F7F7F7 |
| `theme_selected_bg_color` | #E95420 | #E95420 |
| `borders` | #CCCCCC | #131313 |
| `error_color` / `success_color` / `warning_color` | #C7162B / #109B26 / #F99B11 | same |
| headerbar `min-height` | 46 px | 46 px |
| common radii | 5, 6, 12 px; switch 14 px | |

## Cross-check: the user's own GNOME Settings screenshot

The user sent a screenshot of their GNOME Settings (Network panel, dark Yaru,
`docs/v4-demo/user-gnome-settings-reference.png`). Where it differs from the
renders above, the screenshot wins unless the contrast gate forbids it.

| | Screenshot | Calibration | Used |
|---|---|---|---|
| Sidebar / its header | 48 | 48 | 48 |
| Content / its header | 44 | 44 | 44 |
| Pane divider | 31 | 31 | 31 |
| Sidebar group separator | 79 | — | `--fill` at .15 (= 78 on 48) |
| Selected sidebar row | 69 | 69 | `--fill` .10 |
| Hovered sidebar row | 62 | — | `--fill` .07 (= 62) |
| Boxed-list card | 61 | 61 | 61 |
| Round caption button | 64, ~24 px | 64 | `--fill` .10, 24 px circle |
| Switch on | 233 84 32 | 233 84 32 | `--accent-bright` (raw Yaru orange, non-text) |
| Sidebar row height | ~44 | 36 (navigation-sidebar) | **44** (Settings' own rows) |
| Boxed row height | ~54 | 50 | ≥ 50, ~54 with the body line-height |
| Content clamp | ~560 | — | 600 max (AdwClamp), measured 560 at that width |
| Window corners | rounded | — | **square** (E4 veto: rounding needs `transparent: true`; deviation recorded) |

Structure copied from it: sidebar header with the title centred and a menu
button at the end; groups split by thin separators; a centred panel title in
the content header with round caption buttons; bold group titles with an
optional flat "+" on the title line; rows of an optional leading icon, the
label, then a switch, a flat icon button, or a dim value and a chevron.
