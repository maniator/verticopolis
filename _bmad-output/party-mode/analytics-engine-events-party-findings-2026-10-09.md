# Analytics on the engine: party findings (2026-10-09)

Issue: maniator/verticopolis#873 (backlog row `analytics-engine-events`).
Room: Winston (architect), Cloud (game architect), Amelia (dev), Vex
(security), Grumbal (adversary), Boundary (edge cases), John (PM), Mary
(analyst), Samus (game designer), Paige (tech writer). Owner direction in the
issue body. Session mode.

## What the owner asked for

The Rust engine becomes the one place that detects gameplay-level analytics
events. It emits provider-agnostic structured events; platform layers forward
them through thin adapters; platform-only analytics (page views, UI chrome,
browser errors, store behavior) stay on the platform; the engine knows no
vendor; events never enter the save or the hashed views; events are testable
on both engines while both run.

## What exists today (read from the code, not from memory)

| Piece | Where | Note |
| --- | --- | --- |
| Typed vocabulary | `src/analyticsCore.ts` (`GameplayEvents`) | 16 names, TypeScript only |
| Send choke point | `trackEvent` in `analyticsCore.ts` | host gate, common props, desktop consent hold |
| Vendor seam | `src/analyticsAdapter.ts` (`AnalyticsAdapter`, `relayAdapter`) | PostHog relay plus Vercel page plumbing; one swappable binding |
| Session folds | `src/analyticsSession.ts` (`GameplaySession`) | first-build latch, tool mix, build depth, fps reservoir, emergency banking, session clock |
| Detection sites | `src/game/frameLoop.ts` (star diff at 6 Hz, emergency counter sampling, choice modal), `buildActions.ts`, `keyboardPlay.ts`, `editorActions.ts`, `saveLoad.ts` (new game) | the shell re-derives gameplay facts from engine state |
| Engine side | `EventSystem.counts` (fires, gut rooms, bombs) | the engine exposes counters and imports no analytics |
| Private shell | `desktop/shell/src/sessionWiring.ts` | forwards through the public game's desktop ingest route; no second vocabulary |

## Where the current shape conflicts with the model

1. Detection is in the shell, not the engine. `star_reached` is a 160 ms
   poll comparing `sim.star` to `app.lastStar`; two promotions inside one
   poll collapse to one event. `first_build` is a shell latch around the
   build action, so a build that enters through any other host command
   (the editor, a replay, a native client) is invisible. `session_emergencies`
   reconstructs outbreaks from counters by watching them go backwards.
2. The vocabulary lives in one TypeScript file. The Rust engine has no
   knowledge of it, and a native client would have to re-type it.
3. Nothing today says which events are gameplay facts and which are session
   or platform facts. `app_action`, `boot`, `crash`, `update`, `session_fps`
   and `session_end` are platform facts and belong where they are;
   `economy_action`, `emergency_choice`, `star_reached`, `first_build`,
   `tool_used`, `new_game_started` and the emergency tallies are gameplay
   facts the engine already knows at the exact moment they happen.
4. Two engines run until the default flips. Any detection done once in Rust
   has to be done once in TypeScript too, or the flag changes what is
   reported.

## The design the room converged on

### One stream, two kinds of consumer

The engine keeps a drain buffer of gameplay events, outside the save and
outside `stateView` and `crowdView`. The host drains it after each tick and
hands the batch to the platform. Two platform consumers read the same batch:
the analytics adapter (today's `trackEvent` path) and, later, a milestone
sink for store achievements (`milestone_reached` is in the catalog from day
one, so the private achievement adapter never needs a second source).

```
engine (Rust, and TypeScript until retired)
  -> drainGameplayEvents(): [{ name, payload }]        provider-agnostic
  -> host bridge (src/analyticsEngineBridge.ts)        one drain per frame
      -> GameplaySession folds (first_build, tool mix, depth, emergencies)
      -> trackEvent -> AnalyticsAdapter -> provider    unchanged seam
      -> milestone sink (later, private adapter)
```

### The catalog is the contract

A single file beside the engine, `conformance/events/catalog.json`, defines
every gameplay event: name, schema version, payload fields with closed types,
semantics, and cardinality (per occurrence or per tower). Rust reads it in a
unit test that checks `GameplayEvent` against it; the TypeScript side gets a
generated `src/engine/gameplayEvents.d.ts` the way `src/dualrun/engine.d.ts`
is generated today. A rename is a catalog change with a history note (the
`game_started` to `new_game_started` lesson stays written down).

Raw facts the engine emits (first cut, names open to the owner):

| Event | Payload | Replaces |
| --- | --- | --- |
| `tower_founded` | `mode` | `new_game_started` (shell call in `saveLoad.ts`) |
| `facility_placed` | `kind`, `floor`, `count` | `noteBuild` calls in three shell files |
| `facility_removed` | `kind`, `method` (sell or bulldoze) | `economy_action: demolish` |
| `pricing_changed` | `kind` | `economy_action: price_tune` (platform keeps the once-per-session latch) |
| `capacity_changed` | `kind` | `economy_action: capacity_tune` (same latch) |
| `star_reached` | `star` | the 6 Hz diff in `frameLoop.ts` |
| `fire_started`, `fire_gutted` (`rooms`), `bomb_detonated` | counts | the counter sampler and `session_emergencies` banking |
| `emergency_resolved` | `kind`, `decision`, `source` (player or timeout) | `emergency_choice` (the platform drops `timeout`, so today's "a timed-out decline reports nothing" holds) |
| `milestone_reached` | `id` | nothing today; the store-neutral milestone sink the private plan asks for |

Payload rule (Vex): closed enums and small integers only. No free text, no
tower name, no money amounts. A catalog test refuses a string field that is
not an enum.

### What stays on the platform

`boot`, `crash`, `update`, `session_end`, `session_fps`, `app_action` (saves,
dialogs, preferences, install), page views and Core Web Vitals. `tool_used`,
`first_build`, `session_builds`, `session_peak_floors`, `tool_session_uses`
and `session_emergencies` stay as platform folds over the engine stream,
because "session" is a platform concept (visibility, page hide, consent
window). The folds keep their names and their tests; only their input
changes from a shell call to an engine event.

Cloud's option, recorded and not taken for V1: an engine-side
`sessionSummary()` accumulator so a native client never reimplements the
folds. The room preferred the raw stream first; the folds are a few lines of
pure code, and the stream is what makes them testable from fixtures. Revisit
when the native client needs a second fold implementation.

### Both engines, one truth, until the flip

The conformance lock gains an `events` hash per checkpoint: the canonical
hash of the events drained since the previous checkpoint. The TypeScript
engine mirrors the emission points until `story-engine-retire-typescript`,
and the referee holds the two streams to the same hash the way it holds the
state. That is the owner's "events are testable on both engines" criterion,
and it is what stops the `?engine=wasm` flag from changing a dashboard.

Under the WASM host the TypeScript instance still runs the commands as a
read model, so it would emit duplicates. The host drains only the authority
engine and discards the instance's buffer (the relay already has a
`suppress` notion for exactly this).

### Determinism and the referee

Emission reads state after a transition and writes only to the drain buffer.
It never touches the RNG, the save, the clock, or the views. The buffer is
bounded (a ring, with a dropped counter) so a headless run that never drains
cannot grow memory, and the referee drains at each checkpoint. A unit test
asserts `serialize()` and `stateView()` are byte-identical with the buffer
full and with it empty.

### The vendor stays outside

`AnalyticsAdapter` is unchanged. The bridge merges common props and sends
through `trackEvent` as today, so the host gate, the desktop consent hold,
and the never-throw guarantee are untouched. A native build points its own
adapter at the same drained JSON. PostHog, Vercel, and whatever a store
wants never appear below the bridge.

## Migration, in order, preserving behavior

1. Catalog, Rust `GameplayEvent`, drain buffer, `drainGameplayEvents` on the
   WASM binding, TypeScript mirror on `Simulation`, `events` hash in the
   conformance lock. No analytics code changes yet. Gate: referee green with
   the new hash on every scenario.
2. `src/analyticsEngineBridge.ts`: drain after each tick in `frameLoop.ts`
   and feed `GameplaySession` and the action trackers. Retire the shell
   detection sites one at a time, each with its existing analytics test
   rewritten to feed an event instead of calling a hook. The event names on
   the wire do not change in this step, so dashboards keep working.
3. Add `milestone_reached` to the wire as a new event (additive).
4. Private shell: nothing to do for forwarding; the achievement adapter
   subscribes to the bridge when that story opens.
5. When the TypeScript engine retires, its mirror goes with it and the
   catalog test keeps Rust honest alone.

## Open for the owner

- Event names: keep today's wire names where the fold emits them
  (`first_build`, `star_reached`) and use the raw names above for the new
  engine stream, or rename the wire too in one dashboard migration.
- Whether `emergency_resolved` with `source: timeout` should reach the
  provider (today it deliberately does not; the room kept today's behavior).
- Whether to take Cloud's engine-side session summary now or after the
  native client exists.

## How the room got there (short form)

Grumbal opened with the 3 a.m. page: two engines, two drains, every event
twice, and a dashboard that quietly doubles the day the flag flips. Amelia
answered with the `suppress` path the relay already has and a test that
counts. Cloud wanted the whole vocabulary, folds included, in the engine so a
native client reimplements nothing; Winston held that "session" is a platform
word and the folds stay where the page lifecycle is, and Cloud settled for an
option on the record. Vex drew the payload line (no text, no money, no
names) and got it into the catalog as a test instead of a sentence. Boundary
found the unbounded buffer in a headless run and the double-promotion inside
one 160 ms poll, which is the clearest case for engine emission the room had.
Samus asked for `milestone_reached` so achievements and analytics never
disagree about progress, and Mary made the measurement case: a stream the
referee hashes is the first analytics in this project that can be proven
identical across platforms. Paige closed by making the catalog the one place
the names are written, so nobody fixes the sentence above the list again.
