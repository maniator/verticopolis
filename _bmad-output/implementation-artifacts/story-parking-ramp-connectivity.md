# Story: Parking-ramp 1994 connectivity parity

Status: **GATED — needs its own GDD/arch spec + its own SAVE_VERSION bump before dev.** Do NOT fold into the SimTower segment-parity initiative (gdd/arch/epics-simtower-parity-2026-07-06).

<!-- Deferred from the SimTower parity initiative by a party-mode decision (Cloud Dragonborn / Samus Shepard / Link Freeman), 2026-07-07. This is a tracked follow-up, not a dev-ready story — the next actionable step is writing its spec, not coding. -->

## Story

As a **player who knows the 1994 original**,
I want **parking ramps to work like SimTower's — a ramp column that descends from under the lobby, where a floor's parking only functions if its ramp connects up the stack to the entrance**,
so that **ramp placement is a real strategic decision (a connected spine), not a per-floor participation trophy**.

## Acceptance Criteria

1. The **first/top ramp must sit under (or adjacent to) a lobby**; a ramp with no lobby above its column is not a valid entrance.
2. Ramps must be **vertically stacked/aligned** to connect basement floors into one column.
3. A parking space functions **only if its floor's ramp chain connects up the column to the lobby entrance** — replacing the current per-ramp independent-seed model in `functionalParkingSet` (`Tower.ts:971`).
4. **Healing migration (must-have #1):** the migration **builds the missing ramp column up to the lobby** so **no existing tower loads with newly-dead parking**. "Heal, don't harm."
5. **One regime change per load (must-have #2):** this ships in its **own** `SAVE_VERSION` bump and migration — **never** combined with the W1/W2/W3 pedestrian-penalty rollout, so a player can attribute any change.
6. **Loud telegraph (must-have #3):** the repair emits **one honest toast** (e.g. "Connected your parking ramps to the lobby — 1994 rule"), never a silent mutation.
7. **No split-brain (must-have #4):** no permanent legacy-seed flag in `functionalParkingSet`; connectivity applies to **all** towers once shipped (which is *why* the healing migration is mandatory).
8. Player legibility: when a lot is dead for lack of a connected ramp column, the inspector/nudge explains *why* (missing ramp to the lobby), consistent with the telegraphed-pressure guardrails (gdd-legibility §0).

## Tasks / Subtasks

- [ ] **Spec first (BLOCKING):** write the follow-up GDD + arch for this story (the deferral's whole point). Decide the connectivity model (vertical flood-fill from lobby down the ramp column), the healing-migration algorithm, and the toast copy. (AC: all)
- [ ] Replace the per-ramp seed in `functionalParkingSet` with lobby-anchored ramp-column connectivity. (AC: 1,2,3,7)
- [ ] New `SAVE_VERSION` bump + healing migration that builds the missing ramp column to the lobby. (AC: 4,5,6)
- [ ] Inspector/nudge legibility for a disconnected lot. (AC: 8)
- [ ] Tests: connectivity flood-fill; healing migration on a fixture with an island ramp (asserts 0 newly-dead parking + toast fired); no-split-brain (all towers use one rule).
- [ ] `/gds-code-review` + version bump + gates.

## Dev Notes

- **Current behavior to replace:** `functionalParkingSet` (`Tower.ts:971`) seeds the flood-fill from *every* operational ramp, so each floor's ramp independently makes its floor's horizontally-chained parking functional — ramps needn't align or reach the lobby.
- **Migration seam:** `Simulation.ts` `SAVE_VERSION` (§1.0 of the parity arch names the three version systems — this needs the *next* schema bump after the initiative's 1→2) and the `migrateSave` chain seam.
- **Why deferred, not rejected:** design merits are sound (more faithful, more strategic depth). Deferral is purely sequencing/legibility — it's a **load-time spatial-regime change** and **W1 (transport-too-far) already is one**; shipping both in one migration makes the change unattributable to the player.
- **Reflow interaction:** the initiative's reflow already **anchors ramps at their original x** (keeps columns aligned), which is a helpful precondition but is *not* "connected to the lobby" — this story adds the connectivity requirement and the healing repair.

### Testing standards summary

- Engine stays DOM/render-free; connectivity + migration are pure/deterministic (headless), like the rest of the save path. Golden-fixture style (a hand-built save with an island ramp) mirrors the initiative's `towerone_6` fixture approach.

### References

- [Source: _bmad-output/planning-artifacts/design/arch-simtower-parity-2026-07-06.md#1 (save-migration model, version systems)]
- [Source: _bmad-output/planning-artifacts/design/gdd-simtower-parity-2026-07-06.md#pillars (canon-first; inform-before-you-hurt)]
- [Source: _bmad-output/implementation-artifacts/backlog.md (2026-07-07 parking-ramp-connectivity P2 row)]
- [Source: src/engine/Tower.ts:971 functionalParkingSet]
- [Source: kiwizoid GameFAQs FAQ; Relentless Optimizer reference — 1994 ramp stacking rules]

## Dev Agent Record

### Agent Model Used

_(unassigned — gated)_

### Completion Notes List

- 2026-07-07: Created as a gated follow-up from the parity-initiative party decision. Blocked on its own GDD/arch spec.

### File List

_(none yet)_
