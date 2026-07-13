---
id: SPEC-refactor-large-files
companions:
  - split-plan.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Split large files into cohesive modules behind stable barrels

## Why

A vision to keep the codebase habitable. Eighteen source files and eight test files have grown past 500 lines, topped by `Simulation.ts` at 2,891 and `TowerEngine.ts` at 2,429. Oversized files hide the review gates the project depends on (sub-quadratic hot paths, canon-cap fidelity, DOM-free engine): a reviewer cannot hold a 2,900-line god-object in their head, so regressions slip through green gates. The work is a behavior-preserving refactor that carves each giant into named modules under 500 lines, adds the missing shift-left nets that make the carve safe, and installs a size guard so the files never grow back. It changes nothing a player can see; it changes everything a maintainer has to reason about.

## Capabilities

- **CAP-1**: Regression nets exist before any file moves.
  - **intent:** A maintainer can prove a "pure move" changed no behavior, because determinism, byte-level, and barrel-surface guards are already green when the moves start.
  - **success:** New tests are committed and pass in Stage 0: a golden-master `Simulation` determinism snapshot (seeded `newGame`, scripted build script, many sim-days, stable-stringified `serialize()` pinned); a repo file-size guard failing any `src`/`scripts` code file over 500 lines (with a shrinking allowlist); barrel-surface tripwires asserting each barrel still exports its documented names; and `ByteWriter` unit tests including the header back-patch.

- **CAP-2**: Every oversized source file is split into modules each under 500 lines.
  - **intent:** A reader can open any former giant and find its concern in a purpose-named sibling module, reaching it through the same import path as before.
  - **success:** After Stage 4, no file under `src/` or `scripts/` (excluding the size-guard's explicitly-listed test carve-outs, which Stage 5 clears) exceeds 500 lines; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` are all green.

- **CAP-3**: Public import surface is unchanged.
  - **intent:** Any existing importer (source, test, tool, e2e, screenshot script) keeps compiling and running without edits to its import statements.
  - **success:** Barrels (`facilities.ts`, `Simulation.ts`, `pixelSprites.ts`, `render/sprites/structure.ts`, `tdtImport.ts`, `tdtExport.ts`, `tdtFormat.ts`, `SaveGame.ts`, `UI.ts`, `ToneAudioEngine.ts`, `screenshot-builders.ts`, `screenshot-scenes.ts`, `TowerEngine.ts`, `EconomySystem.ts`, `Crowd.ts`, `Tower.ts`, `saveMigration.ts`) re-export every name they exported before; no non-test source file outside a split package has its import lines rewritten to reach a moved internal; the barrel-surface tripwire from CAP-1 passes.

- **CAP-4**: TDT save round-trip stays bit-exact.
  - **intent:** The legacy `.TDT` reader and writer keep their engine-data fidelity through the storage decomposition.
  - **success:** `tdtExport.test.ts` and `tdtImport.test.ts` pass unchanged; `buildTDT` output re-imports with zero importer warnings and re-exports byte-for-byte identical; the shared semantic tables live in one leaf module that both reader and writer import, and the `PART_STACKS`/`PART_FAMILY`/`FAMILY_STORIES` tripwire still holds.

- **CAP-5**: Rendering stays pixel-identical.
  - **intent:** The render-layer split produces the same pixels frame-for-frame, so no visual baseline is touched.
  - **success:** `e2e/visual.spec.ts-snapshots/**` and `docs/screenshots/**` are unmodified in the diff; draw functions are moved verbatim with explicit parameters (no in-pass "improvement"); the existing sprite/heatmap/render tests pass.

- **CAP-6**: Oversized test files are split without losing coverage.
  - **intent:** A maintainer can split a large test file and prove no assertion was dropped in the move.
  - **success:** In Stage 5, each test file over 500 lines is divided by moving whole `describe` blocks verbatim into sibling spec files; the total vitest test count is identical before and after each split; the size-guard allowlist is emptied and the guard passes with zero exemptions.

- **CAP-7**: The stateful giants are split without widening their public surface or churning serialization.
  - **intent:** `Simulation`, `Tower`, `TowerEngine`, and `Crowd` are decomposed by moving method groups into friend modules that operate on the instance, not by inventing new object hierarchies or reshaping saved state.
  - **success:** Extracted engine/render logic lives in sibling files that take the instance and touch fields marked `@internal`; `serialize`/`deserialize` keep their current shape and the golden-master snapshot from CAP-1 is byte-identical; no new class is added to the public API of these modules.

## Constraints

- No `package.json` version bump: the refactor is internal-only with zero player-facing change, and a bump would misreport the build.
- `src/engine/` stays free of DOM and rendering; canon build caps and transport pooling stay owned by the `facilities` barrel (`BUILD_CAPS`, `POOLED_CAPS`, `MAX_CARS`, `maxSpanFor` remain the single source of truth).
- Screenshot builder exports stay fully self-contained: each is serialized via `page.evaluate(fn).toString()`, so no shared module-scope helper and no cross-function call may be introduced; splitting moves whole functions only, and cross-file duplication is required, not a smell.
- The two type-invisible runtime contracts are preserved exactly: the `window.game` surface (`sim`, `engine`, `speed`, `grid`, and the any-cast `selectPicked`/`selected`/`refreshEditor` read by `e2e/` and `scripts/`), and the `renderEditor(key, build, volatile)` volatile-patch protocol between `main.ts` and `UI.ts` (with `patchVolatile`/`anchorBeside` still importable from `ui/UI`).
- Names tests import by identity keep working from their original path: re-export moved symbols from the original module rather than rewriting test imports (`patchVolatile`, `anchorBeside`, `SfxName`, `sceneFor`/`detailFor`/`midiToFreq`, the `pg*`/`build*` screenshot functions, and all engine/storage named exports).
- Execution is five risk-ascending stages with all four quality gates green and one commit at each stage boundary, so any regression bisects to a single stage.
- The mandatory deep review runs in this same session: `/gds-code-review` (engine/gameplay + TDT + render surfaces) and `/bmad-code-review` (tooling/UI-plumbing surface); every `patch` finding is fixed and re-verified, every `defer` recorded in `_bmad-output/implementation-artifacts/backlog.md`.

## Non-goals

- No behavior change, bug fix, performance tuning, or API addition rides along; a tempting cleanup spotted mid-move is recorded as a `defer`, not applied.
- No re-minting of visual baselines or doc screenshots, and no host-browser screenshot capture treated as authoritative.
- No redesign of the stateful classes into subsystem/controller object graphs; friend modules only.
- `src/styles.css` (1,522 lines) is out of scope: it is one intentional generation of CSS per the design system, not a code file to shard.
- No splitting of a file merely to hit a line count when the result would be less cohesive than the whole; the 500-line target yields to the cohesion rule when they conflict, and such a case is surfaced, not forced.

## Success signal

A reviewer opens the branch, runs `npm run typecheck && npm run lint && npm test && npm run build`, watches all four pass, and confirms `git diff --stat` touches no file under `e2e/visual.spec.ts-snapshots/` or `docs/screenshots/`. The file-size guard is green with an empty allowlist: every code file in `src/` and `scripts/` is under 500 lines. The golden-master `Simulation` snapshot is unchanged, and the TDT round-trip suite proves byte-identical export idempotence. The game plays, looks, and saves exactly as it did before the branch existed.

## Assumptions

- The eight test files over 500 lines (`simulation`, `uiDialogs`, `gameControllersCoverage`, `tdtImport`, `tdtExport`, `storage`, `faqComplete`, `gameControllers`, `tower`, `calendar`) are in scope under the whole-`describe`-block, count-parity rule.
- `src/styles.css` is deliberately excluded (see Non-goals); the user's "over 500 line files" targets code.

## Open Questions

- If any single former giant cannot reach under 500 lines without a split that harms cohesion (a candidate is the `deserialize` block in `Simulation` and the reconcile/motion maps in `TowerEngine`), the fallback is a documented, minimal size-guard exemption for that one file rather than a forced incoherent cut. Confirm this fallback is acceptable if it arises, or whether the file should be pushed under 500 regardless.
