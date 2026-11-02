# Engine changelog

Release notes for the engine crate (`engine-rs/Cargo.toml`), one `## <version>`
section per crate version, newest first, written for people who build on the
engine. The player-facing notes live in [`CHANGELOG.md`](../CHANGELOG.md), one
section per app version. A crate bump adds its section here in the same PR
(`src/tests/engineChangelog.guard.test.ts` enforces it). Describe what changed
in the engine's contract and behavior: saves, frame and view layouts, the
catalog, identity, the binding, and rules. An engine change a player can feel
also gets a line in the app changelog.

Entries up to 0.24.0 were written afterward from the history of the commits that
raised the version, so they are documentation only.

There is no entry for 0.17.0, which only
existed as a step inside a stacked branch.

## 1.5.0 (2026-11-01)

- Classic PC .TDT imports now record an explicit per-express-shaft `preserveBasementStops` provenance flag in saved transport data. Its underground stop choices are retained across ordinary .vctower serialization and reload, including empty and mixed skip lists. Older unmarked towers and Modern shafts retain their existing normalization; the save version and binding layout are unchanged.

## 1.4.0 (2026-11-01)

- `serviceDiagnostics(id)` now includes keyed, engine-authored `retail` facts for commercial venues: patronage, business tier, demand percentage, Modern-mode under/oversupply advice, yesterday's profit and rain. The inspector's demand map is memoized; no saved-game, frame or view layout change.
- Editing an older shaft's hourly duty counts keeps existing legacy home floors unchanged. Explicitly reauthored homes still snap to the shaft's stops.

## 1.3.0 (2026-11-01)

- The inspector can read typed, engine-authored service diagnostics through `serviceDiagnostics(id)`, returned to JavaScript as a keyed object. Parking, hotel and housekeeping verdicts and supporting facts are Rust-owned. Numeric frame and tenant records, the view layout, save format and simulation rules remain unchanged.

## 1.2.0 (2026-10-30)

- The catalog carries four kind facts on every facility entry: `commercial`, `hotel`, `leaseAmenity` and `unmetDemand`, the engine's own `is_commercial`, `is_hotel`, `is_lease_amenity` and `is_unmet_demand_kind`. A frontend reads them instead of keeping its own kind lists. `CATALOG_VERSION` is 3, so a frontend built for version 2 refuses this catalog, and the catalog digests are regenerated.

## 1.1.1 (2026-10-30)

- An elevator car the schedule has stood down takes no new riders: a person waiting at a floor does not board a parked car, which never left its home floor. A stood-down car that still has riders aboard keeps running to their floors, answers no hall calls and takes nobody new, then parks when the cab is empty. This moves `expected.json` for `amenities-modern`, `fixture-split-tower-4` and `offshift-schedule-modern`. The TypeScript reference engine carries the same rule so the shared lock holds for both.
- A bought elevator car joins the shaft's duty schedule (`Tower::set_cars`): in each day type, every hour that ran the whole fleet now runs the new fleet, and every other hour keeps its count. Home floors, stops and unscheduled shafts are unchanged, and a shrink still clamps. No conformance scenario buys a car into a schedule, so the lock does not move; the TypeScript reference mirrors the rule.

## 1.1.0 (2026-10-30)

- The wedding hall is 28 wide and 5 floors tall in both modes, anchored on floor 100 and rising through floor 104 (`WEDDING_HALL_TOP_FLOOR`, `Kind::highest_story`). Nothing is built above floor 100 but the hall. Saves that hold the old 16 wide hall widen it on load, with no save version change.
- Classic: the wedding hall cannot be sold or bulldozed (`GameMode::room_is_permanent` now lists it, with `CLASSIC_WEDDING_HALL_KEPT` as its refusal), and floor 100 takes only the hall. The reservation is checked after the shared refusals, so the TypeScript reasons still win where both engines refuse.
- The catalog lock hashes a view of the catalog with the hall's `width` and `floors` left out, on both sides, so the TypeScript table keeps its 16 by 1 hall. `catalog_json` still reports the real footprint. The digest is regenerated.
- `.TDT`: the cathedral's five parts (types 36 to 40) now read and write upward from floor 100 (rows 109 to 113), bottom part first; the importer keys a hall off its lowest part floor and the exporter allows the hall up to row 113.

## 1.0.4 (2026-10-30)

- Security, medical, housekeeping and recycling build at SimTower's widths (16, 26, 15 and 25 tiles), and the metro station is 30 tiles wide with a full-width tunnel row. This moves the catalog digest and the conformance checkpoints.
- Nothing can be built below a metro station, its bottom row holds only the station and its tunnel, and the bottom basement row (B10) takes only the metro. A station needs a clear bottom row and nothing under it.
- The v1 to v2 save migration keeps the old widths of those kinds, so old saves re-lay exactly as before.
- The `.TDT` importer slides parking stalls that the file leaves less than one stall's width from their neighbor toward the ramp, closing the gap, so a row such as TOWER7's B5 (a 3-tile and a 1-tile paving piece between stalls) chains to its ramp. A row split by a wider gap stays split.

## 1.0.3 (2026-10-30)

- The service elevator car holds 17 (`Kind::car_capacity`), the figure in the Windows Help file, up from 10. The catalog's `carCapacity`, the per-car load clamp, and the congestion read follow. The `.TDT` exporter keeps its old service capacity byte (`Kind::tdt_header_capacity`), because the byte is unreliable and the referee pins it. The catalog digests and the conformance lock move.

## 1.0.2 (2026-10-30)

- Classic: `GameMode::room_is_permanent` replaces `housekeeping_is_permanent` and also keeps placed security offices, recycling centers and movie theaters (`remove_facility` refuses with a per-kind message; a gutted shell still clears). Modern sells them. The `star-climb-classic` conformance scenario no longer sells its security office (it starts one office short of the 3-star gate), so the lock moves.

## 1.0.1 (2026-10-30)

- The 3-star gate (both modes) needs `SECURITY_OFFICES_FOR_THREE_STARS` (two) operational security offices instead of one, in the rating evaluation and in the star-gate panel getter. Stars still never downgrade. The `star-climb-classic` conformance scenario builds a second office and the lock moves with it.

## 1.0.0 (2026-10-30)

- The Rust engine is the only engine the shipped game runs: every deploy builds with `VC_ENGINE=wasm`, so there is no TypeScript engine to fall back to and no cohort draw. The TypeScript engine stays in the repository as the reference the conformance lock and tests compare against until it is deleted.
- No change to saves, the frame and view layouts, the catalog or the binding's declaration. The version marks that the game depends on this engine alone.

## 0.24.4 (2026-10-30)

- Classic: the metro station's help to commercial demand and its rain relief now need the station's platform floor to be served by transport. Modern keeps the any-operational-station rule.
- Housekeeping joins the kinds that cannot be placed underground (`no_basement` in the catalog), in both modes. Saves that already hold basement housekeeping still load.
- Classic: a placed housekeeping room cannot be sold or bulldozed (`GameMode::housekeeping_is_permanent`), except a gutted shell. Modern still sells it. Lobby tiles were already refused in both modes.

## 0.24.3 (2026-10-30)

- A metro station's unit card reads its elevator access at the platform floor, the floor above the row the station is saved on, the same floor the engine's own metro rule uses.

## 0.24.2 (2026-10-30)

- The .TDT importer reads a hotel room's stay state (checked in, asleep, vacant) from its status byte. Checked-in and asleep rooms arrive with their guests at any hour, and clean vacant rooms arrive empty, so a tower's guest count matches the file's hotel lines.
- A hotel suite holds 2 guests, as the finance block of every real save counts it. This moves the catalog digest, the conformance checkpoints and the .TDT export hashes.

## 0.24.1 (2026-10-30)

- The .TDT exporter writes the stairs table where SimTower keeps it, with the parking and clinic lists, and the importer finds it there (#1501).

## 0.24.0 (2026-10-29)

- The .TDT export keeps the game clock to the minute, so an exported tower imports with the same time.
- Shops, restaurants and fast food places imported from a save get a style.
- The stairs table is read once per window.

## 0.23.0 (2026-10-29)

- Real 1997 saves whose express shafts broke the elevator table walk now import.

## 0.22.0 (2026-10-29)

- Opening hours and households live in the engine catalog (#921, part 2b).

## 0.21.0 (2026-10-28)

- The port exposes the recycling card's fill and capacity lines (#1420).

## 0.20.0 (2026-10-28)

- The port can bulldoze a floor tile, quote a batch price, read a schedule and read the founder mark.

## 0.19.0 (2026-10-28)

- The frame loop reads the star rating, the emergency and the win from the port.

## 0.18.0 (2026-10-28)

- The port carries the renderer's reads.

## 0.16.0 (2026-10-28)

- The port advances time with one call per frame (slice 7, PR 5a).
- Frame layout version 5, with the binding and contract rows recorded (PR 1d).

## 0.15.1 (2026-10-28)

- Saves load the same in both engines for a random state of 0 and for hand-edited fields.

## 0.15.0 (2026-10-28)

- The panel queries are available on the engine (slice 7, PR 1c).

## 0.14.0 (2026-10-28)

- The port covers the lifecycle, events, log and text getters (slice 7, PR 1b).

## 0.13.0 (2026-10-28)

- The port covers the player commands and the HUD queries (slice 7, PR 1a).

## 0.12.0 (2026-10-27)

- Every player command goes through the port. The unit removal scan and the brush move into the engines (#1209).

## 0.11.0 (2026-10-27)

- The engine reports diagnostics facts for the tenant family (#1215).

## 0.10.0 (2026-10-27)

- The engine exposes the renderer-facing view (#1213).

## 0.9.0 (2026-10-27)

- The binding offers an hourly save delta (#1045).

## 0.8.1 (2026-10-27)

- The TypeScript .TDT exporter refuses or writes forged saves the way the Rust exporter does.

## 0.8.0 (2026-10-27)

- The panel getters are bound for the facade (#1214).

## 0.7.0 (2026-10-22)

- Merge leftovers are resolved and star-start semantics are intact.

## 0.6.0 (2026-10-21)

- The engine view is bound.

## 0.5.0 (2026-10-21)

- The Rust step driver lands, and the consumer drives time through it.

## 0.4.0 (2026-10-20)

- The binding answers the command gaps the facade listed (#868, slice 6d).

## 0.3.0 (2026-10-20)

- The crate is raised to 0.3.0 and its compatibility record is recorded again.

## 0.2.0 (2026-10-20)

- `engineIdentity()` and the crate version rule arrive (#963, slice 1).

## 0.1.0 (2026-10-08)

- First engine: the referee, new game, tower and build paths.
