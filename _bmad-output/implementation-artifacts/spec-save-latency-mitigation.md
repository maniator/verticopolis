---
status: ready-for-dev
created: 2026-07-07
updated: 2026-07-07
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

## Tasks

- `src/engine/saveMigration.ts`: bump the current save version to 3 and add an explicit `upgradeV2toV3` migration hook.
- `src/storage/SaveGame.ts`: add an async local save method that serializes with `savedAt`, compresses through native `CompressionStream` when available, writes the same `VCZ1:` localStorage format, and falls back to the synchronous writer if native compression is unavailable.
- `src/game/saveLoad.ts`: add a routine autosave method with latest-wins coalescing and use the async local save method.
- `src/main.ts`: route the 30-second autosave timer through the routine autosave method, leaving manual save, update save, and context-loss recovery on synchronous save.
- `src/tests/storage.test.ts`: cover v2 to v3 migration, async save round-trip, and fallback behavior.
- `src/tests/gameControllersCoverage.test.ts`: cover autosave coalescing and confirm pre-reload saves still use the synchronous method.

## Benchmark Evidence

A 12,975-unit save-shaped payload measured on the runner:

| Step | Average | P95 |
| --- | ---: | ---: |
| JSON.stringify | 9.42 ms | 10.38 ms |
| TextEncoder(JSON) | 0.85 ms | 1.60 ms |
| fflate.deflateSync(JSON bytes) | 69.78 ms | 72.61 ms |
| base64(deflated JSON) | 12.30 ms | 12.77 ms |
| binary DataView encode | 14.52 ms | 20.11 ms |
| fflate.deflateSync(binary bytes) | 30.28 ms | 34.47 ms |
| native CompressionStream(JSON bytes) | 26.92 ms | 32.78 ms |

## Code Map

- Save schema migration: `src/engine/saveMigration.ts`
- Storage format and compression: `src/storage/SaveGame.ts`
- Save/load controller: `src/game/saveLoad.ts`
- Autosave timer: `src/main.ts`
- Storage tests: `src/tests/storage.test.ts`
- Controller tests: `src/tests/gameControllersCoverage.test.ts`
