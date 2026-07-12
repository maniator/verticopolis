---
title: 'Pixel 8a fast-speed crash: tile batching, catch-up clamp, crash-report screen'
type: 'bugfix'
created: '2026-07-12'
status: 'in-review'
baseline_commit: '3afeb401aed443cb655a0d26f11d2acd2a985863'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/investigations/pixel-8a-fast-speed-crash-investigation.md'
---

<frozen-after-approval reason="human-owned intent; do not modify unless human renegotiates">

## Intent

**Problem:** A 10,344-unit save renders as ~11,000 retained actors; 9,409 of them are one-tile floor/lobby actors
that alone cost ~55% of every frame (measured: 114ms paused p50 on desktop, 52ms without them). On a Pixel 8a at
fastest speed the sustained load makes Android drop the WebGL context, and the game silently autosaves and reloads,
losing all crash evidence. The player experiences this as random crashes anywhere in the tower.

**Approach:** Batch static floor/lobby tiles into one Excalibur TileMap (same baked canvases, pixel parity), clamp
per-frame sim catch-up so slow devices slow the game clock instead of stretching frames, and replace the silent
reload with a crash screen offering a downloadable crash-report zip (report JSON + tower save) and a prefilled
GitHub bug-report path.

## Boundaries & Constraints

**Always:** Keep `src/engine/` free of DOM/rendering. Keep hot paths sub-quadratic; no new full-collection scans
inside per-frame/per-tick loops. Keep the exact baked tile canvases (floorGfx, lobbyGfx variants, entrance slices)
so rendered pixels do not change. Keep picking behavior: tapping a floor/lobby tile still inspects that unit;
rooms/transports keep winning over structure tiles. The crash screen must be plain DOM (the GL context is dead) and
must still flush the autosave before anything else. American English, no em-dashes in new prose. Bump the version
(minor).

**Ask First:** Removing the 90-second double-crash detection entirely (plan keeps it as an extra advice line).
Regenerating visual baselines (only the pinned CI image may mint them).

**Never:** Re-enable Excalibur physics. Draw one oversized surface (keep banding rules). Auto-reload without player
action on context loss. Vendor new dependencies (fflate already ships zip support). No monetization or analytics in
the crash report; it contains only what the report shows the player.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Context loss mid-game | webglcontextlost fires | Autosave flushed, crash screen with explanation + Download report + Report bug + Reload | Save failure: screen says changes could not be saved, storage vs unexpected error distinguished |
| Download crash report | Click on crash screen | Zip with crash-report.json + tower .vctower downloads | Zip build failure surfaces an inline message, Reload still works |
| Second crash within 90s | sessionStorage timestamp fresh | Same screen plus advice to close other tabs/apps | n/a |
| Crash before any save exists | First-session sim behind splash | No autosave of throwaway boot sim (splash guard keeps holding) | n/a |
| Tap a floor/lobby tile (inspect) | No room/transport under point | pickEntityAt returns that unit via Tower.unitAt | Out-of-grid point returns null |
| Slow device at fastest speed | Frame takes 500ms+ | Owed sim minutes clamp; game clock lags rather than frames growing unboundedly | n/a |
| Tab restored after background | One huge dtMs | Clamp caps the catch-up burst | n/a |

</frozen-after-approval>

## Code Map

- `src/render/excalibur/TowerEngine.ts` -- structActors map, addStruct, lobbyTileGfx, pickEntityAt, syncScene, clearScene; TileMap replaces per-tile actors
- `src/engine/Tower.ts:96` -- unitAt(floor, x) grid lookup for picking fallback
- `src/main.ts:890-914` -- update() catch-up loop to clamp; frame-error ring buffer next to the tick guard (line 672); showBootMessage pattern for the crash screen card
- `src/game/saveLoad.ts:111-195` -- recoverFromContextLoss: keep flush + double-crash detection, route to crash screen instead of reload
- `src/game/crashReport.ts` -- NEW: build the crash-report zip (fflate zipSync) from sim + environment + recent frame errors
- `src/storage/SaveGame.ts:249` -- export(sim) produces the .vctower payload for the zip
- `.github/ISSUE_TEMPLATE/bug_report.yml` -- field ids (version, what-happened) for the prefilled issue URL
- `src/tests/gameControllersCoverage.test.ts:790-930` -- existing recoverFromContextLoss tests to update
- `package.json` -- version bump to 1.19.0

## Tasks & Acceptance

**Execution:**
- [x] `src/render/excalibur/TowerEngine.ts` -- Add a `structTiles` TileMap (columns=GRID.width, rows=GRID span, tileWidth=TILE, tileHeight=FLOOR, z=-1, pos mapping worldX/worldYTop) created in start(); syncScene reconciles unit->Tile graphics (keyed map unitId->Tile, graphic-compare guard so lit flips swap references only); reap clears cell graphics; clearScene resets; pickEntityAt drops the structActors loop and falls back to Tower.unitAt for floor/lobby -- removes ~9,409 actors from the scene
- [x] `src/main.ts` -- Clamp accMinutes after accumulation (cap: 30 sim-minutes of debt) with a comment explaining the degrade-to-slower-clock contract; add a 5-entry frame-error ring buffer in the tick guard; wire new SaveLoad dep showCrashScreen and implement the DOM crash card next to showBootMessage (explanation, save status, Download crash report, Report a bug link, Reload primary stamping RESUME_AFTER_RECOVERY_KEY)
- [x] `src/game/crashReport.ts` -- New builder: crash-report.json (version, timestamp, userAgent, viewport/dpr, memory if present, crash kind, repeat flag, tower summary, recent frame errors) + tower.vctower via SaveGame.export, zipped with fflate; prefilled bug-report URL helper (template=bug_report.yml, version + what-happened fields, instruction to attach the zip)
- [x] `src/game/saveLoad.ts` -- recoverFromContextLoss keeps the splash guard + flush + failure card paths, replaces auto-reload with deps.showCrashScreen({repeat, saveFailed...}); remove visibility-deferred reload (screen waits for the player instead)
- [x] `src/tests/crashReport.test.ts` -- New: unzip the built zip (fflate unzipSync), assert report fields and that the .vctower payload re-imports to the same tower; URL helper encodes fields
- [x] `src/tests/gameControllersCoverage.test.ts` -- Update context-loss tests: crash screen shown instead of reload, flush still happens, double-crash flag passed, failed-flush wording preserved
- [x] `package.json` -- Bump version 1.18.1 -> 1.19.0

**Acceptance Criteria:**
- Given the SIXSEVEN save, when the scene is built, then scene entity count drops from ~11,000 to under 2,000 and paused p50 frame time drops by roughly half (measured via the ablation harness).
- Given any tower, when floor/lobby tiles render via TileMap, then screenshots are pixel-identical to the actor path at the default zoom (visual e2e passes against existing baselines).
- Given fastest speed on a device that cannot sustain 120 sim-min/s, when frames stretch, then owed catch-up never exceeds the clamp and the game clock lags instead.
- Given a context loss, when the crash screen shows, then the tower is already flushed, the zip downloads with a valid save inside, the bug-report link opens the prefilled issue form, and Reload resumes into the tower.
- Given quality gates, when run, then typecheck, lint, test, and build are all green.

## Spec Change Log

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: all green
- Ablation harness (scratchpad soak/ablate scripts) against the built bundle with the SIXSEVEN save -- expected: paused p50 well under the 114ms baseline; entity count < 2,000
- `npm run e2e -- visual.spec.ts` (local smoke; pinned-image baselines remain authoritative in CI) -- expected: no floor/lobby tile diffs
