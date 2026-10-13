---
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
documentsIncluded:
  requirements: planning-artifacts/rust-wasm-web-cutover-plan-2026-10.md (FR1-FR6)
  prd: planning-artifacts/prds/prd-simtower-llm-style-2026-06-30/prd.md (parity bar only)
  architecture: planning-artifacts/architecture/architecture-engine-rust-port-2026-10-08.md
  epics: planning-artifacts/rust-wasm-web-cutover-plan-2026-10.md (sections 4-5)
  stories: implementation-artifacts/story-engine-*.md (wasm-switch, retire-typescript, fixed-time-step, owned-charges, test-parity, dual-run, conformance-suite)
  ux: not applicable
---

# Implementation Readiness Assessment Report

**Date:** 2026-10-13
**Project:** Verticopolis (public engine and web host: Rust/WASM web cutover)

## Document Inventory

| Type | Found | Notes |
| --- | --- | --- |
| Requirements | `rust-wasm-web-cutover-plan-2026-10.md` FR1-FR6 | No cutover-specific PRD; the plan's FRs are the requirement set |
| PRD | `prds/prd-simtower-llm-style-2026-06-30/` | Game PRD; supplies the gameplay-parity bar only |
| Architecture | `architecture/architecture-engine-rust-port-2026-10-08.md` | Whole document, no duplicate |
| Epics and stories | The plan's sections 4-5; `implementation-artifacts/story-engine-*.md` | No `*epic*` file. Existing engine stories predate the plan |
| UX | Not applicable | The cutover changes no player-facing surface |

No whole/sharded duplicates. Warning at discovery: the plan does not cite the
architecture document or the existing switch and retirement stories.

## PRD Analysis

### Functional Requirements

FR1 (single engine): All gameplay, prices, unlocking, time progression, RNG,
event eligibility, building, rent, emergencies and refunds are computed by
Rust. Web clients only send commands and render authoritative results.

FR2 (behavioral parity): Existing web player journeys keep their outcomes,
refusal reasons, logs, state transitions and undo/redo behavior, in Classic
and Modern and for migrated towers.

FR3 (persistence): Existing `.vctower` files and supported legacy saves import
and round-trip through WASM; malformed, oversized, corrupted and Unicode edge
cases fail safely and consistently, with no silent data loss.

FR4 (frontend contract): The web UI gets build previews, catalog and unlock
state, income breakdown, stats, logs, analytics events, frame and structural
data from a documented, versioned engine read model, with no UI-only
recreation of engine decisions.

FR5 (performance and reliability): Deterministic fixed-step simulation,
frame-rate-independent gameplay, bounded memory, WASM-host lifecycle recovery,
cancellation, attach and detach, and observable failure reporting.

FR6 (engine consumers): One public engine crate with compatible saves and
commands for the web and any other consumer; a shared-rule change passes the
public gates.

Total FRs: 6

### Non-Functional Requirements

NFR1: Determinism. Identical command and tick sequences give identical state,
hour and day effects at any render rate (plan A2a, B2).
NFR2: Performance. Cold load, save/import/export latency, tick throughput,
heap and a 5,000+ population tower measured against the TypeScript baseline,
with thresholds set from real devices (plan D1). The architecture adds: the
Modern profile is no slower on WASM on the late-game fixture.
NFR3: Reliability. Engine throws or panics never lose the tower; a rollback to
the TypeScript engine stays available until retirement (plan D4, E3).
NFR4: Privacy. Analytics consent, suppression and attribution behave as
before; engine events stay provider-agnostic (plan C3).
NFR5: Quality gates. Coverage thresholds hold (`vite.config.ts` engine floors
and the Rust job's ratcheting line floor) and CI stays green.

Total NFRs: 5

### Additional Requirements

- Architecture "Two engines, one simulation": a simulation change lands in
  both engines with the regenerated lock until retirement.
- Roadmap order (architecture "Order and gates"): switch (row 4), test parity
  (row 4b, #878), engine analytics (#873), one release on the TypeScript
  default with the new instrument, then the default flip as 3.0.0, then TDT
  (row 5), copy catalog (row 6), retirement (row 7) after two releases on WASM.
- Retirement gates (`story-engine-retire-typescript`): test-mapping table
  complete, Rust coverage floor at or above the TypeScript engine floors.
- Prose rules from project context (American English, no em-dashes, no
  marketing vocabulary).

### PRD Completeness Assessment

The FRs are clear in intent but not measurable as written: FR5 has no
numbers, and FR1 does not say which layer answers a command while both
engines exist. The plan restates the roadmap's phases as new epics A-E
without citing the architecture document or the stories that already own
them (`story-engine-wasm-switch`, `story-engine-test-parity`,
`story-engine-retire-typescript`), which risks a second, diverging plan.

## Epic Coverage Validation

### Coverage Matrix

Verified against `main` at `562f104` (2026-10-13), the open PR queue and the
public issues.

| FR | Delivered on main | In flight | Gap (no owner before this review) | Status |
| --- | --- | --- | --- | --- |
| FR1 | The engine alone ticks under `?engine=wasm` (switch AC2); engine-owned charges (#928); engine catalog with lock (#930, merged 2026-10-13) | #950 (capacity events in the simulation layer) | **Command answers still come from the TypeScript instance**: the host runs every command on the instance and relays it (switch story, "How it works"; `src/wasmhost/wasmHost.ts`). The step driver and day pace live in TypeScript (#867). The web UI still reads TypeScript tables (#921) | Partial |
| FR2 | Conformance lock (19 scenarios), dual-run day gate, e2e on both engines, nightly fuzzer | #878 test parity (in progress) | Refusal reasons and order are not pinned (#865); a long seeded random-command differential with full-save comparison is not an owned story (#945) | Partial |
| FR3 | Unicode repair and 32 MiB caps (#944, #941); byte-exact `.vctower` writer (#949); engine encoder (#937) | #953 (web writes through the engine) | JavaScript number semantics for hand-edited saves (#858); RNG state 0 reload (#856); rollback rule for saves once the copy catalog bumps the save version | Partial |
| FR4 | `frameView`, `logSince`, telemetry and housekeeping getters, `catalog` | none | Build quote and placement rules (#922), binding read model (#868), inspector read models (#919), catalog second slice (#926), web UI on the catalog (#921) | Partial |
| FR5 | Fixed-step drain (TypeScript), WASM host attach/detach | none | Engine failure fallback (#874), attach after a booking (#902), WASM perf baseline (#900), stats cost (#905), hour-boundary cost (#849) | Partial |
| FR6 | Public crate, conformance lock | none | Crate release with the lock and a semver policy (#893) | Partial |

### Missing Requirements

- Critical: **engine-authoritative command answers** (FR1). No issue or row
  owns moving the host from "the instance answers, the engine follows" to
  "the engine answers, the instance mirrors". Recommendation: a new P1 issue
  that gates the default flip, sequenced after #868 (result shapes) and #874.
- High: **measurable cutover thresholds** (FR5, NFR2). #945 states the gate
  without numbers. Recommendation: extend #945 with numeric budgets drawn
  from #900 and the architecture's "Modern profile no slower" rule.
- High: **raw mutation confinement** (FR1). #946 and #923 overlap; #950 adds
  relay-only `towerSetCars` and `towerResizeTransport` guarded by a source
  test. Recommendation: #946 owns the cutover-time decision (which raw ops
  leave the production binding); #923 keeps argument validation.

### Coverage Statistics

- Total FRs: 6
- FRs with a traceable owner for every remaining gap after this review: 6
- FRs fully delivered on main: 0 (expected before the flip)

## UX Alignment Assessment

### UX Document Status

Not found, and not required: the cutover must change no player-facing
surface (the major version bump at the flip is a milestone marker, not a UX
change).

### Alignment Issues

None. The one player-visible risk is refusal wording and order (FR2), owned
by #865 and #878.

### Warnings

The failure fallback (#874) needs a player-visible message rule if the
engine traps mid-session; that is copy, not a UX document.

## Epic Quality Review

### Critical Violations

- The plan's epics A-E duplicate the architecture roadmap rows 4, 4b, 7 and
  the existing stories. Two plans for one migration will drift. Fix: rebase
  the plan on the roadmap and keep only what it adds (gap stories and the
  release gate).

### Major Issues

- Epics are technical milestones (inventory, APIs, operations). Acceptable
  for an internal migration whose user value is "nothing changes", but each
  story needs a testable acceptance gate, which A1, A2, C4, D3 and D4 lack.
- Forward reference: B4 names "dedicated Web Worker" tests and defers them to
  D2; the current host has no worker, so B4 should name only the main-thread
  host.
- Stale status: section 9 still lists #930 as open; it merged as `562f104`.
  Section 6 lists #928 as "closed"; it merged as `a412060`.
- Section 9 mixes process notes unrelated to the cutover into the status
  list. The plan should state its own scope and nothing else.

### Minor Concerns

- "robust" in FR5 (Copilot thread on line 31) breaks the prose rules.
- "Existing issues should be extended" without naming #945 and #946, which
  were opened for this plan.

### Brownfield Checks

Integration points exist (the dual-run relay, the WASM host, the frame view,
the conformance lock). Migration and compatibility stories exist for saves;
rollback after the copy-catalog save version bump has no rule yet.

## Summary and Recommendations

### Overall Readiness Status

NEEDS WORK (planning). The roadmap behind the plan is sound and most gaps
already have issues; the plan text needs to be rebased on it, and three gaps
need an owner.

### Critical Issues Requiring Immediate Action

1. Open a P1 issue for engine-authoritative command answers and make it a
   flip gate.
2. Rewrite the plan as a delta on the architecture roadmap, with the current
   PR states and a dependency-ordered story list mapped to issues.
3. Extend #945 with numeric gates and #946 with the raw-op decision.

### Recommended Next Steps

1. Land #950 and #953 (open), then #878 and #874, then the command-authority
   story, then the flip checklist in #945.
2. Keep the dedicated Web Worker (#908) after the flip, and parallel phases
   behind a measured profile.
3. Re-run this assessment when #878 closes.

### Final Note

This assessment identified 11 issues across 4 categories (coverage, quality,
staleness, prose). Address the critical issues before implementation stories
start.

Assessor: BMAD implementation-readiness workflow, run 2026-10-13. Steps 3-6
were loaded together rather than one at a time; each was executed in order.
Menus were continued under the owner's standing instruction for this task.
