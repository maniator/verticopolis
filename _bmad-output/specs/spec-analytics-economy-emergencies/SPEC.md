---
id: SPEC-analytics-economy-emergencies
companions:
  - event-catalog.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only, consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Gameplay analytics: economy actions + emergencies (#611)

## Why

An opportunity to close two blind spots left by the cookieless PostHog migration. The app-chrome layer (#614) instruments save/export/settings and the like, and placement is covered by `noteBuild`/`noteToolUsed`, but two whole gameplay surfaces report nothing: the economy/editor action side (demolish, price tuning, capacity tuning) and the emergency subsystem (fires, bombs, the rescue choice). Today we cannot answer basic questions a SimTower-style game's balance depends on: do players ever demolish and rebuild, do they engage with pricing at all, and does a single fire ever ignite in the wild. This story adds that visibility while staying inside the cookieless invariant. It follows #614 and is reviewed with `/gds-code-review` (gameplay).

## Capabilities

- **CAP-1**
  - **intent:** A player who demolishes a facility, tunes pricing, or tunes transport capacity has that behavior recorded through one parametrized gameplay event `economy_action { action; detail? }`, so the economy action surface breaks down by behavior on a dashboard.
  - **success:** A demolish fires `economy_action { action: "demolish", detail: "sell" | "bulldoze" }` once per removal; the first pricing change of a session fires `economy_action { action: "price_tune" }` exactly once and never again that session; the first capacity change fires `economy_action { action: "capacity_tune" }` exactly once; no schedule edit, film policy, variety reroll, price value, or rent value is ever emitted. All host-gated, never-throw. Asserted in vitest.

- **CAP-2**
  - **intent:** When the player answers an emergency prompt (pay for rescue vs decline), that decision is recorded per occurrence so the accept/decline split is visible per emergency kind.
  - **success:** Clicking accept or decline on the prompt fires `emergency_choice { kind: "fireRescue" | "bombThreat", decision: "accept" | "decline" }` once per click; a timeout auto-decline emits nothing. Asserted in vitest.

- **CAP-3**
  - **intent:** The simulation-fired emergency activity of a play session (how many fires ignited, how many rooms they gutted, how many bombs detonated) is summarized once at session end, so fire occurrence and severity are measurable across the population.
  - **success:** Exactly one `session_emergencies { fires; firesGutRooms; bombs }` emits at the terminal `pagehide` (tab close / navigation / bfcache) of a session that had any play, including when all three counts are zero (so "fraction of sessions with a fire" has a denominator). It waits for `pagehide` rather than latching at the first `visibilitychange:hidden`, because fires ignite late and a mid-session tab switch would otherwise lock in a spurious zero. Counts come from engine integer counters reset per new game. No currency amount appears. Asserted in vitest.

- **CAP-4**
  - **intent:** Every event added here stays inside the cookieless privacy invariant.
  - **success:** No event carries a cookie, a localStorage id, a per-person identifier, any player-authored free text (tower or unit names), or a currency figure; all detail dimensions are closed enums and all counts are integers; every emit is host-gated and never-throw. Asserted by the same host-gate and shape tests plus a source check that `EventSystem.ts` imports no analytics.

## Constraints

- `src/engine/EventSystem.ts` (and the engine generally) must stay DOM-free, render-free, and analytics-free: it must not import the analytics module. The emergency counts surface as plain engine integers that the shell reads at session end and forwards to `GameplaySession`, mirroring how `noteBuild` is called from the shell after a build, never from the engine.
- `economy_action` is a distinct top-level event, not an extension of `app_action`: `app_action` is app-chrome, this is gameplay. Same shape and discipline (closed union, host-gated, never-throw, small vocabulary), different event.
- `price_tune` and `capacity_tune` are session-latched (emit at most once per session) because their underlying gestures fire repeatedly; `demolish` is per-action. The latch state lives with the existing session latches and is cleared only by the test-only `gameplaySession.reset()`.
- No hook may grow `src/game/saveLoad.ts`, `src/main.ts`, or `src/engine/Simulation.ts`; all sit at the 500-line ceiling. Hooks land in `buildActions.ts`, `editorActions.ts`, `frameLoop.ts`, `EventSystem.ts` (counters only), and the analytics module. `analytics.ts` itself crossed the ceiling with the new surface, so it is split into `analyticsCore.ts` (vocabulary + `trackEvent` + common props) and `analyticsActions.ts` (the free per-action trackers + latches); `analytics.ts` keeps `GameplaySession` and re-exports both, so every `./analytics` import is unchanged. The shell reads the emergency counters off the public `EventSystem.counts` getter (`app.sim.events.counts`) rather than adding a `Simulation` delegator, since that file is at the ceiling.
- Cookieless invariant (CAP-4) binds every event: closed enums and integer counts only, no names, no currency figures, host-gated, never-throw.

## Non-goals

- No loan, bankruptcy, or game-over telemetry: none of those systems exist. Debt is just negative `sim.money` with no user gesture to hook.
- No currency figures anywhere (not rent values, not price values, not thief cash stolen, not treasure payout). Amounts drag toward per-person money tracking.
- No buried-treasure event: it is a simulation windfall rolled on a user dig, a surprise not a decision.
- No simulation-fired rent/income/maintenance events: those are not user gestures and are out of scope for this action-surface story.
- No cosmetic emergencies (Santa, flavor headlines) and no TOWER-win event (already covered by `star_reached` star 6).
- Not double-covering placement/tool-use (already `noteBuild`/`noteToolUsed`).

## Success signal

After a week live, the dashboard answers three questions it cannot answer today: what fraction of sessions ever demolish a facility (and sell vs bulldoze), what fraction ever touch pricing or transport capacity, and what fraction of sessions have a fire ignite plus how many rooms it typically guts. The emergency-choice tile shows whether players pay for fire rescue but decline bomb threats. None of these answers is attributable to a person.

## Open Questions

- The four dashboard tiles (`economy_action` by action; `demolish` by detail; `emergency_choice` as a kind x decision 2x2; `session_emergencies` derived rates) are noted for the tooling follow-up in `scripts/posthog-dashboard.mjs`; whether they land in this PR or a follow-up is left to implementation sequencing.
