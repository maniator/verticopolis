# SPEC: Gameplay analytics — economy actions + emergencies (#611)

Cookieless PostHog (rule D-1). Follows the merged app-chrome layer (#614). This
story instruments the two untracked gameplay surfaces: the economy/editor action
side and fires/emergencies. Deep review is `/gds-code-review` (gameplay).

## Design party decision log (2026-07-23)

Cast: game architect (engine/shell boundary), game designer (signal worth), a
privacy/security lens (cookieless invariant), analytics (event-model shape).

### CAP-1 — Economy actions: one parametrized gameplay event

`economy_action { action; detail? }`, a NEW top-level event mirroring
`app_action`'s proven shape (closed union, breaks down by dimension), but kept
separate because `app_action` is app-chrome and this is gameplay (different
surface, `gds-code-review` not `bmad`). Three union values, distilled from nine
raw editor buttons by grouping into behaviors, not buttons:

- `demolish` (detail: `sell` | `bulldoze`) — PER-ACTION. The big gap: `noteBuild`
  covers placement, nothing covers removal. Rare and intentful enough to keep
  each one. One choke point `buildActions.ts` `tryRemoveUnit` (the shared
  removal gauntlet; the `verb` param already is the detail), plus the transport
  refund path.
- `price_tune` — SESSION-LATCHED (once). "Did the player engage with pricing at
  all this session." Covers rent up/down, rung price pick, batch pricing apply.
  The VALUE set is deliberately not captured (per-action noise). Hooks in
  `editorActions.ts`.
- `capacity_tune` — SESSION-LATCHED (once). "Did the player respond to transport
  pressure." Covers add/remove elevator car and paid shaft extend. Count not
  captured. Hooks in `editorActions.ts`.

Cut, considered low-signal (do not re-litigate): elevator schedule edit, film
policy, retail variety reroll, rung-price granularity/value, rent value.

Absent systems (nothing to hook, noted so nobody hunts): no loan, no bankruptcy,
no game-over. Debt is just negative `sim.money`, no user gesture. Buried treasure
is a sim payout on a user dig (hybrid windfall, not a decision) — left alone.

### CAP-2 — Emergencies: split user-choice from simulation occurrence

Two distinct things, two distinct shapes:

- `emergency_choice { kind; decision }` — PER-OCCURRENCE, user-fired. kind ∈
  `fireRescue` | `bombThreat`, decision ∈ `accept` | `decline`. The genuine
  stakes decision (pay for rescue vs gamble the containment roll). Wired at the
  `showEventChoice` callback (`frameLoop.ts:117-120`, the shell/user gesture).
  Timeout auto-decline is SIM-fired and is NOT logged: a timeout is the absence
  of a choice, logging it as "decline" fabricates intent the player never
  expressed. Only the human click emits.

- `session_emergencies { fires; firesGutFloors; bombs }` — ONCE at session end,
  simulation-fired counts, mirroring `session_builds` / `session_fps`. Answers
  the user's actual question ("do we mark fires happening?" = the sim-fired
  ignition). Emit EVEN WHEN ALL ZERO: "% of sessions with zero fires" needs the
  denominator (the session_fps lesson). Kept small: `fires` (count),
  `firesGutFloors` (severity, from the existing `gut(u)` path), `bombs`
  (detonations). NO currency amounts (thief cash stolen etc.) — that drags
  toward per-person money tracking; counts and floor tallies only. Santa/VIP
  cosmetic, cut. TOWER win already covered by `star_reached` star 6, not
  double-covered.

### CAP-3 — Engine/shell boundary (the sim -> shell signal)

`EventSystem.ts` is engine: DOM-free, render-free, does NOT import analytics. No
`track()` call goes in `startFire()`. The engine already tracks its burning set
and can keep plain integer counters (fires ignited, floors gutted, bombs
detonated) as data. The SHELL reads those counters at its `end`/session-end path
and hands them to `GameplaySession` — exactly as `noteBuild` is called from the
shell after a build, never from the engine. New accumulator lives in
`GameplaySession` next to `builds`/`peakFloors`, emitted in `end()`.

### CAP-4 — Privacy / cookieless line (confirmed)

Every event: no cookie / no localStorage id, per-session and cohort only never
per-person, host-gated, never-throw. NO player-authored free text (tower/unit
names never sent). All detail dimensions are closed enums (unit kinds, verbs,
emergency kinds/decisions); all counts are integers. No currency figures in any
event. A later "which unit name did they bulldoze" is a hard no.

### Wiring / ceiling

- `demolish` -> `buildActions.ts` `tryRemoveUnit` (not a ceiling file).
- `price_tune` / `capacity_tune` -> `editorActions.ts` (not a ceiling file).
- `emergency_choice` -> `frameLoop.ts:117-120` shell callback.
- `session_emergencies` -> engine integer counters read by the shell at session
  end, into `GameplaySession`. Engine stays render/DOM/analytics-free.
- None of it touches `saveLoad.ts` or `main.ts` (both at the 500-line ceiling).

### Dashboard (tooling)

Four tiles: `economy_action` by `action`; `demolish` sub-broken by `detail`
(sell vs bulldoze); `emergency_choice` as a kind x decision 2x2; and from
`session_emergencies`, "% of sessions with a fire" + "avg floors gutted when one
happens". Each carries the cookieless per-session/cohort caveat in words.
