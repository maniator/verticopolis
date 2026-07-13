---
title: 'TDT export: emit lobby (type 24) and empty-floor (type 0) records so exported towers show lobbies'
type: 'bugfix'
created: '2026-07-12'
baseline_commit: 'cab5f88'
status: 'done'
context:
  - '{project-root}/docs/canon/tdt-format.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Towers exported to `.TDT` render with NO lobbies (ground and sky) in the real 1994 SimTower: the city backdrop shows through floor 1 and every sky-lobby level, and elevators cannot connect to the absent lobbies. Cause: `buildTDT` skips `floor` and `lobby` units, recording only the floor's left/right EXTENTS, so it never writes the type-24 lobby and type-0 empty-floor unit records the game needs. Confirmed long-standing (every one of our exports has zero type-24/type-0 records; every real save has them) via the `tools/simtower/` harness.

**Approach:** In `buildTDT`, stop skipping `floor`/`lobby` units. Per TDT floor, coalesce contiguous same-kind paving tiles that are not under a room into span records: lobby runs become type-24 records, empty-floor runs become type-0 records. Emit them alongside the room records; keep the existing extent header and `lobbyHeight` logic unchanged. Export-only change; no save-format or engine change.

## Boundaries & Constraints

**Always:** Parity with SimTower 1994 (lobbies are canon). COALESCE contiguous same-kind tiles into one span record per run (per-tile would blow the 256-records-per-floor cap and mismatch the game). A span is emitted only for paved tiles NOT covered by a room footprint on that floor (type-0 records are the gaps between rooms, matching the real save). Mirror the real save's record bytes: lobby type 24 `status 0`, floor type 0 `status 2`, both `rentClass 4` (No Rate) and `subtype 0`, `type` positive (never construction). Cover the ground lobby AND every sky lobby; keep excluding a gutted/burning lobby. The `export -> parseTDT -> re-export` byte-identical test and the ZERO-importer-warnings test must stay green (coalescing must be deterministic, left-to-right per floor). Keep the extent header (`widen`) and `hasGroundLobby`/`lobbyHeight` as they are. American English, no em-dashes in new prose; `src/storage`, engine stays DOM-free.

**Ask First:** If a real save turns out to write a lobby/floor record spanning tiles that ARE under a room (so "gaps only" is wrong), or writes per-lobby-floor counts differing from one-span-per-contiguous-run, surface it before widening the model.

**Never:** No per-tile records. No new save format / `SAVE_VERSION` bump (this is TDT export only). Do not create extra units on import (the importer already paves type-0/24 with no warning; leave it). Do not touch the elevator, parking, finance, retail, or header-count structures. Do not exceed or remove the `TDT_MAX_TENANTS_PER_FLOOR` guard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ground lobby | contiguous `lobby` tiles on floor 1, no room over them | one type-24 record spanning the run (status 0, rentClass 4) | — |
| Sky lobby | `lobby` tiles on floor 15/30/... | type-24 record(s) per contiguous run | — |
| Empty paved gap | `floor` tiles between rooms | type-0 record per contiguous run (status 2, rentClass 4) | — |
| Tile under a room | `floor`/`lobby` tile covered by a room footprint | no floor/lobby record there (room record wins) | — |
| Lobby broken by a room/elevator | lobby run split by an occupied tile | one type-24 record per sub-run | — |
| Gutted/burning lobby | lobby unit `state` fire/gutted | excluded (as today); no type-24 record | — |
| Round-trip | our export -> parseTDT -> re-export | byte-identical; zero importer warnings | — |
| Over cap | a floor's total records (rooms + spans) > 256 | LegacyExportError (existing guard, unchanged) | throw |

</frozen-after-approval>

## Code Map

- `src/storage/tdtExport.ts` -- `buildTDT`: the floor/lobby skip (~277) and `pushTenant` (~212); add per-floor coalescing that pushes type-24/type-0 span records. Emission loop (~540) and `OutTenant` (~172) are unchanged.
- `src/storage/tdtImport.ts` -- `TDT_FLOOR=0`/`TDT_LOBBY=24` (~130); `parseTDT` paves both with no warning (~481); read-side reference only, no change.
- `src/storage/tdtFormat.ts` -- `TDT_MAX_TENANTS_PER_FLOOR=256` (~49); the cap the coalescing must respect.
- `src/tests/tdtExport.test.ts` -- round-trip + zero-warnings + header-count tests; add lobby/floor-record assertions.
- `tools/simtower/` -- the real-save byte-diff and Wine load are the acceptance oracle (opt-in, local, never CI).

## Tasks & Acceptance

**Execution:**
- [x] `src/storage/tdtExport.ts` -- collect `floor`/`lobby` tiles per floor (each is width-1) while still widening extents; keep `hasGroundLobby`. Do not push them as rooms.
- [x] `src/storage/tdtExport.ts` -- after gathering rooms, per floor compute which paved tiles are NOT under a room footprint, then coalesce contiguous same-kind (lobby vs floor) tiles into runs and `pushTenant` each run: lobby run -> `{type: 24, status: 0, rentClass: 4}`, floor run -> `{type: 0, status: 2, rentClass: 4}`, both `subtypeIdx: undefined`. Deterministic left-to-right order.
- [x] `src/storage/tdtExport.ts` -- ensure the new records count toward the existing `TDT_MAX_TENANTS_PER_FLOOR` guard (they already flow through `tenantsByTdt`).
- [x] `src/tests/tdtExport.test.ts` -- a fixture tower with a ground lobby, a sky lobby, and rooms with gaps exports the expected coalesced type-24/type-0 spans; confirm zero importer warnings and byte-identical re-export still hold.
- [x] `package.json` -- bump version (player-facing: exported towers now render lobbies in the real game).

**Acceptance Criteria:**
- Given a tower with a ground lobby, when exported, then the floor map contains a type-24 record spanning the lobby run (not per-tile), with status 0 and rentClass 4.
- Given a tower whose floor has rooms with empty paved gaps, when exported, then each gap is one type-0 record (status 2, rentClass 4), and tiles under a room carry no floor record.
- Given any exported tower, when re-imported and re-exported, then the bytes are identical and the importer raises zero warnings.
- Given a real tower exported by us, when byte-diffed against a real save (harness), then the `only-in-real {0:N, 24:1}` floor-map gap is eliminated.
- Given an exported tower loaded in real SimTower (Wine), then the ground lobby and every sky lobby render as solid lobbies (no backdrop bleed-through).

## Design Notes

The importer already re-paves type-0/24 records into width-1 `floor`/`lobby` units (no warning), so the round trip is closed as long as the exporter's coalescing is the deterministic inverse: import creates per-tile tiles, re-export coalesces them back to the same runs in the same left-to-right order. Reference bytes from a real save (`my_tower.TDT`): lobby = one span `left 139 right 236 type 24 status 0 rentClass 4`; floor gaps = e.g. `187-192 / 201-203 / 230-235 type 0 status 2 rentClass 4`. Status is round-trip-immaterial (the reader ignores it) but is mirrored to match the game's bytes.

## Verification

**Commands:**
- `npm run typecheck` / `npm run lint` -- clean.
- `npx vitest run tdtExport tdtImport canon` -- green, including the new lobby/floor assertions and the unchanged round-trip/zero-warning tests.

**Manual checks (acceptance oracle, local, needs the game disc):**
- `tools/simtower/verify-tdt.py` on our export of a real tower shows type-24/type-0 records present; the byte-diff `only-in-real {0,24}` gap is gone.
- Load the export in Wine (`tools/simtower`) and confirm lobbies render at ground and sky levels.

## Spec Change Log

- **2026-07-12 (post-review, importer-inverse rewrite).** The adversarial review
  found a HIGH round-trip bug: the first implementation coalesced spans over the
  ACTUAL paved tiles (leaving unpaved gaps) and derived each span's kind from the
  unit's own kind. That is not the inverse of the importer, which paves each
  floor's ENTIRE extent `[leftEdge, rightEdge)` as one solid block and
  reconstructs every paved tile's kind from the FLOOR (`isLobbyFloor`), never
  from the record type. So any non-import-normalized tower (an unpaved corridor
  gap, a laterally-separated room, or a lobby tile on a non-lobby floor) failed
  `export -> parseTDT -> re-export` byte-identity. Fix: the paving pass now walks
  the same `extents` range it writes to the floor header, skips room-covered
  tiles, coalesces the remaining runs, and sets kind by floor
  (`type = isLobbyFloor(ourFloor) ? 24 : 0`). `isLobbyFloor` is now exported from
  `tdtImport.ts` and imported by `tdtExport.ts` (single source, no drift). A
  hand-built non-normalized round-trip test was added (the existing fixtures were
  import-normalized fixed points and could not expose this). Version corrected to
  a patch bump (1.24.1), since this is a player-noticeable fix, not a new
  capability.
- **2026-07-12 (frozen row superseded).** The I/O matrix row "Gutted/burning
  lobby -> excluded; no type-24 record" is SUPERSEDED by the round-trip
  requirement. Because the extent already includes a gutted lobby tile (widening
  is unconditional) and the importer paves it as an ordinary empty lobby, the
  gutted lobby must now be emitted as a normal type-24 record for the export to
  round-trip byte-identically. The gutted STATE drops on the paving round trip,
  exactly like every other unit state. The separate `hasGroundLobby` gutted
  check (which only affects `lobbyHeight`, not paving) is unchanged. The frozen
  block itself is left intact; this entry records the negotiated supersession.
  NOTE (owner-confirmed 2026-07-13): a gutted lobby cannot occur in real play
  anyway. `EventSystem.flammableUnits` excludes `floor` and `lobby`, so fire
  never touches a lobby; the only way to reach a fire/gutted lobby is
  hand-forged serialized input, which `buildTDT` tolerates. So this supersession
  is behaviorally moot for real towers.

## Suggested Review Order

**The importer inverse (the heart of the fix)**

- The lobby-floor formula, now exported so reader and writer share one source
  [`tdtImport.ts:152`](../../src/storage/tdtImport.ts#L152)

- Emit paving as extent-minus-rooms, kind by `isLobbyFloor`: the exact inverse of how the importer paves the whole extent and reconstructs kind by floor
  [`tdtExport.ts:490`](../../src/storage/tdtExport.ts#L490)

- Room footprints marked covered so paving spans break around rooms (matching the importer's post-import shape)
  [`tdtExport.ts:308`](../../src/storage/tdtExport.ts#L308)

**Tests (the regression guard)**

- Non-normalized round-trip (corridor gap + laterally-separated room + sky lobby): fails against the naive actual-tiles coalescing, passes on the inverse
  [`tdtExport.test.ts:70`](../../src/tests/tdtExport.test.ts#L70)

- Gutted lobby paves as an ordinary type-24 record (state drops, round-trips byte-identically)
  [`tdtExport.test.ts:658`](../../src/tests/tdtExport.test.ts#L658)
