# Copilot Instructions

Verticopolis is a browser-native clone of SimTower (1994): a TypeScript app
(Excalibur.js, Vite, Vitest) over a Rust/WASM simulation engine (`engine-rs/`),
which is the engine the shipped game runs on.
[`CONTRIBUTING.md`](../CONTRIBUTING.md) is the contributor guide and
[`AGENTS.md`](../AGENTS.md) adds the agent layer. When this file disagrees with
them, they win.

## Reviewing a pull request

This file is the review method. Do these steps on every PR, in order:

1. **Activate one review skill first, before any other tool call.** Use
   `gds-code-review` when the diff touches gameplay or engine code
   (`engine-rs/`, `src/engine/`, `src/render/`, `conformance/`, `src/storage/tdt*`,
   economy, ratings, events, elevators, facilities, RNG). Use `bmad-code-review`
   for everything else (other storage, tooling, build/CI, UI plumbing, docs). A mixed
   diff uses `gds-code-review`. Both are in `.agents/skills/`.
2. **Then, only if the diff touches `engine-rs/`, `conformance/`
   or the save loaders (`src/storage/`), also activate `engine-review`** (`.github/skills/`)
   as a checklist. So a review activates one skill, or two when this step
   applies, and never any other skill.
3. **Run the skill's layers inline.** Read its `SKILL.md` and `steps/*.md` from
   the checkout (`.agents/skills/<skill>/`). You cannot spawn subagents or run a
   skill's scripts, so skip those steps and do the Blind Hunter, Edge Case Hunter
   and Acceptance Auditor passes yourself. The review rules in
   [`AGENTS.md`](../AGENTS.md) (Review guidelines) apply too.
4. **Hot-path diff:** if it touches a surface in section 1 of
   [`docs/performance/hot-path-review.md`](../docs/performance/hot-path-review.md),
   apply items HP-1 to HP-12, trace callers in the repo, and print the section 6
   table with one row per item. Mark each finding `patch` or `defer` (section 7),
   pre-existing ones too. Review ported and moved code as new. Flag any dropped
   or bypassed cache, index or counter (HP-8).
5. **Check these dimensions,** with a few high-signal findings over filler:
   correctness and edge cases (floor ranges, basements, null guards); engine
   purity and determinism (no DOM, `Date.now` or `Math.random` in the sim;
   rendering never mutates engine state); gameplay balance against the SimTower
   model; untrusted saves and imports degrading gracefully; hot-path cost.
6. **End the review with this exact line:**
   `Reviewed against Verticopolis conventions (.github/copilot-instructions.md).`

## Rules for code you write or review

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four pass before pushing. `npm run build` needs the engine package
(`npm run wasm:build`), or `VC_ALLOW_NO_ENGINE=1` for a build that cannot run the
game. Copilot reviews are one-shot snapshots, so re-request one after pushing
fixes for its findings.

- Flag any unit test (`*.test.ts`) that starts a real engine (Rust or the
  TypeScript reference) or replays recorded engine answers: unit tests mock the
  engine port with `vi.fn` spies, use JSON fixtures only as canned answers, and
  assert the calls made and what the code did with the answers. Real-engine
  checks belong in `*.integration.test.ts` or Rust tests. Also flag a test
  whose assertions cannot fail when the code it names breaks: one named for a
  behavior that only checks "does not throw", or one that asserts a mock
  returned what the test told it to (`CONTRIBUTING.md` → What every test must
  do).
- Do not add tests that match workflow YAML, Playwright or Vitest config text
  (`CONTRIBUTING.md` → Quality gates).
- American English everywhere. No new em-dashes in prose, no "X, not Y"
  restatements, no AI marketing vocabulary. Keep copy plain.
- Keep gameplay and UI conditions readable: reject `done: bit(0)` or
  `flags & 4` where the number hides a domain fact. Use one named flag or
  predicate per fact. Numeric positions are fine inside codecs, serialization,
  dispatch bitsets and deliberately low-level tests (`AGENTS.md`).
- A published analytics number comes from a governed definition or from tested
  code bound to one (`CLAUDE.md` non-negotiables).
- A new facility starts in the Rust engine (`engine-rs/src/facilities.rs` and
  its catalog), never as a render-layer special case. The Rust engine is the
  source of truth for gameplay rules, caps and tuning; until the TypeScript
  reference engine is deleted, `src/engine/facilities.ts` follows it under the
  catalog digest.
