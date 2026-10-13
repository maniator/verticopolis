# Review: rubric walk of the Rust/WASM web cutover spine

Reviewer: rubric walker, BMAD architecture Reviewer Gate. Date: 2026-10-13.
Spine: `ARCHITECTURE-SPINE.md` (altitude epic, status final).
Parent: `architecture-engine-rust-port-2026-10-08.md`.
Stories: `story-engine-wasm-switch.md`, `story-engine-retire-typescript.md`.
Brownfield checked against `maniator/verticopolis` `origin/main` at 404bb9c
(after #949, #944, #941, #938).

## Verdict

**Revise before final.** The core ADs (AD-1 to AD-5) name real divergence
points and most Rules are enforceable. Four gaps keep it from passing: the
operational envelope for the 3.0.0 flip is not decided (offline, rollback
trigger, fallback observability), AD-3's tier map does not cover the binding
as it exists and names ops that do not exist, the inherited order row drops
two parent gates, and the retirement version is neither decided nor an open
question.

## Findings

### F1 (high): the operational envelope for the flip is left as "unchanged"

`Deferred` says deployment is unchanged and no new environment exists. That
holds for the flag, not for the default flip, which is the only release in
scope that changes what every player runs.

- **Offline / PWA.** AC5 of the switch story leaves the engine package out of
  the offline precache (confirmed in `vite.config.ts`). Once WASM is the
  default, an offline player has no engine and silently falls back to
  TypeScript; after retirement there is nothing to fall back to. Two players
  on the same build can run different engines depending on cache state. No AD
  or deferral covers precaching the package or pinning shell-to-package
  version skew (the service worker can serve an old shell against a new
  `src/public/engine/` or the reverse; `BUILD.json` only guards the commit).
- **Rollback.** AD-7 keeps the fallback (#874) but nothing says what triggers
  a rollback, who flips the default back, whether a stored `vc.engine` choice
  overrides it (`engineChoice.ts` honors storage), or what a failed Rust build
  on Vercel does to the deploy once WASM is the default.
- **Observability.** Retirement gate 1 requires that "the fallback flag has
  not been used" over two releases, and gate 2 requires no divergence in the
  field. The spine names no signal for either (load failures, refusals in
  `window.__vcEngine`, fallback use, `src/wasmhost/telemetry.ts`). A gate that
  cannot be measured cannot be passed.

Fix: add an AD (or an Open Questions entry with an owner) covering engine
package caching and version skew, the rollback trigger and mechanism, and the
telemetry that measures fallback use and load failures. Move "Deployment"
out of Deferred or narrow it to the flag phase.

### F2 (high): AD-3's tier map does not match the binding

`engine-rs/src/wasm.rs` exports far more than AD-3 classifies. Unassigned
exports include `advanceClock`, `seedElevatorTelemetry`, `seedLoopMemos`,
`emit`, `startFire`, `bombThreat`, `evaluateStar`, `setStop`,
`setExpressStops`, `clearStops`, `setSchedule`, `setView`, `setLabel`,
`setTowerName`, `autoBridge` / `setAutoBridge`, `resolveChoice`,
`rerollSubtype`, `sellAt`, and the persistence functions `importTdt`,
`exportTdt`, `encodeVctower`. Several of these (`advanceClock`, `seed*`,
`emit`, `startFire`, `bombThreat`) mutate state without the charge path and
are exactly the divergence AD-3 is meant to stop. Meanwhile
`towerSetCars` and `towerResizeTransport` appear in AD-3 and in the binding
names convention but exist nowhere in `engine-rs/` or `src/`, and the
existing tier 3 ops (`setMoney`, `setCars`, `resizeTransport`) do not carry
the `tower*` prefix the convention reserves.

Fix: make the rule exhaustive (every export is in exactly one tier, and the
source guard test fails on an unclassified export), assign the debug and
seeding ops to tier 3, put the persistence functions under AD-5, and either
drop the `tower*` names or state that they are planned renames.

### F3 (medium): the inherited order row drops parent gates

The Inherited Invariants row reads "switch, then #878, #873, one release on
TypeScript default, the flip as 3.0.0, then retirement". The parent's row 7
also gates retirement on `story-engine-tdt-port` (5), `story-engine-copy-catalog`
(6), two releases on WASM and a complete test-mapping table; the retire story
repeats them and adds the coverage floor. Restating an inherited invariant
with fewer gates weakens it. Fix: cite the parent table rather than paraphrase
it, or list every gate.

### F4 (medium): the retirement version is undecided and the sources disagree

The parent says retirement is internal (the major lands with the flip). The
retire story's AC5 says "Version bump: major". The spine decides 3.0.0 for
the flip and says nothing about retirement. Versioning is a dimension this
altitude owns. Fix: decide it (most likely the parent: internal, no bump, or
a minor if players see anything) and record that the story's AC5 must change,
or list it as an open question.

### F5 (medium): AD-1 and AD-2 have no owning story or gate

AD-1 reverses the switch story's current mechanism (the instance answers and
relays). That is a deliberate change rather than a contradiction, and the spine
says so, but no story or roadmap row carries it and the flip's gate does not
require it. AD-2 says "until #867 lands" without saying whether #867 is a
flip prerequisite. Fix: bind each to a story or a gate (for example "AD-1 is
a precondition of the flip").

### F6 (low): binds point at the wrong module

AD-6 binds `engine-rs/src/events.rs`, which is the port of
`EventSystem.ts`. Gameplay events are drained from `crate::gameplay`
(`engine-rs/src/gameplay.rs`, `drainGameplayEvents`). Fix the bind.

### F7 (low): AD-4's frame version does not exist yet

`FRAME_HEADER` and `PERSON_FIXED` exist; no layout version slot does. That is
fine as a rule to add, but the spine should say the header gains the slot
(and that adding it is itself a layout change the consumers must check).

## Checklist

| Item | Result |
| --- | --- |
| Fixes the real divergence points for the level below, misses none | Mostly. Command authority, step driver, mutation tiers, read model, save codec and events are the right set. Missed: engine package delivery and caching (F1). |
| Every AD's Rule is enforceable and prevents its divergence | AD-1, AD-4, AD-5, AD-6, AD-7 yes. AD-2 yes with a gate ambiguity (F5). AD-3 not as written (F2). |
| Nothing under Deferred could let two units diverge | Worker protocol, snapshot shape and crate semver are safe to defer. "Deployment: unchanged" is not safe for the flip (F1). |
| Named tech verified current | Matches the codebase: Rust `rust-version` 1.97, `wasm-bindgen =0.2.129` (lockfile 0.2.129), `serde_json 1.0.151`, TypeScript ^5.3.3 (resolved 5.9.3), Vite ^7.3.1 (resolved 7.3.6), Excalibur ^0.32.0 (resolved 0.32.0). Pass. |
| Ratifies rather than contradicts the brownfield codebase | Every path named exists on `origin/main`. Exceptions: the nonexistent `tower*` ops (F2) and the events module (F6). AD-1 knowingly changes current behavior (F5). |
| Inherited parent not weakened or contradicted | The order row is narrower than the parent (F3). The retirement version is unresolved between parent and story (F4). Otherwise consistent: lock over mirrored suites, fallback until retirement, threading after a profile with a serial reference. |
| Every dimension decided, deferred, or open | Missing: rollback, observability, offline delivery (F1); retirement versioning (F4). The spine has no Open Questions section at all; add one. |
| Scope | The spine discusses only `engine-rs/`, the web host and public issues. "Consumers outside this repository" (Deferred, #893) is generic. |
