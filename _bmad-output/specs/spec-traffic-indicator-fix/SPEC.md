---
id: SPEC-traffic-indicator-fix
companions:
  - ../../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Traffic Indicator: fix always-Smooth, name the worst floor

## Why

A pain to solve. The Traffic HUD chip reads **"Smooth" for essentially every tower, forever** — a player with a 67-floor, 2,529-population tower at rush hour sees the same "Smooth" as an empty lot, so the indicator teaches players to ignore it. Root cause: the chip is fed `sim.congestion()` — a mean over populated-and-served floors scaled by a `÷12` headroom — and bucketed at thresholds (Busy `≥1.0`, Backed up `>1.25`, Gridlock `>1.6`) the engine's scale almost never reaches. Measurement across seven real saves of the same tower shows peak congestion of 0.17–0.29 (genuinely smooth), while the congestion overlay **legend already reads `peakCongestion()`** — so the game currently ships two traffic readouts wired to different numbers, a contradiction hidden only because the averaged one is always green. The chip must become a signal that actually moves as a tower loads up, and it must agree with the overlay it sits beside.

## Capabilities

- **CAP-1** — Peak-driven traffic signal
  - **intent:** The Traffic chip reflects the tower's busiest populated-and-served floor so it moves as real congestion develops, matching the congestion overlay legend and the 1994 spatial cues (red walkers, congestion heatmap).
  - **success:** `updateTraffic` reads `sim.peakCongestion()` (not `sim.congestion()`); a tower with a single jammed floor among healthy ones (measured peak 3.11) reports a non-Smooth tier, where the average (1.15) would understate it. A test asserts the chip and the overlay legend read the same underlying value.

- **CAP-2** — Thresholds calibrated to the engine's real range
  - **intent:** The four tiers each occur across an actual playthrough, derived from measured builds rather than the unreachable legacy cutoffs.
  - **success:** `trafficTier` boundaries are **Smooth `<0.4`, Busy `0.4–0.8`, Backed up `0.8–1.5`, Gridlock `>1.5`**, with the existing ±0.03 hysteresis retained. All seven real well-built saves (peak 0.17–0.29) map to Smooth; the fully-packed dense probe (peak 1.16) maps to Backed up; the localized-jam probe (peak 3.11) maps to Gridlock. Boundary unit tests assert each tier at and around its edges.

- **CAP-3** — Worst-floor readout (modern)
  - **intent:** Beyond naming the tier, the chip surfaces *where* the pressure is — the worst floor — something the 1994 original could not do because it had no traffic chip at all.
  - **success:** When the tier is above Smooth, the chip shows the tier plus the busiest floor (e.g. `Backed up · 42F`); at Smooth it shows no floor. The engine exposes the worst floor's number without formatting it; label formatting lives in the UI layer. A test asserts the surfaced floor equals the argmax of the per-floor congestion map.

- **CAP-4** — Honest decoupling of chip vs. red walkers
  - **intent:** Remove the false claim that the chip's tier-2 boundary aligns with the walker-red stress gate; document the chip as an early tower-level warning and red walkers as the acute per-person symptom.
  - **success:** The misleading comment in `src/engine/traffic.ts` is rewritten to state the two signals are distinct (chip = worst-floor peak; red walkers driven by `stress = clamp(congestion − 1)`), and no code path recouples them.

## Constraints

- **Do not modify** `stress = clamp(congestion − 1)` or any economy/satisfaction/stress math. Scope is limited to the chip's input signal, its tier thresholds, its comment, and its label.
- `src/engine/` stays free of DOM/rendering. The engine exposes the worst-floor number; the `"· NNF"` label string is composed in the UI layer (`src/main.ts`).
- The change is **mode-agnostic** — identical in Classic and Modern; no per-mode branching introduced into the simulation.
- Quality gates green before push: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Bump `package.json` `version` (patch for the fix; minor for the new worst-floor readout). Run `/gds-code-review` before push — a project non-negotiable, not optional.

## Non-goals

- **Softening blend** `max(avg, 0.7·peak)` — benched; adopt only if playtest shows straight peak is too twitchy on a single hot floor. Not in this change.
- **Tap-the-chip-to-fly-camera-to-hotspot** — a follow-up that touches input and camera; out of scope here.
- **Changing the congestion formula, headroom, or reachability model** — the `÷12` headroom and the strand-vs-congest behavior are correct and stay as-is.

## Success signal

Loading the player's own `towerone_6` save and reaching a rush hour, the chip still reads "Smooth" — because that tower genuinely is — but the moment a reachable floor is left under-served, the chip climbs through Busy → Backed up → Gridlock and names the offending floor, and it always agrees with the congestion overlay beside it. The indicator stops being decorative and starts being the thing a player watches.

## Assumptions

- `peakCongestion()` returns 0 when no floor is populated-and-served (a brand-new tower, or one whose floors are all stranded), so the chip reads Smooth in that state — unchanged from today's behavior and owned by the reachability system, not addressed here.
