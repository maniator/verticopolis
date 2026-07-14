# GDD: Party Hall Two-Story Footprint + Save Migration

date: 2026-07-13
author: Game Designer (gds agent), with the parity-audit party
status: ready for implementation

## 1. Summary

Per canon, a Party Hall is a **two-story** function room. The engine currently
builds it one story tall. This spec makes the catalog match canon (`floors: 2`)
and adds a save migration (`v5 -> v6`) that grows every existing one-story party
hall into its second story without scrambling the tower.

## 2. Canon evidence (do not re-derive from memory)

Three independent sources agree the Party Hall spans two floors:

1. **The TDT binary format.** Tile codes `29` and `30` are documented in
   `docs/canon/tdt-format.md` as "Party hall top / bottom half" (the same
   top/bottom split the Theatre uses with `18/19`). A single-story room would
   need only one code.
2. **Our own storage tables already assume it.** `tdtTables.ts` maps both `29`
   and `30` to `partyHall`; `FAMILY_STORIES.partyHall = 2`; and
   `PART_STACKS.partyHall = [30, 29]`. The exporter already writes a party hall
   as a two-tenant stack (`u.floor` and `u.floor + 1`). Only the engine catalog
   disagreed.
3. **The SimTower Wiki** (https://simtower.fandom.com/wiki/Party_hall): "Party
   halls are large 2-story rooms." It also notes you only need to provide
   transportation to the **lower** floor, which fixes the anchor: the saved
   floor (where the player wired transport) stays the entrance and the room
   grows **up**.

This means the current build has a latent round-trip defect: the engine models a
one-story hall, but the exporter still emits a `29` top-half onto the floor
above, which can overlap a real room there. Making the engine reserve
`floor + 1` for the hall closes that gap.

## 3. Design change

### 3.1 Catalog

`partyHall` gains `floors: 2` in `src/engine/facilitiesData.ts`, exactly like
`cinema`. Everything downstream (`facilityFloors`, `Tower.register`, placement
validation, rendering height, export stacking, import merge) is already
catalog-driven, so no other production wiring changes. Width stays 24; cost,
star gate, income, and open hours are unchanged.

Effects that fall out for free:
- Placement now requires structure on both stories and blocks the floor
  directly above a hall (`placement.ts` already loops `facilityFloors`).
- The renderer draws the hall two floors tall (`facilityFloors` drives the
  pixel height, as it does for the cinema).
- `serialize/deserialize` clamps a hall's floor to `maxFloor - 1` on load (the
  loader already subtracts `stories - 1`).

### 3.2 Save migration `v5 -> v6`

Because facility height is catalog-derived (not stored per unit), every party
hall in a loaded save becomes two stories the instant the catalog changes.
A migration is required so the newly-claimed upper story does not silently
overlap whatever the player built above the hall. Real saves do stack rooms
there (the uploaded reference save has security + shop + restaurant directly
above its basement hall, and parking directly below), so the migration must
handle a fully boxed-in hall.

Policy, per unit, in priority order:

1. **Expand in place.** If `floor + 1` is within the tower and its span
   `[x, x + width)` holds no other room, keep the hall where it is and pave a
   `floor` tile across the upper span wherever structure is missing (only where
   the new tile is supported, so the hall never floats). The lower (entrance)
   floor and its transport are untouched. This is the common case.
2. **Relocate to the nearest fit.** If the upper story is blocked, move the hall
   to the closest position where a full two-story footprint fits: both stories
   within bounds and free of other rooms, and the footprint attaches to the
   tower's existing structure (its base is a built tile, or rests on the built
   floor below it above ground / the built story above it in the basement; the
   ground floor must be an existing tile, so a hall never lands on bare lot).
   Either story is then paved where missing, always resting on that base, so
   relocation adds no floating structure. Search the hall's original bottom floor
   first (nearest `x` to its original column wins), then floors outward. The hall
   keeps its identity, price, and label; the player may need to reconnect
   transport (accepted trade-off, chosen by the owner).
3. **Drop as last resort.** If the tower has no two-story gap anywhere, remove
   the hall and log it. Losing one entertainment room is preferable to a
   corrupt, overlapping tower, and matches the codebase rule that a migration
   may never scramble a save.

The migration never removes existing `floor`/`lobby` structure or any other
room; a relocated hall leaves its old floor tiles in place (same as the v1->v2
reflow). Placement is greedy: an already-placed hall footprint counts as an
obstacle for later halls, so the pass is deterministic (halls are processed in
save order) but not order-independent. If two halls contend for one slot, the
earlier hall in save order wins it and the other takes the next-nearest.

### 3.3 Guards and idempotency

Reuse the existing validity net: the output must satisfy `migrationLooksValid`
(no room overlaps, nothing off-lot, now checking both party-hall stories via
`facilityFloors`) and must not raise `floatingStructureCount` versus the input.
The hop stamps `version: 6`. Re-running on an already-v6 save is a no-op because
every hall already owns a clear, paved upper story.

## 4. Round-trip / TDT impact

- **Export.** No writer change: `PART_STACKS.partyHall = [30, 29]` already emits
  the two stories. Post-change the engine reserves `floor + 1`, so the emitted
  `29` top-half no longer risks colliding with a neighbor.
- **Import.** No reader change: `29/30` already merge into one `partyHall`; its
  height now comes from the catalog and reads back as two stories.
- **Census / economy.** Party-hall population is 0 and it is outside the canon
  commercial set (W2/W3 exempt), so satisfaction, meal cadence, and walking
  penalties are unaffected. Overhead and traffic income are per-room, not
  per-story, so income is unchanged.

## 5. Acceptance criteria

1. `facilityFloors("partyHall") === 2`; placement rejects a hall unless both
   stories exist and blocks a room on the floor above it.
2. A v<=5 save with a party hall whose upper story is clear loads with the hall
   two stories tall and a paved upper floor, unmoved.
3. A v<=5 save with a boxed-in party hall (rooms above and below) loads with the
   hall relocated to the nearest valid two-story slot, no overlaps, no new
   floating structure, and all neighbors intact.
4. A save with no two-story gap anywhere drops the hall and logs it; the rest of
   the tower is unchanged.
5. The migration is idempotent and passes `migrationLooksValid` /
   `floatingStructureCount` guards.
6. A built party hall exports and re-imports byte-stably as a two-story room.

## 6. Out of scope

- Party-hall income/star-gate retuning.
- Widening/other-kind height parity (tracked separately).
- Moving basement party halls above ground (the engine still allows a
  basement hall; only its height changes).
