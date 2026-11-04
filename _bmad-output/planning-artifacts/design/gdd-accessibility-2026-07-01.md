---
game: Verticopolis (browser SimTower clone)
doc: Accessibility UX (GDD)
date: 2026-07-01
resolves: PRD Open Question 6
author: Samus Shepard (Game Designer, UX) — facilitated convergence
status: Agreed for build (v1 scope frozen)
---

# Accessibility UX — Verticopolis

This is the designer-facing UX spec for the accessibility pass. It resolves PRD Open
Question 6 (color-blind cue / full keyboard play / reduced motion). The companion tech
plan is `arch-accessibility-2026-07-01.md`.

## Design principles (non-negotiable)

- **Faithful** — the SimTower '94 look and tone is preserved. Accessibility is *additive
  redundancy*, never a reskin. Every color cue stays; we add a second, hue-independent channel.
- **Restrained** — smallest surface that clears the bar. Ship the three sub-features, defer
  the nice-to-haves (shaft overlay) to phase-2.
- **Deterministic** — render/UI layer only. Nothing here reads or writes sim state, RNG,
  or the `anim` clock that the sim consumes. Same seed ⇒ same tower, mouse or keyboard.
- **Save-safe** — prefs derive from OS media queries plus a local override key; never
  serialized into the tower save blob. A save opened elsewhere adopts that machine's OS prefs.
- **Diegesis-respecting** — DOM owns chrome/readouts/dialogs; the engine owns world-anchored,
  camera-tracked cues (per the diegesis memo, PR #45).

## Agreed v1 scope (frozen)

All three sub-features are IN. Two are already half-built (keyboard palette F48,
reduced-motion CSS F49); finishing them is lower-risk than leaving them half-done.

| # | Feature | In v1 | Deferred |
|---|---------|-------|----------|
| A1 | Color-blind-safe traffic cue | HUD Traffic chip (word + bar-count glyph); per-walker fed-up glyph; dead-parking X halo | Congested-band shaft hatch overlay → **phase-2** |
| A2 | Full keyboard play | Build cursor, pan/zoom/place/inspect/bulldoze/span keys, editor Extend buttons, focus-trapped modals, `:focus-visible`, minimal aria-live announcer | — |
| A3 | Reduced motion | Engine-canvas gating (walkers, street train, clouds, rain streaks, day/night, splash) + CSS mirror + in-game toggle | — |

New FRs: **F50** (traffic cue), **F51** (keyboard play), **F52** (engine reduced-motion).

---

## A1 — Color-blind-safe congestion / stress cue

**Problem.** Frustration reads through hue alone: walkers flip to red (`#C24A3A`) when
`impatient && stress > 0.25`, with no always-on readout. Red-on-neutral is exactly the
deuteran/protan failure case, and "notice the color" is the failing channel itself.

**Fix — redundant encoding (word + shape + count), red kept as the fourth channel.**

### Cue 1 — HUD Traffic readout (PRIMARY, DOM chrome)

A small persistent readout in the HUD toolbar labelled **TRAFFIC**, driven by discrete
deterministic tiers of `sim.congestion()`:

| Tier | `congestion()` | walker red? | Label | Bar glyph (count-ramp, hue-independent) |
|------|----------------|-------------|-------|------------------------------------------|
| 0 | < 1.0 | no | **Smooth** | ▁ |
| 1 | 1.0 – 1.25 | no | **Busy** | ▁▃ |
| 2 | 1.25 – 1.6 | yes | **Backed up** | ▁▃▅ |
| 3 | > 1.6 | yes | **Gridlock** | ▁▃▅▇ |

- The tier is fully recoverable from **label + bar count with color stripped** (survives a
  grayscale screenshot). Color may still tint green→amber→red as a bonus channel.
- Boundaries chosen so **tier ≥ 2 is exactly when walkers start turning red** — HUD and world agree.
- ±0.03 hysteresis on boundaries so the readout doesn't flicker at a threshold (cosmetic only).
- Carries `aria-live="polite"`; `aria-label` reads e.g. `"Traffic: Backed up"` — this is also
  the screen-reader congestion channel (feeds the A2 announcer).

### Cue 2 — Per-walker fed-up glyph (SECONDARY, engine, world-anchored)

Keep the red tint; **add a shape** — a small static "!" / spark cluster with a high-luminance
halo above the head of any fed-up figure. Static (reduced-motion safe). Zoom-in nicety only;
at overview zoom it's sub-pixel and simply doesn't draw — Cue 1 covers the zoomed-out case.

### Cue 3 — dead-parking X halo (engine, world-anchored)

The dead-parking red X gets a 1px dark under-stroke so the *shape* carries meaning independent
of hue. Trivial hardening of an already-non-color cue.

### Deferred to phase-2 — congested-band shaft overlay

Diagonal hatch texture + tier badge on shaft segments over tier 2, gated behind a "show
congestion" view toggle. Genuinely useful (which shaft is choking) but out of the restrained
v1 surface. Documented here so it isn't re-litigated.

### Wording

Diegetic and terse: title **TRAFFIC**; states **Smooth / Busy / Backed up / Gridlock**. No
clinical terms. Strings live in one place for future localization.

---

## A2 — Keyboard play model

**Goal.** A player with no pointer can do everything the pointer does: pan, zoom, move a
placement cursor, place, inspect, bulldoze, extend shafts, set speed, and operate every dialog.
Builds on existing palette activation (`makeActivatable`) and speed keys 0–3.

### Focus model — two zones

1. **Chrome focus (DOM):** `Tab` / `Shift+Tab` cycle toolbar, palette, editor/inspector cards.
   Palette items already `tabIndex=0 role=button`.
2. **Canvas build-cursor (engine):** canvas gets `tabindex=0`, `role="application"`,
   `aria-label="Tower — build area"`. When focused, a **virtual build cursor** (one highlighted
   cell) exists in world space and feeds `(tile, floor)` into the *same* preview pipeline the
   mouse hover uses — validity shading, snapping, cost preview all work for free. The camera
   follows the cursor (auto-pan), so moving the cursor *is* panning; there is no separate pan mode.

### Key map

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle chrome focus; Tab into canvas activates the build cursor |
| Arrows / WASD | Move cursor 1 tile (←/→) or 1 floor (↑/↓); camera follows |
| `Shift`+Arrows | Coarse move (×10 tiles / floor band); with no tool = fast camera pan |
| `Enter` / `Space` | Act at cursor per tool: **build** places, **inspect** selects, **bulldoze** removes |
| `Enter` (span tools: floor/lobby/transport) | 1st press sets run **anchor**; move; 2nd press **commits**; `Esc` cancels the run |
| `Esc` | Cancel in-progress span → else cancel tool (→ inspect) → else close top dialog |
| `+` / `=` | Zoom in (centered); `-` | Zoom out |
| `0`–`3` | Sim speed (existing) |
| `C` / `Home` | Recenter camera on the ground lobby |
| `Delete` / `Backspace` / `X` | Bulldoze at cursor |
| `[` / `]` | Cycle selectable entity near cursor |

### Shaft extend without a mouse

In-world extend arrows are drag targets — awkward on a keyboard, and we do **not** rebuild
them. Instead add **"Extend up" / "Extend down"** buttons to the selected-elevator editor card
(DOM), which call the same `onExtendTo(end, targetFloor±1)` the drag calls. Keyboard extend =
chrome buttons. No sim divergence, diegesis-respecting.

### Dialogs & the emergency modal

- All modals **focus-trapped**; `Enter` confirms default, `Tab` cycles choices.
- The emergency modal (fire-rescue / bomb — canon: **pauses the sim, demands a decision**) is a
  forced choice: `Esc` must **not** dismiss it. Tab between buttons, `Enter` to pick.

### Screen-reader channel (aria-live announcer, minimal)

One visually-hidden `aria-live="polite"` region (DOM chrome) that announces:

- **Cursor readout on move:** `"Floor 12, Office, $40k, buildable"` / `"blocked"` — makes
  inspect usable and placement validity audible.
- **Event surfacing:** route the entries that already toast (`good`/`bad`) into the announcer —
  fires, move-outs, star-ups, and the Traffic tier crossing into **Gridlock**.

Same information sighted players get from preview shading and toasts, on an accessible channel.
No new game state.

---

## A3 — Reduced-motion policy

**Problem.** `prefers-reduced-motion` today only reaches DOM/CSS (toast slides, panel
transitions). The engine canvas — pacing walkers, elevator cars, rain, day/night crossfade,
splash — is ungated, and that is where the vestibular load actually lives.

**Mechanism.** Engine reads `matchMedia("(prefers-reduced-motion: reduce)")` once, subscribes
to `change`, and exposes a `reducedMotion` boolean via `setReducedMotion()`. It gates
render/interpolation only — never the sim, never the `anim` counter the sim reads. Because
affected motion is cosmetic (positions derive from `anim`, not the reverse), suppression cannot
change outcomes → deterministic and save-safe.

### What changes with reduced motion on

| Element | Full-motion | Reduced-motion | Info preserved by |
|---------|-------------|----------------|-------------------|
| Walkers | Ping-pong pacing | Render static at rest; still spawn/despawn hourly | Crowd density unchanged |
| Elevator cars | Slide between floors | Snap to current served floor | Position still shown |
| Street train | Slides in/out | Pinned at platform | Presence still shown |
| Clouds | Drift | One static frame | Sky still legible |
| Weather rain | Falling streaks | Streaks off; **keep overcast tint** | Tint + event log |
| Day/night | Crossfade | Instant state switch (lights, sky-by-hour) | Lights state |
| Splash / onboarding | Zoom/fade + pulse | Final frame directly; pulse already honors it (F49) | — |
| Toasts / panels | CSS slide | Already killed by existing media query | — |
| Camera cursor-follow (A2) | Smooth scroll | Snap to keep cursor on-screen | — |

**Legibility guarantee:** every removed motion has a static fallback that preserves what the
motion communicated (rain→overcast+log; night→lights; walkers→still crowd density).

---

## Preferences, storage & override (cross-cutting)

- **Defaults from OS:** `prefers-reduced-motion` (and optionally `prefers-contrast`) honored
  automatically — zero-config for most users.
- **In-game overrides:** a small Options/Help section — *Reduce motion*, *High-visibility
  traffic cues* (forces the phase-2 shaft overlay + per-walker glyph on when it ships),
  *Announce events*. Opt-in without changing OS settings.
- **Save-safe:** persisted to a dedicated `localStorage` key **`vc.prefs`** (shape
  `{ reducedMotion?, colorblindCue? }`), never written into the save blob.

## Touch points (dev handoff, absolute paths)

- `<home>/projects/simtower-llm-style/src/render/excalibur/TowerEngine.ts` — `d.stress`,
  crowd/red draw loop, rain, day/night, elevator cars, camera follow; add `reducedMotion` flag,
  per-walker glyph, X halo.
- `<home>/projects/simtower-llm-style/src/ui/UI.ts` — `makeActivatable`, `showEditor`/
  `[data-edit]` for Extend buttons, `toast` → announcer; HUD Traffic readout + aria-live region.
- `<home>/projects/simtower-llm-style/src/main.ts` — `bindKeys`, `updateBuildPreview`
  reused by cursor; cursor/pan/zoom/place keys; reduced-motion wiring.
- `<home>/projects/simtower-llm-style/src/render/pixelSprites.ts` — `person()` tint path
  for the fed-up glyph.
- `<home>/projects/simtower-llm-style/src/styles.css` — reduced-motion block;
  `html.reduce-motion` mirror; `#traffic` chip states; `.sr-only`; `:focus-visible`.
- `<home>/projects/simtower-llm-style/src/engine/Simulation.ts` — `congestion()` /
  `congestionAt()` for tiering (read-only).
