---
title: "UX Spec — Palette Unlock Visibility (hide locked facilities until their star tier)"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer — BMAD gds agent)
date: 2026-07-07
status: Ready for dev
scope: UX/UI presentation of the build palette only. Bring locked-facility
  presentation to parity with the 1994 original — tools are HIDDEN until their
  star tier is reached, then revealed on star-up. No change to unlock
  thresholds (`minStar`), placement rules, costs, or any simulated value.
grounds:
  - src/ui/UI.ts buildPalette (~L107), facilityButton (~L159), update palette
    loop (~L424) — the current grayed-out presentation
  - src/engine/facilities.ts minStar per facility (canonical, unchanged);
    ALL_KINDS (~L314), GROUPS in UI.ts (~L22)
  - src/engine/Simulation.ts isUnlocked, capReason (~L440/L529),
    star-up emit "reached N stars" (~L1668) — the existing star-up telegraph
  - src/styles.css .pal-item.locked / .unaffordable (~L451) — the dimming CSS
  - _bmad-output/planning-artifacts/reviews/faq-parity-2026-06-30/faq-parity-audit.md §2
    (unlock ladder thresholds — already faithful; only presentation drifts)
---

# UX Spec — Palette Unlock Visibility

> **The rule of this pass:** the build palette should *grow* as the tower earns
> stars, exactly like the 1994 original — a new tier of tools appears the moment
> you reach the star that unlocks it. A facility the player cannot yet build is
> **not on the palette at all**; it is not shown grayed-out with an "unlocks at
> N★" hint. This is a pure presentation change. Not one `minStar`, cost,
> placement rule, or simulated number moves.

## 0. The parity gap (why this pass exists)

| | Original SimTower | Verticopolis today |
|---|---|---|
| Locked facility | **Hidden** — the tool only appears in the palette once its star tier is reached; the toolbar visibly expands on star-up | **Shown but dimmed** (`.pal-item.locked` → `opacity: 0.72`, `cursor: not-allowed`) with an "unlocks at N★" toast on click |

The unlock *thresholds* (`minStar`) were corrected to canon in the 2026-06-30
FAQ parity audit (§2) and are **not** in scope here. Only the presentation
diverges: the original hides, the clone grays out. This pass closes that gap.

## 1. Design principles (the guardrails)

1. **The palette is a reward, not a checklist.** The original never showed a
   full menu of locked tools. Reaching a new star *reveals* its tools — that
   reveal is part of the progression payoff. A dimmed-but-visible row spoils the
   reveal and turns a reward into a nag ("you can't have this yet").
2. **Hidden means hidden.** A locked facility has no button, no swatch, no
   tooltip, no tab stop, no click handler firing a toast. It simply is not in
   the DOM's visible flow until unlocked.
3. **Reveal is silent and automatic.** When the star rises, the newly-unlocked
   tools appear on the next palette refresh. No new toast, no highlight, no
   animation is added by this pass — the existing star-up event
   ("Congratulations! Your tower reached N stars.", `Simulation.ts:1668`) is
   already the telegraph that new tools are available. We do not double-announce.
4. **Affordability is orthogonal and unchanged.** An *unlocked* facility the
   player cannot currently afford stays visible and keeps its
   `.unaffordable` dimming — the original let you see tools you couldn't yet
   pay for. This pass touches only the *locked* state, never the
   *unaffordable* state.
5. **No dangling headers.** A palette group whose every member is still locked
   must hide its header too. At 1★ that is **Leisure**, **Services**, and
   **Special** (see §3) — three empty section titles would otherwise sit above
   nothing.

## 2. The change

### 2a. Hide locked facility buttons
In the palette refresh (`UI.update`, the `.pal-item[data-kind]` loop), a locked
facility (`!sim.isUnlocked(kind)`) is **not rendered visible** — replace the
current `classList.toggle("locked", …)` dimming with a visibility toggle that
removes the button from layout and the tab order (`display: none`, e.g. a
`hidden` class or the existing `.locked` class re-defined to `display: none`).
Unaffordable-but-unlocked buttons keep the `.unaffordable` dimming exactly as
today.

### 2b. Remove the locked-click affordance
The locked branch in `facilityButton` that shows the "`{name}` unlocks at N★."
toast becomes dead once buttons are hidden — remove it. A hidden button cannot
be clicked, focused, or activated by keyboard, so there is nothing to toast.
(The identical "unlocks at N★" reason string still lives in the engine's
`capReason`/build-guard path — that is the authoritative rejection if a build is
attempted programmatically, and it is **out of scope**; leave it untouched.)

### 2c. Hide empty group headers
Each palette group header must hide when none of its facilities are currently
unlocked. Give each group header and each facility button a shared group
marker (e.g. `data-group` set from the `GROUPS` title), and in the refresh,
after toggling item visibility, hide a header iff it has zero visible members.
The always-present **Tools** row (Inspect / Bulldoze) is not a facility group
and is never hidden.

### 2d. Retire the now-unused `.locked` dimming CSS
`.pal-item.locked { opacity: .72; cursor: not-allowed }` no longer represents a
visible state. Either repurpose `.locked` to `display: none` or delete it in
favor of a `hidden`/`display:none` toggle — one source of truth, no dead rule.
`.unaffordable` stays.

## 3. Expected palette by star (acceptance fixture)

Derived from `facilities.ts` `minStar` (canonical). "▸" = header visible.

| Group | 1★ | 2★ (+300) | 3★ (+1,000) | 4★ | 5★ |
|---|---|---|---|---|---|
| Structure | Lobby, Floor | = | = | = | = |
| Transport | Stairway, Std Elevator | + Service Elevator | + Escalator, Express Elevator | = | = |
| Commercial | Office, Fast Food | = | + Restaurant, Retail Shop | = | = |
| Living | Condominium | + Single Room | + Double Room, Suite | = | = |
| Leisure | *(header hidden)* | *(hidden)* | ▸ Cinema, Party Hall | = | = |
| Services | *(header hidden)* | ▸ Security, Housekeeping | + Parking Ramp, Parking Space, Medical, Recycling | = | = |
| Special | *(header hidden)* | *(hidden)* | *(hidden)* | ▸ Metro Station | + Wedding Hall |

At 1★ exactly four group headers are visible (Structure, Transport, Commercial,
Living); Leisure/Services/Special are hidden. Each subsequent star reveals the
rows in its column with no page reload — the palette grows in place.

## 4. What NOT to do (the restraint contract)

- **No new star-up announcement.** The reveal rides on the existing
  "reached N stars" event. Do not add a toast, banner, badge, glow, or
  animation for newly-unlocked tools. Parity is a quiet, growing toolbar.
- **No engine changes.** `minStar`, `isUnlocked`, `capReason`, costs, placement
  guards, and every simulated value are untouched. This is a DOM-visibility
  change in `UI.ts` + a CSS rule. If a diff hunk lands outside `src/ui/UI.ts`
  or `src/styles.css`, it is out of scope (the sole exception: the dead
  facility-button toast branch, which is in `UI.ts`).
- **No change to affordability behavior.** Unlocked-but-unaffordable tools stay
  visible and dimmed as today. Do not conflate "can't afford" with "locked".
- **No discoverability tooltip.** Do not add a "coming at N★" hint elsewhere
  (a preview list, a locked-count badge, etc.). The original offered none; the
  reveal is the information.
- **No leftover dead code.** The removed toast branch and the retired `.locked`
  dimming rule must both go — no commented-out husks, no orphaned CSS.

## 5. Acceptance criteria

1. At 1★, the palette shows only: Tools; Structure (Lobby, Floor); Transport
   (Stairway, Standard Elevator); Commercial (Office, Fast Food); Living
   (Condominium). No Leisure, Services, or Special header is present. No locked
   facility appears dimmed or otherwise.
2. Reaching 2★ reveals Single Room under Living and makes the Services header
   appear with Security + Housekeeping — with no reload, on the next refresh.
   Reaching 3★ reveals the Leisure header (Cinema, Party Hall) and the full
   3★ row across Transport/Commercial/Living/Services. 4★ reveals the Special
   header with Metro Station; 5★ adds Wedding Hall.
3. A locked facility cannot be selected by mouse *or* keyboard — its button is
   absent from the DOM's visible flow and from the tab order. No "unlocks at
   N★" toast can be produced from the palette.
4. An unlocked facility the player cannot afford is still visible and shows the
   existing `.unaffordable` dimming; buying/placing it behaves exactly as before.
5. No group header is ever shown with zero visible facilities beneath it, at any
   star level.
6. No simulated value, unlock threshold, cost, placement rule, or parity/balance
   test changes. Only `src/ui/UI.ts` and `src/styles.css` are touched.
