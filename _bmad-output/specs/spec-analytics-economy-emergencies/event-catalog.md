# Event catalog (#611)

Load-bearing companion to `SPEC.md`. The exact event shapes, hook sites, cadence,
and vitest acceptance criteria. Every event is host-gated (fires only on a
deployed host) and never-throw, matching the existing analytics pipe.

## Events

| Event | Fields (closed enums / integers only) | Cadence | User- or sim-fired | Hook site |
| :-- | :-- | :-- | :-- | :-- |
| `economy_action` | `action: "demolish" \| "price_tune" \| "capacity_tune"`; `detail?: "sell" \| "bulldoze"` (demolish only) | `demolish` per-action; `price_tune` / `capacity_tune` session-latched once | user-fired | `demolish`: `src/game/buildActions.ts` `tryRemoveUnit` (+ transport refund path). `price_tune` / `capacity_tune`: `src/game/editorActions.ts` |
| `emergency_choice` | `kind: "fireRescue" \| "bombThreat"`; `decision: "accept" \| "decline"` | per-occurrence | user-fired (the click only; timeout auto-decline emits nothing) | `src/game/frameLoop.ts` `showEventChoice` callback (~:126-133) |
| `session_emergencies` | `fires: int`; `firesGutRooms: int`; `bombs: int` | once at session end, even when all zero | sim-fired counts, shell-sampled | sampled each throttled frame in `src/game/frameLoop.ts` (`app.sim.events.counts`), emitted in `GameplaySession.end()` in `src/analytics.ts` |

## Coverage detail

- **`demolish`** — one choke point covers both the bulldoze tool and the editor-card Sell: `tryRemoveUnit(u, verb, quiet)` where `verb` is already `"sell" | "bulldoze"` (that is the `detail`). The transport refund path (`removeTransportWithRefund`) is the same behavior for shafts and emits `demolish` too (detail chosen to match the gesture).
- **`price_tune`** — latches on the first of: rent up/down, rung price pick / no-rate, batch-pricing apply. The value set is not captured.
- **`capacity_tune`** — latches on the first of: add elevator car, remove car, paid shaft extend (button or drag commit). The count is not captured.
- **`emergency_choice`** — the `EventSystem.pending` choice surfaced at `showEventChoice`; emit on the human's accept/decline. The sim-fired timeout auto-decline is the absence of a choice and emits nothing.
- **`session_emergencies`** — the engine (`EventSystem`) keeps three integer counters (fires ignited, rooms gutted by fire, bombs detonated), exposed via a public `counts` getter and reset per new game (a fresh `EventSystem`). The frame loop samples `app.sim.events.counts` each throttled tick into the session accumulator (which banks a departing tower's peak across a new game), and `GameplaySession.end()` emits the summed summary. Simulation sits at its line ceiling, so the shell reads the public getter rather than adding a delegator. The engine never imports analytics.

## Engine counter surface (CAP-3)

`EventSystem.ts` exposes three read-only integers, incremented where the events already occur:
- fires ignited — at `startFire()`.
- rooms gutted by fire — at the `gut(u)` / contained-burndown path.
- bombs detonated — at the bomb-threat detonation path.

Reset per new game alongside the rest of the emergency state. The frame loop samples the public `counts` getter each throttled tick; `GameplaySession.end()` emits the summary. No new sim->shell push is needed, and no Simulation delegator is added (that file is at its line ceiling), so a plain getter read keeps the engine analytics-free.

## Acceptance criteria (vitest)

1. **Host-gate** — on a non-deployed host, none of the three events fire.
2. **Per-action** — two demolishes fire two `economy_action { action: "demolish" }` with the right `detail` each.
3. **Latch** — three `price_tune` gestures fire one `economy_action { action: "price_tune" }`; likewise `capacity_tune`; the two latch independently.
4. **Latch reset** — `gameplaySession.reset()` clears both latches (test isolation; in production the latch lives for the tab).
5. **Emit-zero** — a session with no emergencies still emits exactly one `session_emergencies { fires: 0, firesGutRooms: 0, bombs: 0 }` at end.
6. **Counts flow** — engine counters incremented by N surface as N in the emitted `session_emergencies`.
7. **Timeout-not-logged** — an auto-declined (timed-out) emergency emits no `emergency_choice`.
8. **Choice shape** — accept and decline each emit `emergency_choice` once with the right `kind`/`decision`.
9. **Engine-stays-analytics-free** — a source check that `src/engine/EventSystem.ts` imports nothing from the analytics module.

## Dashboard tiles (tooling follow-up)

Four tiles in `scripts/posthog-dashboard.mjs`, each carrying the cookieless per-session/cohort caveat in words:
1. `economy_action` broken down by `action`.
2. `demolish` sub-broken by `detail` (sell vs bulldoze).
3. `emergency_choice` as a `kind` x `decision` 2x2.
4. From `session_emergencies`: "% of sessions with a fire" and "avg rooms gutted when a fire happens".
