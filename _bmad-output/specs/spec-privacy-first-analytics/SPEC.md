---
id: SPEC-privacy-first-analytics
companions:
  - ../../project-context.md
  - transparency-note.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Derived from `.memlog.md` (the decision of record); do not hand-edit, re-derive through bmad-spec.

# Privacy-first player-depth analytics (execute E1e)

## Why

The Vercel Web Analytics custom-event feed (`src/analytics.ts`) is cookieless, gate-parity-clean, and consent-free, and it already answers tool mix, crash reliability, and update adoption. Two questions it does not answer: where the first-tower funnel leaks, and whether returning players climb higher. Backlog `#385` records the mobile epic's item E1e, the "privacy-first analytics decision," as never made and silently dropped scope.

An installed-room party (session mode, 2026-07-21; party memlog 144-148) ruled 5-1 against migrating to PostHog. The only capability a second platform uniquely buys is a cross-session retention curve, which needs a persistent identifier, which re-arms a consent banner the project will not ship, and which cookieless PostHog cannot deliver anyway. The answer: do the identity join on the device, emit only anonymous aggregates, and close the one real gap on the feed already owned. This SPEC executes that decision and refines mobile-PRD decision-log entry 13 (F8/E1e): the privacy-first cookieless tool is the Vercel feed already shipped, so no Plausible or Umami swap is needed. It also cuts a PostHog migration and parks self-hosting (see Non-goals), so E1e becomes a written decision instead of silent drift.

## Capabilities

- **CAP-1: One-file analytics seam**
  - **intent:** the vendor and transport call lives in exactly one adapter module; `bootstrap`, `gallery`, `helpPage`, and the game loop keep calling the typed gameplay vocabulary, so a future provider swap is a one-file diff.
  - **success:** grep finds no `@vercel/analytics` import outside the single adapter; the Vercel channel behaves byte-identical to today behind the existing `telemetryHostAllowed` gate; a stub adapter drives the whole event vocabulary in tests without a vendor SDK.

- **CAP-2: First-tower funnel as ordered steps**
  - **intent:** the `game_started` then `first_build` then `star_reached(2)` sequence reads as a three-step funnel with a fresh-foundings denominator, so the two real drop points become visible: founded a tower but never placed anything, and built something but never earned a rating.
  - **success:** the existing events already fire in this order for a founded tower, so no new event type is needed; the funnel, its denominator, and the two drop percentages are documented and shown on the dashboard. A test pins that a fresh founding emits `game_started` before its `first_build`.

- **CAP-3: Returning-player depth (on-device join, anonymous buckets)**
  - **intent:** answer "do returning players climb higher" as a cross-tab of return status against progression, with no identifier ever leaving the device.
  - **success:** the `boot` event carries a `returning` boolean read off the persisted onboarding-seen flag (zero new state), plus coarse `tenure` and `sessions` buckets derived from one purely-local first-seen-plus-boot counter; the dashboard cross-tabs `returning` and the two buckets against `star_reached`. No cookie, no consent banner, and no raw count or timestamp is transmitted.

## Constraints

- **Cookieless by construction.** No cookie, no localStorage identifier is transmitted, no cross-session or cross-device identity is built, and no consent banner ships as the price of pressing Play. This is the load-bearing invariant the whole SPEC exists to honor.
- **The local counter never leaves the device raw.** The first-seen timestamp and boot tally that feed CAP-3 are read only to derive a coarse bucket; the raw values are never sent. A precise first-seen millisecond is quasi-identifying; a coarse `month1+` is not.
- **Coarse buckets only, for k-anonymity.** Each bucketed dimension has at most four brackets: `tenure` in `new` / `day1` / `week1` / `month1+`, `sessions` in `1` / `2-5` / `6-20` / `20+`. Boundaries are chosen so no single cell of the returning-by-depth cross-tab can narrow to one player on the current population, and they are revisited if a cell ever nears uniqueness.
- **One gate for every surface.** `telemetryHostAllowed` remains the single predicate every telemetry call obeys; the native Capacitor shell, localhost, and the e2e preview stay dark by that same gate. No second divergent gate is introduced.
- **Rides the existing `boot` event, no new event type.** `returning`, `tenure`, and `sessions` are added props on the boot snapshot (which already carries mode, star, floors, population), preserving the low-volume vocabulary that fits Vercel's event budget: one boolean and two low-cardinality buckets, never a per-user identifier.
- **Best-effort and never-throw preserved.** A missing or corrupt counter degrades to omitting the field rather than throwing; analytics can never block boot or the game loop.
- **Near-zero bundle.** This SPEC stays on the Vercel channel and adds no SDK; the code delta is the seam extraction plus a few derived fields. Any future SDK (a parked possibility only) would be lazy-loaded off the boot path with a measured mobile delta, and that is out of scope here.
- **Decision per metric.** Every field names the decision it would drive and the threshold that flips it: the funnel drop points steer onboarding versus mid-game design work; a flat or falling returning-by-depth cross-tab flags a mid-game wall worth a design pass. A field that names no decision does not ship.
- **Player-facing transparency note.** The `transparency-note.md` copy ships with the change, stating that the game counts how far returning players get and never who they are. That note is player-facing, so the PR takes a patch version bump even though the telemetry itself is internal.
- **Process.** One PR carries the seam, the CAP-3 fields, the funnel documentation, the transparency note, and tests. Four quality gates green, and `/gds-code-review` in-session, because the correctness at stake is gameplay-progression semantics (what the funnel steps and the "climbs higher" cross-tab mean), per the TDT-is-storage-but-gds-reviewed precedent. Implementation is a separate PR after this spec.

## Non-goals (the signed cut)

- **Migrating to PostHog or any second analytics platform.** Cut. It re-pipes three answers already owned, adds a vendor, a CSP surface, and a public write key in a public repo, and cannot answer retention cookielessly.
- **Self-hosting an analytics backend.** Parked. It is the only road that can ever answer a true cohort retention curve, unlocked only if the owner funds identity plus operations against a named decision; the E4 monetization gate of mobile-PRD entry 13 is the likely trigger.
- **The true cohort retention curve** (day-7 and day-30 unique-return rate), churn, and per-cohort funnels. These require cross-session identity the project is choosing not to build. They are parked and named, and never faked with a cookieless proxy that would return confident garbage.
- **Any cross-session or cross-device identifier, cookie, or consent banner.**
- **Native-shell telemetry.** The iOS Capacitor shell stays dark; this SPEC makes no App Store data-disclosure change.
- **Session replay, autocapture, DOM or pointer or keystroke capture, PII, and raw IP.**

## Success signal

Within one sprint of shipping, the Vercel dashboard answers both open questions: the first-tower funnel drop percentages at each step, and a returning-by-depth cross-tab (`returning`, and the `tenure` and `sessions` buckets, against `star_reached`) showing whether repeat players get further. The change ships with no consent banner, a near-zero bundle delta, and the transparency note live. If the funnel and the cross-tab are not live and answering within a sprint, E1e is not shipped and its backlog row stays open.

## Assumptions

- The onboarding-seen flag is a fair proxy for a returning browser. It is per-browser and clears on cache-clear or private browsing, so the signal is browser-return rather than person-return. That ceiling is accepted, since the alternative (a persistent identifier) is exactly what this SPEC refuses.
- Vercel Web Analytics accepts a boolean and two coarse bucket props on the existing `boot` event within the event budget. These are low-cardinality dimensions, not a per-user identifier.
- The seam extraction is behavior-identical for the Vercel channel. The existing analytics and telemetry tests plus a stub-adapter test pin that the vocabulary and the host gate are unchanged.
