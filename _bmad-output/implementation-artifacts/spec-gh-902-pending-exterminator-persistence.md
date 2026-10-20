---
title: Preserve pending exterminator bookings across engine attachment
type: bugfix
created: 2026-10-16
status: in-progress
baseline_commit: 8f3a14353
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
---

<frozen-after-approval reason="Previously accepted cutover plan S5, executed under the owner's complete migration request">

## Intent

**Problem:** Saving or attaching the WASM host after an exterminator booking loses the billed room IDs. A later infestation then receives unpaid treatment because a missing list retains the legacy tower-wide fallback.

**Approach:** Persist the optional billed room list in both engines and carry it through host merges. Keep old saves readable, without a save-version bump, as the canonical cutover plan S5 requires.

## Boundaries & Constraints

**Always:** Preserve Classic behavior, preserve the absence of new fields in saves without bookings, use the same coercion in both engines, bound untrusted lists and keep treatment membership linear. Keep optional legacy semantics: absent list means tower-wide treatment, a present invalid list authorizes no rooms. IDs are positive integers below 2^31, deduplicated in input order and capped at the lot unit ceiling.

**Ask First:** Changes to the save version, paid treatment rules, or unrelated API contracts.

**Never:** Edit performance or rendering branches, flip the default engine, publish 3.0.0, or change TDT.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Pending booking | Room A billed, B becomes infested later | Save/load and attach preserve A only | No extra charge |
| Completion | Due date reached | A clears, B stays infested, pending state disappears | Missing or demolished A ignored |
| Legacy save | Due date present, list absent | Existing tower-wide treatment retained | No migration failure |
| Malformed list | Present non-array, invalid IDs, duplicates, oversized list | No coercion, unique valid bounded IDs retained | Present invalid list becomes empty |
| No booking | No valid due date or Classic | No list restored or written | Ignore orphan list |

</frozen-after-approval>

## Code Map

- `src/engine/serializedGame.ts`, `src/engine/sim/serialization.ts`, `src/engine/sim/coerce.ts`: optional saved field and loader trust boundary.
- `engine-rs/src/sim.rs`, `engine-rs/src/load.rs`, `engine-rs/src/services.rs`: matching persistence, hardening and treatment membership.
- `src/wasmhost/merge.ts`: preserve pending IDs and clear completed bookings.
- `src/engine/sim/exterminationPersistence.test.ts`: cheap invariant regression.
- `src/tests/integration/wasmHost.integration.test.ts`: actual WASM attachment regression.
- `src/tests/integration/loaderCases.integration.test.ts`, `conformance/`: cross-engine lock evidence.

## Tasks & Acceptance

**Execution:**
- [ ] Add optional field, conditional writer and matching loader coercion in both engines.
- [ ] Adopt the saved pending list through host merge and clear absent values.
- [ ] Add unit regressions for booking, clearing, relapsing and malformed/legacy loads.
- [ ] Add Rust and actual WASM attach regressions and conformance input cases.
- [ ] Run applicable gates and mandatory `gds-code-review`, recording triage.

**Acceptance Criteria:**
- Given A was billed and B was not, when saved, reloaded or attached mid-booking, then the treatment clears only A.
- Given a completed treatment, when a later room relapses, then a new paid booking can be made without stale IDs.
- Given legacy saves without IDs, when loaded, then their current tower-wide treatment is preserved.
- Given corrupt input, when loaded by either engine, then both retain the same bounded valid list and do not grant extra treatment from malformed lists.

## Spec Change Log

## Design Notes

S5 explicitly permits the optional field and resulting conformance hash change. Rollback to a pre-S5 engine discards the field and can clear later infestations too; the lead integrator records that compatibility exception. The issue's original suggestion that treatment never lands is stale: current resolution with absent IDs clears every infested hotel. Tests pin the observed failure.

## Verification

- Focused TypeScript unit and WASM integration tests.
- Loader conformance regeneration followed by Rust loader replay and full referee.
- Typecheck, lint, ordinary tests, production build, Rust format/clippy/tests and WASM build as available.
- Mandatory three-layer `gds-code-review`, including save-input hardening and engine architecture concerns.
