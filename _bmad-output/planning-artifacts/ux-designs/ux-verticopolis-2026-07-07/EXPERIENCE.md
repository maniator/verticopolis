---
title: Verticopolis — Responsive behavior (tablet tier)
status: final
updated: 2026-07-07
scope: responsive/layout only
design: ./DESIGN.md
---

> **Canonical behavior contract.** Scoped to the responsive/layout concern. Visual
> tokens live in `DESIGN.md` and are referenced as `{spacing.*}`. Spines win over
> any mock on conflict.

# Foundation

- **Form factors:** desktop (mouse), tablet (touch, portrait + the 861–1023
  compact band), phone (touch). Browser client; all layout is CSS in
  `src/styles.css` over the existing `index.html` markup. No engine/DOM coupling.
- **Structure (unchanged):** `#app` → `#topbar` (brand · stat chips · speed/undo/
  redo/sound) + `#main` (`#palette` · `#stage` canvas · `#sidebar` panels).

# Information Architecture

The three surfaces a player needs at a glance — **tools** (`#palette`), **the
tower** (`#stage`), and **status** (`#sidebar`: SELECTED / TOWER / BULLETIN /
GAME) — must all stay reachable. Phone trades always-visible status for canvas
(drawer). Tablet has room to keep **all three docked at once**; that is the tier's
reason to exist.

# Responsive & Platform

Three tiers (see `DESIGN.md` → Layout & Spacing for the token table):

- **Phone** — `max-width: 767px`, or a short landscape screen
  (`max-width: 1023px and max-height: 599px`). Bottom tool strip + panel drawer.
  Unchanged from today, only the query bound moves (860 → 767 / short).
- **Tablet** — `min-width: 768px and max-width: 1023px and min-height: 600px`:
  - **Top bar wraps** — stat chips drop to a full-width second row; the brand and
    speed/undo/redo/sound buttons stay on row one, never clipping. (Fixes the
    900px cram.)
  - **Palette docked**, `{spacing.col.palette.tablet}` (150px) — the full tool
    list, not the phone strip. `#panel-toggle` (☰) hidden.
  - **Sidebar docked**, `{spacing.col.sidebar.tablet}` (200px) — panels always
    visible, no drawer/scrim.
  - **Canvas** takes the remainder (~400px at 768 → ~665px at 1023).
  - **Touch targets** — palette rows ≥ `{spacing.touch.palette.minHeight}` (40px);
    `pointer: coarse` covers dialog/editor buttons and the ✕ halo.
- **Desktop** — `min-width: 1024px`: the existing 3-column layout, untouched.

**Height rationale:** width alone can't separate a portrait tablet (768×1024,
tall) from a landscape phone (844×390, wide but short). The `min-height: 600px`
gate routes tall mid-width screens to the roomy tablet layout and short ones to
the phone drawer, which is what each actually needs.

# State Patterns

- **Orientation flip (tablet):** portrait 768×1024 → landscape 1024×768 crosses
  the 1024 bound into desktop; both are docked 3-column, so the transition is a
  smooth resize, no relayout jump. Portrait → phone only if the device is under
  768px or under 600px tall.
- **Edge degradation:** at exactly 767/768px and 599/600px the layout swaps tiers
  cleanly because the tablet block only *tweaks* the base desktop layout (column
  widths, topbar wrap, tap sizing) — there is no separate tablet DOM to build or
  tear down.

# Accessibility Floor

- Every primary surface (tools, tower, status) stays visible on tablet — no action
  is hidden behind a toggle, reducing interaction cost on touch.
- Touch targets meet a ~40px comfortable minimum on the tools list; existing
  `pointer: coarse` rules keep dialog actions and close buttons tappable.
- Color-blind-safe cues (e.g. the traffic glyph) and `aria-live` readouts are
  layout-independent and carry across tiers unchanged.

# Key Flows

**Priya, on an iPad in portrait (768×1024), builds her first tower.**
1. She opens the game upright; instead of the phone's cramped bottom strip, she
   sees the full **Tools** list docked on the left and the **Tower/Bulletin**
   panels docked on the right — the desktop layout, sized to fit.
2. The top bar shows brand + speed controls on one line with the stat chips on a
   tidy second row; nothing is clipped or wrapped mid-word.
3. She taps **Floor**, then **Office** — the 40px rows are easy to hit — and paints
   a floor on the tall canvas, panning horizontally as the tower widens.
4. **Climax:** she rotates to landscape (1024×768); the layout simply widens into
   the full desktop view without a jarring relayout — same panels, more canvas —
   and she keeps building without losing her place.
