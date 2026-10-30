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
