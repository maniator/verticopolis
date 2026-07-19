---
title: 'Stage 4 split of src/main.ts into game/ friend-modules (gh-365)'
type: 'refactor'
created: '2026-07-19'
status: 'in-progress' # draft | ready-for-dev | in-progress | in-review | done
context:
  - '{project-root}/_bmad-output/specs/spec-refactor-large-files/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-refactor-large-files/split-plan.md'
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent, do not modify unless human renegotiates">

## Intent

**Problem:** `src/main.ts` is 1,676 lines, three times the 500-line review ceiling, and the last non-test source file on `src/tests/fileSize.ratchet.txt`. The `spec-refactor-large-files` split-plan named seven Stage-4 target modules, but it was written when the file was 1,471 lines and only accounts for ~743 lines; it never rehomed the ~350 lines of UI command-port methods or the 279-line constructor, so those seven alone leave the shell near 940 lines.

**Approach:** Carve the `GameApp` behavior into cohesive `src/game/` friend-modules (free functions taking the live `GameApp` instance, re-reading `app.sim`/`app.engine` per call so the `adoptSim` swap stays visible), extending the plan's seven with three cohesive extras (`audioPrefs`, `appModals`, `trafficHud`) and two constructor helpers, until the `main.ts` shell is under 500 lines. Behavior-preserving moves only; then delete `src/main.ts` from the ratchet so the guard enforces the ceiling.

## Boundaries & Constraints

**Always:**
- Behavior-preserving moves only. No bug fix, perf tuning, or API addition rides along; a tempting cleanup is recorded as a `defer`, not applied.
- Preserve the `window.game` runtime surface: `sim`, `engine`, `speed`, `grid`, and (any-cast) `selectPicked`/`selected`/`refreshEditor`, plus the e2e-called methods `onUpdateAvailable`/`setSpeed`. These stay reachable on the `GameApp` instance.
- Preserve the `renderEditor(key, build, volatile)` volatile-patch protocol and the `adoptSim` swap invariant (friend-modules never capture `sim`/`engine` by value).
- `class GameApp implements GameAppPorts` still compiles: every `GameAppPorts` method stays a real method (thin delegator to a friend-module where the body moved).
- Friend-modules use `import type { GameApp } from "../main"` (type-only, no runtime cycle); touched `private` fields relax to `/** @internal */` public.
- All four quality gates green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. No `package.json` version bump (internal-only).

**Ask First:**
- If any single move cannot stay behavior-identical without a semantic change.
- If, after all cohesive extractions, the shell cannot reach <500 without an incoherent cut (SPEC Open-Question fallback: a documented one-line ratchet exemption instead).

**Never:**
- No new controller-class object graph for these splits (SPEC CAP-7 / Non-goals: friend-modules only).
- No reshaping of serialized data, no touching `e2e/visual.spec.ts-snapshots/**` or `docs/screenshots/**`.
- No rewrite of `createUICallbacks`/`GameAppPorts` shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| adoptSim swap | Load/new/import replaces `app.sim` | Every friend-module (frameLoop, buildPreview, wireEngine, ...) sees the new sim on its next call | N/A |
| e2e drives window.game | `game.onUpdateAvailable(...)`, `game.setSpeed(3)`, any-cast `game.selectPicked` | Same methods present and behaving as before the split | N/A |
| Per-frame throw | `runFrame` throws mid-tick | wireEngine's onUpdate guard still catches, throttles the log, pushes to the frame-error ring | swallow + continue |
| Boot with unreadable save | `SaveGame.loadResult().corrupt` | Same splash/toast/bulletin path as before | falls back to new tower |

</frozen-after-approval>

## Code Map

- `src/main.ts` -- the `GameApp` shell to shrink: fields, constructor wiring, selection helpers, `adoptSim`, small command-surface methods + delegators.
- `src/game/engineWiring.ts` (new) -- `wireEngine` + `rebuildEngine` + `MAX_FRAME_ERRORS`.
- `src/game/inputKeys.ts` (new) -- `bindKeys`.
- `src/game/frameLoop.ts` (new) -- `runFrame` + `emitMealRushes` + `SPEEDS`/`MAX_CATCHUP_MINUTES`.
- `src/game/buildPreview.ts` (new) -- `updateBuildPreview`/`updateBuildRefusal`/`clearBuildRefusal` + `placeSimpleBuild`/`isTransportTool`/`isPaintTool` + `pickedAt`.
- `src/game/panelAnchoring.ts` (new) -- `positionPanels` + `selectedScreenRect`.
- `src/game/updateFlow.ts` (new) -- `onUpdateAvailable`/`updateCoastClear`/`maybeSurfaceUpdatePrompt`/`showUpdatePrompt` + resume-update consts.
- `src/game/audioPrefs.ts` (new) -- audio/a11y/steady-clock/prefs-save methods.
- `src/game/appModals.ts` (new) -- stats + exterminator + manual-slot modal actions.
- `src/game/trafficHud.ts` (new) -- `updateTraffic`.
- `src/bootstrap.ts` (new) -- `hasWebGL`/`showBootMessage`/`bootGame`.
- `src/tests/fileSize.ratchet.txt` -- delete the `src/main.ts` line.
- `src/tests/integration/gameControllers.integration.test.ts` -- keep the `placeSimpleBuild`/`pickedAt` mirror comment references pointed at the new home.

## Tasks & Acceptance

**Execution:**
- [ ] Extract the seven plan modules (`engineWiring`, `inputKeys`, `frameLoop`, `buildPreview`, `panelAnchoring`, `updateFlow`, `bootstrap`) as friend-modules; relax touched fields to `@internal`.
- [ ] Extract the three cohesive extras (`audioPrefs`, `appModals`, `trafficHud`) and fold `rebuildEngine`/`pickedAt` into their natural modules.
- [ ] Slim the constructor: extract controller-wiring and boot/splash-flow into helpers.
- [ ] Update `main.ts` call sites and keep `GameAppPorts` methods as delegators; keep imports minimal.
- [ ] Delete `src/main.ts` from `fileSize.ratchet.txt`; keep the gameControllers mirror comment true.
- [ ] Run all four gates green.

**Acceptance Criteria:**
- Given the branch, when `npm run typecheck && npm run lint && npm test && npm run build` runs, then all four pass and the file-size guard reports `src/main.ts` under 500 lines with no ratchet entry.
- Given `git diff --stat`, when inspected, then no file under `e2e/visual.spec.ts-snapshots/` or `docs/screenshots/` is touched and `package.json` version is unchanged.
- Given the running app (e2e), when it boots/builds/renders, then `window.game` behaves identically (integration + visual specs pass).

## Design Notes

Friend-module signature idiom (matches SPEC CAP-7 "sibling files that take the instance"):

```ts
// src/game/panelAnchoring.ts
import type { GameApp } from "../main";
export function positionPanels(app: GameApp): void { /* body, reads app.engine/app.selected */ }
```

`GameAppPorts` methods whose body moved keep a one-line delegator so the interface still binds and `createUICallbacks` is untouched:

```ts
showStats(): void { showStats(this); }   // body in game/appModals.ts
```

`bootstrap.ts` exposes `bootGame(create)` (the DOM-ready boot block), which takes an app-factory rather than importing `GameApp`; `main.ts` calls `bootGame(() => new GameApp())` at the very bottom, after the `GameApp` class is defined, so there is no runtime import cycle (the friend-modules import `GameApp` type-only).

## Spec Change Log

- 2026-07-19: Architect and Dev party (Winston/Amelia) ratified the friend-module pattern (not deps-slice controllers) and a strict <500 target with the ratchet line deleted. The SPEC Open-Question exemption does not apply here: every extraction needed to reach <500 is a genuinely cohesive concern (`audioPrefs`, `appModals`, `trafficHud`), so no incoherent cut triggers the fallback, and the `GameAppPorts` delegator stubs are ordinary facade delegation rather than line-count chasing. Constructor slimmed via two friend helpers, `wireControllers` and `runBootFlow`. `rebuildEngine` folds into `engineWiring`, `pickedAt` into `buildPreview`. Touched fields are exposed as `/** @internal */`. The gameControllers mirror comments were updated.

- 2026-07-19 (review round): (1) An isolate-diff render (main vs branch in the pinned container) proved the refactor changed exactly 2 screenshots (`features/traffic-chip*`). Root cause: `updateTraffic` was part of the any-cast `window.game` surface (the screenshot scenes call it to pin the chip), and moving it off `GameApp` without a delegator silently no-oped the call. Restored the `updateTraffic()` delegator and widened the `window.game` surface doc; re-render confirms the two shots are byte-identical to main again (0 real drift, no gallery regeneration). (2) Coverage: added unit tests for the headless-testable friend-modules (trafficHud, panelAnchoring, audioPrefs, appModals, buildPreview, updateFlow, inputKeys, frameLoop, engineWiring's wireEngine); excluded the two boot/constructor-wiring entries (`bootstrap.ts`, `game/appBoot.ts`) from coverage as parity with the already-excluded `main.ts` composition root (behavior still smoke-tested). All four gates green. (3) Copilot: swept em-dashes in the changed files, fixed the spec bootstrap API name.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors.
- `npm run lint` -- expected: clean.
- `npm test` -- expected: all green, including `fileSize.guard`, `gameControllers*`, `bootScreen`, `onboarding`.
- `npm run build` -- expected: succeeds.
- `git diff --stat -- e2e/visual.spec.ts-snapshots docs/screenshots package.json` -- expected: empty.
