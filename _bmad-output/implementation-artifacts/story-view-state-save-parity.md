---
baseline_commit: ff0d23bb04e50b4d994b24a4a0faa4854b4f7540
---

# Story: View-state save parity (.vctower / slots / TDT)

Status: done (merged 2026-07-12 via PR #194, merge f6149da)

Grounds: direct owner request (2026-07-12): a save moved between devices must
reopen with the UI looking the way it did at save time, matching what the 1994
TDT format already carries (its header stores a view-scroll position at
0x26/0x28). Party-mode ruling recorded in the installed memlog the same day.
No epic; standalone parity story through the BMGD flow.

## Story

As **a Verticopolis player who moves saves between devices**,
I want **my camera position and zoom to travel inside the save (autosave,
manual slots, and .vctower exports) and to be restored on load**,
so that **opening my tower on another device puts me back exactly where I was
standing, the same courtesy the 1994 save format already extends**.

## Context (read before coding)

- `SerializedGame` (`src/engine/types.ts:338`) carries no view/UI state. Both
  the localStorage slots and the .vctower container serialize it verbatim
  (`src/storage/SaveGame.ts`), so nothing about the camera travels. Verified
  against the owner's real export (`sixseven_2.vctower`, 12,014 units): no
  `view` key.
- On every load/import, `GameApp.adoptSim` (`src/main.ts:1251`) calls
  `TowerEngine.setSim` (`src/render/excalibur/TowerEngine.ts:723`), which ends
  with `center()` (`TowerEngine.ts:921`): camera re-centered mid-tower, zoom
  left at whatever the session had (0.9 at boot, `TowerEngine.ts:512`).
  `TowerEngine.start()` also calls `center()` on boot (`TowerEngine.ts:518`).
- The TDT header word pair at 0x26/0x28 is the saved viewport X/Y in 1994
  world pixels (`docs/canon/tdt-format.md` §1 row 0x26). Our exporter always
  writes the New Tower defaults `TDT_DEFAULT_VIEW_X/Y = 1105/3491`
  (`src/storage/tdtExport.ts:515`, constants in `src/storage/tdtFormat.ts:73`);
  our importer skips the words inside the header skip
  (`src/storage/tdtFormat.ts:364`).
- 1994 world metrics: tenant extents are 8-pixel segments == our tiles
  (`tdtFormat.ts:151`), 120 floor slots, TDT floor index = our floor + 9
  (`TDT_FLOOR_OFFSET`, `src/storage/tdtImport.ts:136`; TDT 10 = our floor 1,
  the ground). Vertical pitch is 36 px/floor (world height 120 x 36 = 4320).
  Anchor check: the documented default view Y 3491 + a 469-px client height =
  3960 = the exact bottom edge of TDT floor index 10, which is precisely the
  documented behavior "opens on the ground lobby". So assume a 640 x 469
  client window for the mapping and cite the anchor; the derivation is ours,
  not canon-measured, and the round-trip test pins it.
- Camera plumbing: `cam.pos` is world px (`x = tile * TILE`,
  `y = -floor * FLOOR`; `TILE = 11`, `FLOOR = 34`, `TowerEngine.ts:35`).
  `setCamera(tileX, floor, zoom)` funnels zoom through `clampZoom`
  (`TowerEngine.ts:950`) but does NOT clamp position; `clamp()`
  (`TowerEngine.ts:913`) bounds x to the lot and y via `clampCameraY`
  (`src/render/cameraBounds.ts`), viewport- and zoom-aware.
  `MIN_ZOOM = 0.3`, `MAX_ZOOM = 3` (`TowerEngine.ts:45`).
- Save flows all pass through `SaveLoad` (`src/game/saveLoad.ts`): `save()`,
  `autosave()`, `saveBeforeUpdate()`, `recoverFromContextLoss()`,
  `exportGame()`, `exportLegacy()`, `importGame()`, `importLegacy()`. Its
  `SaveLoadDeps` seam is how the UI layer injects capabilities, and it is
  unit-tested with fake deps (`src/tests/gameControllersCoverage.test.ts`,
  `src/tests/storage.test.ts`).
- Undo/redo restores go through `adoptSim(sim, /*preserveHistory*/ true)`
  (`src/main.ts:390`); today they re-center the camera too (setSim always
  centers). Crash reports and undo snapshots call `sim.serialize()` directly.
- Per-device preferences (`src/storage/Prefs.ts`) are DELIBERATELY separate
  from saves and must not travel; this story does not touch them.
- `Simulation.deserialize` (`src/engine/Simulation.ts:2341`) is the trust
  boundary: every field from a save is coerced/validated there. The engine
  stays DOM-free; a view field is inert data the tick loop never reads.
- Real save material for verification: `scratchpad/saves/` holds the owner's
  uploaded `sixseven*.vctower`, `towerone_*.vctower`, and `SIXSEVEN.TDT`
  (whose 0x26/0x28 read exactly 1105/3491, confirming it is one of our own
  exports). The committed fixture `src/tests/fixtures/towerone_6.vctower`
  predates the view field and must keep loading (center fallback).

## Party ruling (scope fence)

Camera tile + floor + zoom travel; speed, selection, open panels, and prefs do
NOT. Absent view field = today's behavior (center), no migration, no
SAVE_VERSION bump. Restore always passes the device-legal clamps. TDT carries
what its format can hold: position words both ways, zoom neither way.

## Acceptance Criteria

1. **Schema.** `src/engine/types.ts` gains
   `SerializedView { tile: number; floor: number; zoom?: number }` (camera
   CENTER in grid units, zoom in screen-px-per-world-px) and
   `SerializedGame.view?: SerializedView`, documented as inert UI cargo the
   engine never reads during simulation.
2. **Carry.** `Simulation` gains a public inert `view: SerializedView | null`
   field (default null). `serialize()` emits it when set; `deserialize()`
   restores it through the trust boundary: each of tile/floor/zoom must be a
   finite number or the whole field is dropped (null); tile clamps to
   [0, GRID.width], floor to [GRID.minFloor, GRID.maxFloor]; zoom, when
   present, clamps to [MIN_ZOOM, MAX_ZOOM] (import the constants or mirror the
   range in one place; do not hard-code twice). New games have no view.
3. **Stamp.** `SaveLoadDeps` gains `getView(): SerializedView | null`,
   implemented in `main.ts` from the engine camera
   (`TowerEngine.viewState()`, new: cam center converted back to grid units +
   zoom). `SaveLoad` stamps `sim.view` from it immediately before: `save()`
   (covers autosave-timer's sibling too via saveTo), `autosave()` drain
   iterations, `exportGame()`, and `exportLegacy()`. `importLegacy`'s
   pre-adopt flush stamps the CURRENT tower (via `saveBeforeUpdate` →
   `save`), but the imported sim's slot copy keeps the view parsed from the
   TDT file, never the live camera's.
4. **Restore.** `TowerEngine.setSim` applies `sim.view` when present
   (`setCamera(tile, floor, zoom ?? current zoom)` followed by the standard
   `clamp()` so position and zoom are re-bounded for THIS device's viewport),
   else falls back to `center()` exactly as today. `TowerEngine.start()` does
   the same after its `center()` call so a boot-loaded autosave restores too.
5. **Undo keeps the camera.** `setSim` gains a `keepCamera` option;
   `adoptSim(sim, preserveHistory=true)` (the undo/redo restore path) passes
   it, leaving the camera untouched (neither center nor view-restore). Tower
   swaps (load/slot/import/new) restore or center as per AC4.
6. **TDT export.** `buildTDT` writes real view words when `save.view` is
   present: `viewX = round(tile*8 - 320)` clamped to [0, 2360],
   `viewY = round(((119 - (floor + 9)) * 36 + 18) - 469/2)` clamped to
   [0, 3851], both to u16. Absent view keeps writing
   `TDT_DEFAULT_VIEW_X/Y` byte-identically to today. Mapping constants live in
   `tdtFormat.ts` next to the existing view constants, with the anchor
   derivation documented.
7. **TDT import.** The header walk reads viewX/viewY at 0x26/0x28 (adjust the
   skips; every other header offset unchanged) into `TdtHeader`, and the
   importer sets `save.view = { tile, floor }` (no zoom) via the inverse
   mapping, rounded and clamped to our grid. The word pair (0, 0) means "no
   saved view" (the 1994 top-left-sky failure mode) and maps to absent.
   Importing our own default words 1105/3491 must land the view on the
   ground-lobby area (floor within 1–13, tile within 1 of 178).
8. **Round trip.** Export-then-import of any in-range view through the TDT
   words recovers floor within ±1 and tile within ±1. A .vctower
   export/import round-trips the view exactly. The committed pre-view fixture
   `towerone_6.vctower` still loads with the center fallback.
9. **Hostile input.** A forged save with `view` as a non-object, or with
   NaN/Infinity/string members, or absurd values (tile 1e9, zoom 1e308,
   negative floor below the grid) loads fine with the field dropped or
   clamped; nothing non-finite ever reaches `cam.pos`/`cam.zoom` (the
   `clampZoom`/`clampCameraY` guards stay the last line of defense).
10. **Docs + version.** `docs/canon/tdt-format.md` row 0x26 notes the exporter
    now writes the live view (default when absent) and the importer reads it.
    `package.json` bumps minor (player-facing capability): 1.21.0 → 1.22.0.

## Tasks / Subtasks

- [x] Types + Simulation carry (AC1, AC2) with serialize/deserialize tests
      (valid, absent, malformed, clamped).
- [x] `TowerEngine.viewState()` + restore in `setSim`/`start` + `keepCamera`
      (AC4, AC5). Keep the restore decision in a small pure helper if that is
      what it takes to unit-test it headlessly (no canvas in Vitest).
- [x] `SaveLoadDeps.getView` + stamping in SaveLoad (AC3) with fake-deps tests
      asserting stamp points and the importLegacy nuance.
- [x] TDT mapping constants + pure `viewWordsFromView` / `viewFromViewWords`
      helpers in `tdtFormat.ts`; wire into `tdtExport.ts` / `tdtImport.ts`
      (AC6, AC7) with mapping, default-anchor, zero-words, and round-trip
      tests (AC8).
- [x] Hostile-input tests (AC9); fixture regression (AC8).
- [x] Canon doc row + version bump (AC10).
- [x] Quality gates; then `/gds-code-review` in-session (mandatory for save
      round-trip work); fix `patch` findings, record `defer` in backlog.
      (Gates green; review ran, all patch findings fixed, no defers.)

## Testing standards

Vitest, headless, deterministic. Shift-left: every AC lands as a unit test at
the cheapest tier (pure mapping fns and Simulation round-trips, not browser
runs). Fixtures must assert every construction step they depend on. No new
`.find`/`.filter` scans inside per-tick loops (the view field is never read on
a tick path). Manual verification against the owner's uploaded saves in
`scratchpad/saves/` is encouraged but not a substitute for the unit tests.

## Project Context Rules (extract)

- American English; no em-dashes in new prose (docs, comments, commit/PR).
- `src/engine/` stays DOM-free; determinism untouched (view is inert cargo).
- TDT/save round-trip work reviews with `/gds-code-review` in the same
  session; fix patch findings, defer rows to
  `_bmad-output/implementation-artifacts/backlog.md`.
- Gates before pushing: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`.
- Version bump: minor (new player-facing capability).
- Merge commits only; the working branch is `claude/vctower-save-parity-coi39u`.

## References

- [Source: docs/canon/tdt-format.md#§1] header row 0x26 (window position).
- [Source: src/storage/tdtFormat.ts:73] `TDT_DEFAULT_VIEW_X/Y` + doc comment.
- [Source: src/render/excalibur/TowerEngine.ts:900-955] camera control seam.
- [Source: src/game/saveLoad.ts] save/export/import flows and deps seam.
- [Source: src/engine/Simulation.ts:2307-2440] serialize + trust boundary.
- Party ruling: `_bmad-output/party-mode/memories/installed/.memlog.md`
  (2026-07-12 outcome entry).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (session 2026-07-12)

### Debug Log References

- Full suite 1220/1220 green; typecheck/lint/build green at implementation
  end.
- One planned deviation from AC7: `viewFromViewWords` keeps tile/floor
  FRACTIONAL instead of rounding. Rounding made the default words (1105,
  3491) a non-fixed-point of the mapping and broke the exporter's existing
  export/import/export idempotence test (byte 0x28 drifted 3491 → 3492).
  Fractional centers are valid `SerializedView` values, the mapping becomes
  exactly idempotent, and the anchor test now pins the fixed point.
- One scope addition beyond AC3's list: `onSaveSlot` in `main.ts` stamps the
  view too, so manual slots match the story's own promise ("autosave, manual
  slots, and .vctower exports").
- Verified against the owner's real uploaded saves (scratchpad, not
  committed): SIXSEVEN.TDT (default words) imports with a ground-lobby view
  and re-exports byte-identical words; all eight real .vctower files load
  viewless and round-trip a stamped view.

## Deep review (gds-code-review, same session)

Three parallel layers ran (Blind Hunter, diff-only; Edge Case Hunter, diff +
repo; Acceptance Auditor, diff + this story). Eleven raw findings deduped to
eight; six patched, two dismissed, zero deferred.

Patched:

1. Null-camera stamping could erase an imported sim's file-carried view
   (blind): SaveLoad now stamps through `stampView`, which skips a null
   camera instead of writing it; pinned by test.
2. `zoom: null` dropped the whole view instead of reading as absent (blind):
   `coerceView` now treats null zoom as absent; pinned by test.
3. `viewWordsFromView` could manufacture the (0, 0) "no view" sentinel for an
   unclamped top-left-extreme view (edge): the mapping now emits (0, 1) in
   that corner; pinned by test.
4. One em-dash in a new code comment (auditor): reworded.
5. No renderer-side coverage of the restore seam (blind + auditor): the
   camera policy is now its own `adoptCamera` method, and prototype-on-fake
   tests pin viewState/applyView inverse-ness, device clamping, zoomless
   restores, and the restore/center/keepCamera policy.
6. Undeclared spec deviations (auditor): AC7's grid clamp lives at the
   `Simulation.deserialize` trust boundary rather than in the importer (every
   production import passes it; direct `parseTDT` output is raw), and AC8's
   plus-minus-one round trip holds for views the 1994 window can represent
   (an interior region: about half a window from the lot edges); both now
   declared here.

Dismissed: the stamped view lingering on the sim makes later undo snapshots
carry the last-saved camera (inert: restore is keepCamera-gated, and
undo signatures compare tower state, not JSON); a genuine 1994 save scrolled
to the exact top-left imports centered (the (0, 0) words are byte-identical
to "never scrolled", an inherent format ambiguity with a benign fallback).

### Completion Notes List

- `SerializedView` rides `SerializedGame.view` as inert cargo; `Simulation`
  carries it in a public `view` field the tick loop never reads. Absent field
  = center() fallback; no SAVE_VERSION bump, no migration.
- Trust boundary in `Simulation.deserialize` (`coerceView`): malformed shapes
  drop to null, finite out-of-range values clamp to the grid and to
  `VIEW_ZOOM_MIN/MAX` (moved to engine/types; TowerEngine re-exports them as
  MIN_ZOOM/MAX_ZOOM so the range lives in one place).
- Restore runs through `TowerEngine.applyView` → `setCamera` (clampZoom) +
  `clamp()` (viewport-aware bounds), so a view saved on another device is
  re-bounded for this one. `start()` covers the boot-loaded autosave;
  `setSim` covers every adopt. Undo/redo (`keepCamera`) now leaves the camera
  alone, which also removes the old always-recenter-on-undo wart.
- `SaveLoad` stamps via the new `getView` dep on save/autosave/exports;
  `importLegacy` keeps the TDT file's own view on the imported sim while the
  pre-adopt flush stamps the live camera onto the outgoing tower.
- TDT words: pure `viewWordsFromView`/`viewFromViewWords` in tdtFormat.ts,
  anchored on the documented New Tower default; exporter writes real words
  when a view exists (defaults otherwise, byte-identical to before), importer
  reads 0x26/0x28 ((0,0) = no view). Zoom does not travel to 1994.

### File List

- src/engine/types.ts
- src/engine/Simulation.ts
- src/render/excalibur/TowerEngine.ts
- src/main.ts
- src/game/saveLoad.ts
- src/storage/tdtFormat.ts
- src/storage/tdtImport.ts
- src/storage/tdtExport.ts
- src/tests/viewStateParity.test.ts (new)
- src/tests/fixtures/tdtBuilder.ts
- src/tests/gameControllers.test.ts
- src/tests/gameControllersCoverage.test.ts
- docs/canon/tdt-format.md
- package.json
