---
title: 'Shard update-screenshots.yml for faster CI'
type: 'chore'
created: '2026-07-12'
status: 'done'
baseline_commit: '8ff1bfb'
context: ['{project-root}/_bmad-output/implementation-artifacts/backlog.md']
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** `update-screenshots.yml` renders ~70 shots with no GPU (software raster) in the pinned container, and the parallel determinism guard renders the whole set twice. Each generation is ~15 min, so a regen ties up runner time and is too slow to reuse on every PR (the planned drift-check followup depends on this being fast).

**Approach:** Split the `shoot` capture into 3-4 parallel shards, each rendering an explicit subset of scenes via the generator's existing `ONLY=` env. Keep the two-run determinism guard, but diff PER SHARD (run-a shard-N vs run-b shard-N) and assemble the committed gallery from run-a's shards. The shard partition lives in ONE script that is derived from the real `SCENES` and self-verifies that its groups' union equals every scene id, so a shard can never silently drop a scene from coverage.

## Boundaries & Constraints

**Always:** The shard partition is an EXPLICIT scene-id group list, never a count/index split. A coverage check MUST fail the workflow if the union of shard groups != the full `SCENES` id set (missing OR duplicated). The determinism guard stays: every shot is generated twice and byte-compared before anything is committed. Keep the workflow's concurrency group, marker/dispatch triggers, `contents: write` perms, the pinned-image resolution, and the bot commit + rebase-retry push. Preserve the "why this guard exists / do not delete" rationale in comments.

**Ask First:** Changing the shard COUNT beyond 3-4, or moving the generation into a reusable (`workflow_call`) workflow, or altering what triggers the workflow.

**Never:** Do not sample or drop scenes to go faster (subset-blindness is the exact trap this must avoid). Do not weaken the guard to a single generation. Do not touch `scripts/screenshots.ts` capture logic or any `src/**` app/determinism code. Do not implement the PR drift-check here (separate later PR, already in the backlog).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List a shard's scenes | `screenshot-shards.ts print <shard>` | prints that shard's scene ids as a comma list for `ONLY=` | unknown shard name → exit 1 with the valid names |
| Coverage OK | shard groups cover every `SCENES` id exactly once | `screenshot-shards.ts verify` exits 0 | N/A |
| Coverage gap | a scene id is in no shard, or in two | `verify` exits 1 naming the missing/duplicated id | fail the job |
| One shard nondeterministic | run-a shard-N != run-b shard-N | `verify-and-commit` fails, nothing committed | `::error::` naming the differing shot(s) |
| All shards match | every shard's two runs identical | commit run-a's assembled gallery, push | N/A |

</frozen-after-approval>

## Code Map

- `.github/workflows/update-screenshots.yml` -- the workflow to shard: `resolve-image` (add a coverage-verify step), `shoot` (add a `shard` matrix dimension crossed with `run: [a,b]`, pass `ONLY=` from the shard script, upload `shots-<run>-<shard>`), `verify-and-commit` (download all, diff per shard, assemble gen-A gallery, commit).
- `scripts/screenshot-shards.ts` -- NEW. Single source of truth for the partition. Imports `SCENES` from `screenshot-scenes.ts`, defines `SHARDS: Record<string, string[]>`, and exposes `print <shard>` (emit `ONLY=` list) and `verify` (assert union == every scene id, no gaps/dupes). Erasable TS, run via native type-stripping like the other scripts.
- `scripts/screenshot-scenes.ts` -- read-only here: source of the `SCENES` id list the shard script validates against.
- `_bmad-output/implementation-artifacts/backlog.md` -- design + constraints of record (this work + the deferred drift-check).

## Tasks & Acceptance

**Execution:**
- [x] `scripts/screenshot-shards.ts` -- add the shard map + `print`/`verify` CLI, importing `SCENES` so the id set is never hand-duplicated; `verify` fails on any scene not in exactly one shard.
- [x] `.github/workflows/update-screenshots.yml` -- cross the `shoot` matrix with `shard`, source each job's `ONLY=` from `screenshot-shards.ts print`, name artifacts `shots-<run>-<shard>`; add a `verify` step in `resolve-image` (or a tiny gate job) so coverage is checked once before any capture; rewrite `verify-and-commit` to download every `shots-*`, diff run-a vs run-b per shard, and assemble the committed gallery from the `shots-a-*` artifacts.
- [x] `scripts/screenshot-shards.ts` -- self-check invoked in CI covers the coverage edge cases (gap, duplicate) via the `verify` command; a local `node scripts/screenshot-shards.ts verify` is the unit-equivalent.

**Acceptance Criteria:**
- Given the workflow runs, when the shards capture in parallel, then wall-clock for generation is roughly one shard's worth (~1/N) instead of the whole set, and the committed gallery is identical to what the unsharded generator would produce.
- Given a future scene is added to `SCENES` but not to any shard, when CI runs, then the coverage `verify` step fails before any capture, naming the uncovered scene.
- Given any single shot renders nondeterministically, when the two runs are compared, then `verify-and-commit` fails and commits nothing.

## Design Notes

Partition by rough cost so shards finish together (migration + milestones are ~50s/shot; showcase has the most shots). A workable 4-way split: `["showcase","mobile"]`, `["migration","milestones"]`, `["overlays","basement","stats","palette-unlock","condo-modes"]`, and the remaining small scenes. Exact grouping is tunable; correctness comes from `verify`, not the balance.

`verify-and-commit` assembles from `shots-a-*` (gen A) after the per-shard diffs pass; gen B exists only to be compared. Diff per shard (`diff -rq /tmp/a-<shard> /tmp/b-<shard>`) rather than merging first, so a failure points at the shard.

Each shard uploads the FULL set of shots it rendered (every PNG touched during the capture step, found via a `find -newer` timestamp marker; the generator rewrites each shot it renders, so even byte-identical shots are captured), not just files that differ from the committed base. This is deliberate, from the code review: uploading the full per-shard set makes the sharded pipeline equivalent to a single unsharded run. `verify-and-commit` rebuilds the gallery from scratch (`rm -rf docs/screenshots`, then overlay the union of run-a shards) so a removed scene's stale file is pruned exactly as the old whole-tree assembly did (an overlay-only merge would strand it); a `present == 0` guard refuses to touch the tree if no shard gallery arrived, so a download failure cannot commit a wiped gallery. The full-set upload also lets the per-shard diff byte-compare every rendered shot directly rather than relying on changed-file transitivity. The authoritative shard list in `verify-and-commit` comes from `resolve-image`'s `shards` output (parsed with `jq`), so that job needs no Node or `npm ci`; `resolve-image` runs `npm ci` (browser download skipped) because the shard script's SCENES import pulls in node_modules deps. Shard names are constrained to `^[a-z0-9-]+$` by `verify` so a rename can never mis-split the CI matrix.

## Verification

**Commands:**
- `node scripts/screenshot-shards.ts verify` -- expected: exit 0, prints coverage OK; temporarily removing a scene from the map makes it exit 1 naming the gap.
- `node scripts/screenshot-shards.ts print showcase` -- expected: comma-joined scene ids for that shard.
- `npm run typecheck && npm run lint && npm test && npm run build` -- expected: all green (shard script is erasable TS; no app code touched).
- Actual sharded regen correctness is proven by the workflow itself (per-shard two-run guard); a full local container run is optional given the guard.
