---
status: in-progress
created: 2026-07-07
updated: 2026-07-08
baseline_commit: 348f912014f3761ab41f961adffc636fd261fda3
---

# Spec: Save Latency Mitigation

<frozen-after-approval>
Routine autosave should avoid the measured synchronous DEFLATE hitch on large towers while adding an explicit v2 to v3 save-version migration hook and preserving the synchronous durability path used before reloads.
</frozen-after-approval>

## Acceptance Criteria

1. Given native `CompressionStream("deflate-raw")` is available, when a routine autosave is requested, then the localStorage value is written through the async compression path and remains loadable by `SaveGame.load()`.
2. Given native compression is unavailable, when a routine autosave is requested, then the save still succeeds through the existing synchronous compressed localStorage path.
3. Given an async autosave is already running, when another async autosave request arrives with newer simulation state, then the newer state is persisted after the active write completes.
4. Given update or graphics recovery needs an immediate pre-reload flush, when that path saves, then it keeps using the synchronous `SaveGame.save()` path.
5. Given existing `VCZ1:` compressed JSON saves, when the game loads them, then compatibility is unchanged.
6. Given a serialized v2 game, when it is deserialized, then it passes through `upgradeV2toV3` and re-serializes with version 3.
7. Given an autosave stored under the legacy `simtower-clone-save` key, when the game boots, then it loads that save and future autosaves write the `verticopolis-save` key.
8. Given a v3 save, when a unit field sits at the loader fallback (`state` "empty", `satisfaction` 1, `occupants` 0, `everOccupied` false, `pendingIncome` 0, `label` at the catalog name, `width` for width-1 floor/lobby tiles), then `serialize()` omits it and `deserialize()` restores it, loading identically to the full shape.
9. Given a room whose width equals the catalog width, when it is serialized, then the width is still written explicitly (catalog widths are tuning that has drifted before; only width-1 floor/lobby tiles omit width).
10. Given the synchronous save path, when it compresses, then it uses deflate level 1 (on sparse v3 payloads level 1 measured within 0.8% of the level-6 size at roughly a third of the cost).

## Tasks

- [x] `src/engine/saveMigration.ts`: bump the current save version to 3 and add an explicit `upgradeV2toV3` migration hook.
- [x] `src/storage/SaveGame.ts`: add an async local save method that serializes with `savedAt`, compresses through native `CompressionStream` when available, writes the same `VCZ1:` localStorage format, falls back to the synchronous writer if native compression is unavailable, and reads legacy autosave keys before rewriting to the Verticopolis key.
- [x] `src/game/saveLoad.ts`: add a routine autosave method with latest-wins coalescing and use the async local save method.
- [x] `src/main.ts`: route the 30-second autosave timer through the routine autosave method, leaving manual save, update save, and context-loss recovery on synchronous save.
- [x] `src/tests/storage.test.ts`: cover v2 to v3 migration, async save round-trip, legacy autosave key migration, and fallback behavior.
- [x] `src/tests/gameControllersCoverage.test.ts`: cover autosave coalescing and confirm pre-reload saves still use the synchronous method.
- [x] `src/engine/types.ts`: add `SerializedUnit` (optional-at-default unit fields) and use it in `SerializedGame`.
- [x] `src/engine/Simulation.ts`: `serializeUnit` writes the sparse v3 shape, mirroring the `deserialize` fallback table (with the room-width carve-out).
- [x] `src/engine/saveMigration.ts`: read units through the same fallbacks (missing `state` is "empty", missing structural width is 1) so the migration seam handles both shapes.
- [x] `src/storage/SaveGame.ts`: synchronous writer compresses at deflate level 1.
- [x] `src/tests/sparseSave.test.ts`: pin the omit table against the loader fallbacks (drift guard), the width carve-out, round-trip stability, and the real-fixture size bound.

## Benchmark Evidence

A 12,975-unit save-shaped payload measured on the runner (Copilot session, synthetic):

| Step | Average | P95 |
| --- | ---: | ---: |
| JSON.stringify | 9.42 ms | 10.38 ms |
| TextEncoder(JSON) | 0.85 ms | 1.60 ms |
| fflate.deflateSync(JSON bytes) | 69.78 ms | 72.61 ms |
| base64(deflated JSON) | 12.30 ms | 12.77 ms |
| binary DataView encode | 14.52 ms | 20.11 ms |
| fflate.deflateSync(binary bytes) | 30.28 ms | 34.47 ms |
| native CompressionStream(JSON bytes) | 26.92 ms | 32.78 ms |

The REAL 12,975-unit player save (`towerone_6.vctower`, the reflow golden fixture), measured on the follow-up session's runner:

| Strategy | Average | Bytes |
| --- | ---: | ---: |
| JSON.stringify, full shape | 7.10 ms | 2,089,254 |
| JSON.stringify, sparse units | 4.36 ms | 692,130 |
| hand-rolled schema stringifier, full shape | 10.48 ms | 2,089,254 |
| deflateSync L6 on full JSON | 35.12 ms | 98,958 |
| deflateSync L1 on sparse JSON | 7.32 ms | 87,227 |
| end-to-end sync save, full + L6 (shipped before) | 48.33 ms | 131,949 |
| end-to-end sync save, sparse + L1 (shipped now) | 16.43 ms | 116,309 |
| native CompressionStream on full JSON | 28.21 ms | 95,662 |
| native CompressionStream on sparse JSON | 16.28 ms | 85,128 |

Findings the numbers forced: replacing `JSON.stringify` with a schema stringifier of the same shape is a loss (the bytes are the cost, not the stringifier); omitting loader-default fields cuts the JSON to 33% with zero round-trip mismatches; sparseness is what makes level-1 deflate viable (+0.8% size for a third of the cost, versus +12.7% on the full shape).

## Code Map

- Save schema migration: `src/engine/saveMigration.ts`
- Sparse unit writer + loader fallback table: `src/engine/Simulation.ts` (`serializeUnit` / `deserialize`)
- Serialized shapes: `src/engine/types.ts` (`SerializedUnit`, `SerializedGame`)
- Storage format and compression: `src/storage/SaveGame.ts`
- Save/load controller: `src/game/saveLoad.ts`
- Autosave timer: `src/main.ts`
- Storage tests: `src/tests/storage.test.ts`
- Sparse-format tests: `src/tests/sparseSave.test.ts`
- Controller tests: `src/tests/gameControllersCoverage.test.ts`
