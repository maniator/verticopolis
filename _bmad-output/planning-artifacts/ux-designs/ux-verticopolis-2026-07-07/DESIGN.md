---
title: Verticopolis — Responsive layout tokens (tablet tier)
status: final
updated: 2026-07-07
scope: responsive/layout only (not a full visual-identity spine)
tokens:
  spacing:
    breakpoint.phone.max: 767px
    breakpoint.tablet.min: 768px
    breakpoint.tablet.max: 1023px
    breakpoint.tablet.minHeight: 600px
    breakpoint.desktop.min: 1024px
    col.palette.desktop: 176px
    col.palette.tablet: 150px
    col.sidebar.desktop: 232px
    col.sidebar.tablet: 200px
    touch.palette.minHeight: 40px
---

> **Canonical layout contract.** These tokens govern the responsive column sizing
> and breakpoint bounds. This file is scoped to the responsive/layout concern; it
> is **not** the game's full visual identity. Behavior is in `EXPERIENCE.md`.

# Brand & Style

Retro SimTower-era desktop chrome — beveled gray "windows," navy title bars,
tabular numeric readouts. The tablet tier preserves this look exactly; it only
re-flows the existing chrome, never restyles it.

# Layout & Spacing

Three responsive tiers, gated by width **and height** (height disambiguates a
portrait tablet from a short landscape phone):

| Tier | Applies when | Palette | Sidebar | Top bar |
| --- | --- | --- | --- | --- |
| Phone | `max-width: 767px` **or** (`max-width: 1023px` and `max-height: 599px`) | bottom strip (118px) | slide-in drawer (☰) | wraps; stats on row 2 |
| **Tablet** | `min-width: 768px` and `max-width: 1023px` and `min-height: 600px` | **docked, 150px** | **docked, 200px** | **wraps; stats on row 2** |
| Desktop | `min-width: 1024px` | docked, 176px | docked, 232px | single row |

- The tablet column widths (`{spacing.col.palette.tablet}` 150px,
  `{spacing.col.sidebar.tablet}` 200px) are tighter than desktop so the canvas
  keeps ~400px+ at the 768px edge and ~665px at 1023px.
- Touch: palette rows grow to `{spacing.touch.palette.minHeight}` (40px) on the
  tablet tier; all other retro sizing is unchanged. `pointer: coarse` continues to
  size dialog/editor buttons and the title-bar ✕ tap-halo.

# Do's and Don'ts

- **Do** re-flow the existing markup with CSS only; keep `src/engine/` DOM-free.
- **Do** keep the tablet look identical to desktop chrome — just re-sized.
- **Don't** introduce the phone bottom-strip or drawer on tablet; docked panels
  are the point of the tier.
- **Don't** shrink the top-bar font to fit; wrap the stats row instead.
