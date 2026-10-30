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

## 1.0.2 (2026-10-30)

- The `.TDT` importer slides parking stalls that the file leaves less than one stall's width from their neighbor toward the ramp, closing the gap, so a row such as TOWER7's B5 (a 3-tile and a 1-tile paving piece between stalls) chains to its ramp. A row split by a wider gap stays split. Saves, frame layout, catalog and identity are unchanged.

## 1.0.1 (2026-10-30)

- Security, medical, housekeeping and recycling build at SimTower's widths (16, 26, 15 and 25 tiles), and the metro station is 30 tiles wide with a full-width tunnel row. This moves the catalog digest and the conformance checkpoints.
- Nothing can be built below a metro station, its bottom row holds only the station and its tunnel, and the bottom basement row (B10) takes only the metro. A station needs a clear bottom row and nothing under it.
- The v1 to v2 save migration keeps the old widths of those kinds, so old saves re-lay exactly as before.

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
