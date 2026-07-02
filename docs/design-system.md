# Verticopolis Design System

The UI speaks one language: **Windows 3.1 / SimTower chrome** — gray faces,
two-pixel bevels, navy title bars, press-only feedback. This document is the
contract for anyone (human or agent) touching `src/styles.css` or UI markup.

The stylesheet (`src/styles.css`) is organized as **one generation of CSS in
five layers** — tokens → base → components → layout/surfaces → media. There is
no "skin layer" that overrides earlier rules; if you find yourself out-specifying
an existing rule instead of editing it, you are recreating the archaeology this
system replaced.

## 1. Tokens

Everything derives from `:root` custom properties. Swap these to re-theme.

| Token | Role |
| --- | --- |
| `--r-face` | chrome face (system gray) |
| `--r-hi` / `--r-light` / `--r-shadow` / `--r-dark` | bevel ramp |
| `--r-title` / `--r-title-fg` | title-bar navy / white |
| `--r-ink`, `--muted` | body / secondary text |
| `--r-desktop` | the teal desktop behind everything |
| `--good` / `--bad` / `--bad-ink` / `--money` | semantic states (bad-ink is the AA-safe danger text on gray) |
| `--bevel-out` / `--bevel-in` | the signature two-pixel bevels (raised / sunken) |
| `--win-shadow` | the one hard drop shadow floating windows cast |
| `--r-font` | the UI face (MS Sans Serif stack) |

**Rule: never hard-code a color that has a token.** Quote balance numbers from
the engine config; quote colors from here.

## 2. Components

Skin lives on **classes**, never on IDs. IDs may appear in the layout layer for
positioning/sizing only.

### `.btn` — the button
Gray face, bevel out; `:active` = bevel in. **No hover state on purpose** —
period chrome gives press feedback only (list rows like `.pal-item` may hover;
buttons may not).

- `.btn.primary` — the classic **default button**: an extra dark ring
  (`0 0 0 1px var(--r-dark)`) + bold label. *One primary per dialog.* Its DOM
  position encodes default focus: **first** when the primary should own focus
  (the emergency's Pay), **last** when the safe action must be reached first
  (destructive confirms). Don't reorder for looks.
- `.btn.danger` — red bold label (`--bad-ink`) on the same chrome. Destructive
  actions only (Sell/Bulldoze, slot delete).
- `:disabled` — classic GrayText (`--r-shadow`) on the same raised chrome,
  default cursor. Never hide a disabled button; show why it can't be pressed.
- `.btn.xs` — title-bar size: the ✕ in window title bars, the coach's Skip
  button. It NEVER grows on touch — a 36px ✕ inflates every navy bar and a
  wider one stretches into a pill (both shipped bugs, since fixed). Instead,
  coarse pointers get an invisible tap halo (`::after { inset: -8px }`) for a
  ~34px effective target with zero visual change. In TS there are exactly two
  ✕ builders — `UI`'s private `titleBarClose()` for DOM-built ✕s (modal,
  inspector) and `ui/editorHtml.ts`'s `editorTitleBar()` template for the
  editor card. Never hand-write a third copy; extend one of those.

### `.win` — a floating window
Gray face + `--bevel-out` + `--win-shadow`. Applied to: the modal box, the
editor card, the inspector card, the hint strip, the onboarding coach card.
`.win.docked` (palette, sidebar, its panels) keeps the face/bevel but drops
the floating drop shadow.

### `.win-title` — the title bar
Navy, white, bold, 13px, `3px 8px` padding, flex with the ✕ (`.btn.xs`) pinned
right via `margin-left: auto`. Every dismissible window wears one; the modal's
is sticky and full-bleed (negative margins derived from the `--pad-y`/`--pad-x`
tokens on `.modal-box` — never hand-write those offsets).

`.win-title.sm` is the explicit mini variant (11px, uppercase, `2px 6px`)
for section strips inside a window — the statistics dialog's
Overview/Tenancy/Milestones headers use it. The palette's "Tools" strip is a
full-size `.win-title`; the sidebar `.panel h3` headers are the same idiom at
panel scale (10px, uppercase) — a deliberate size step-down, not a divergence.

### `.well` — sunken white data area
`--r-hi` + `--bevel-in`. The File Manager idiom: the Bulletin log, the saves
slot list, the stops checklist, dialog textareas all sit on wells.

### `.field` — a text input
A well you type into (same recipe + `font: inherit`).

### `.kv` — key/value grid
Two columns (`1fr auto`), muted keys, right-aligned tabular values. Used by the
editor stats, sidebar tower stats, and statistics-dialog columns (milestone
columns override to left-aligned descriptions).

### `.toast` / `.evalbar`
Toast = small gray alert, left edge colored by kind (`good`/`bad`/`money`).
Evalbar = the original-style sunken satisfaction gauge.

## 3. The window grammar

Every dismissible floating surface is a **window**: `.win` frame + `.win-title`
bar + `.btn.xs` ✕. The modal ✕ routes through the dialog's **cancel path**
(same as Esc) — never call `closeModal()` directly from a close affordance, or
modals that resolve a pending choice (the emergency dialog) will deadlock the
paused sim. The ✕ is appended **after** `showModal()` so keyboard focus lands
on the primary action, not on dismiss.

## 4. The splash exception (ratified)

The first-run splash is **box art, not UI**: it keeps its dusk palette and
cream/amber buttons (`.splash-btn`), and the amber primary never leaves the
splash. It shares interaction grammar only — bevel press states and a visible
(amber) focus ring. Do not "unify" it into the gray chrome.

## 5. Touch & accessibility

- `pointer: coarse` → dialog/editor buttons get `min-height: 36px`.
- Focus is always visible: navy `:focus-visible` ring globally, amber on the
  splash (navy vanishes on the night sky).
- Reduced motion (OS preference or the in-game toggle) disables all decorative
  CSS animation; the engine freezes canvas ambience separately.
- The traffic cue carries its level in glyph shape, not color alone.

## 6. Rules of engagement

1. **No skin on IDs.** Surface-specific *classes* may tune skin using the
   tokens; IDs never paint chrome. Two annotated one-offs are grandfathered:
   `#topbar`'s raised strip and `#stage`'s sunken viewport.
2. **Edit, don't override.** One generation of CSS: change the rule that owns
   the property; never add a later rule to win by specificity.
3. **New surface?** Compose it from `.win`/`.win-title`/`.btn`/`.well` before
   inventing anything.
4. **One primary per dialog.** Its DOM position is a focus decision, not a
   style one (see `.btn.primary`). Danger is a label color, not a new button
   shape.
5. **Press-only feedback on buttons.** No `:hover` chrome.
6. **One mobile block** (`max-width: 860px`) — add responsive tweaks there, not
   in new scattered queries.
