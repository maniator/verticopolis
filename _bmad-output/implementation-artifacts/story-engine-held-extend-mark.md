# Story: engine-held extend gesture mark (#990)

Status: review

## Story

As the owner of a second frontend, I want the engine to hold the extend
gesture's high-water mark, so that no frontend can bill a shaft extension
against a mark it supplies and get floors for free.

## Acceptance criteria (from #990)

1. The engine holds the mark in both engines: `beginExtend(id)` opens a
   gesture at the shaft's span, `extendTransport` bills against it, and
   `endExtend()` closes it. A tower swap, a load or a new gesture drops it.
2. The new commands relay through the dual-run mirror and the WASM binding.
3. `EditorActions` moves onto them and drops its caller-held mark.
4. A conformance scenario op pins a wiggling drag billed once.
5. The mark stays out of the save and the hashed views (the issue's words;
   the tests check the save and the state view).

## What landed

- **TypeScript:** `src/engine/sim/charges.ts` keeps the open gesture in a
  `WeakMap` keyed by the simulation, so it is never serialized, never in
  the state view, and gone with a swapped-in simulation (a load or an
  undo deserializes a new one). `beginExtend(id)` drops any open gesture,
  then opens one on a whole id naming an elevator and answers true;
  otherwise false. `extendTransport(id, end, targetFloor)` bills past the
  open gesture's mark when it is on that shaft, past the shaft's span
  otherwise, and widens the mark with what it paid. `endExtend()` closes it.
- **Rust:** `Simulation::extend_gesture` (never saved or hashed), with
  `begin_extend`, `end_extend` and the three-argument `extend_transport`.
- **Binding:** `beginExtend(id)` reads its id raw like the other charge
  commands (#923), and a malformed id drops the open gesture as
  TypeScript's does; `endExtend()`; `extendTransport` takes three
  arguments. The mark parsing (`parse_mark`, `RawMark`) is gone.
- **Mirror and shadow:** `beginExtend` and `endExtend` relay as commands;
  `extendTransport` relays three fields. The read-once `prepare` hook (#923
  round 5) existed only for the caller's mark and is gone.
- **Editor:** `EditorActions` tracks only which shaft and simulation the
  drag is on, opens the gesture on the first step (after the undo capture)
  and closes it in `endExtend`. A tower swapped in mid-drag has no gesture,
  so the drag begins a new one on it.
- **Attach:** the save a shadow or the WASM host starts from carries no
  gesture, so the open one rides with the boundary markers in the load
  command, and `fromSave` restores it in Rust when its id still names an
  elevator. `loadCommand` stays pure; both engines bill the rest of a drag
  in progress against the same mark the live tower held.
- **Conformance:** `beginExtend` and `endExtend` ops replace `hwmBottom` and
  `hwmTop`, in both runners and the scenario
  `engine-charges-classic`, whose drags are bracketed by them. Every
  explicit mark the scenario carried equalled what the engine now holds.
  Each drag is followed, once its gesture has closed, by a shrink and a
  regrow billed one floor, and two new checkpoints (`dragged` and `dragged
  down`) come before the next `setMoney`, so the lock pins each drag's money
  and each `endExtend`: dropping any one begin or end op from the scenario
  moves a hash. The lock is regenerated for the two new checkpoints and the
  `extended` events hash (the extra capacity events); the state and crowd
  hashes of every existing checkpoint are unchanged.
- **No version bump:** a drag bills as before. The one change a player could
  meet is a one-floor press after a lost pointer-up (#1014), which now
  bills a floor the drag already paid for zero times instead of twice: only
  ever cheaper, never a floor that was not paid once. It is not rare (a
  mouse released over the inspector panel loses the pointer-up), so #1014
  carries the trigger.

## Tests

- TypeScript unit tests: a wiggle billed once inside a gesture and again
  after it closes; a gesture only on an elevator, only on its own shaft,
  never inherited by a new gesture, dropped by a failed begin; the gesture
  out of the save and the state view, and absent from a deserialized
  simulation; an inflated
  caller mark buying nothing; raw `beginExtend` ids refused.
- Rust tests in `charges_tests.rs` cover the same billing, scope and
  out-of-the-save cases; the binding's native test covers
  `begin_extend_checked`.
- `dualRunEdits`: a gesture through the mirror stays in step (removing the
  mirror's `beginExtend` relay splits the engines' money, checked by hand
  during development), and a shadow started mid-drag starts in step.
- `chargeBindingRaw`: raw `beginExtend` ids refused in both engines, and a
  gesture, a press after it closes and an inflated fourth argument land with
  equal answers, states and events.
- The editor coverage test bills a shrink and regrow after `endExtend`.

## Review Findings

### Round 1 (`/gds-code-review`: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

- [x] [Review][Patch] A shadow or WASM host started from a live tower with
  an open gesture split the engines: the next step was free in TypeScript
  and billed in the fresh Rust engine (Edge Case Hunter with a repro,
  Blind Hunter, Acceptance Auditor) [src/dualrun/mirror.ts]: `loadCommand`
  closes the gesture; a dual-run test starts a shadow mid-drag and fails
  without it.
- [x] [Review][Patch] A one-floor button press billed against a gesture a
  lost pointer-up left open, and a tower swap mid-drag kept the old
  simulation in the editor's drag (Edge Case Hunter, Blind Hunter,
  Acceptance Auditor): the press closed the gesture and `clearSelection`
  ended the drag. Both reverted in round 2 (see there).
- [x] [Review][Patch] The gesture opened before the undo capture (Blind
  Hunter): the capture comes first. Behavior-neutral today (the gesture is
  not in the snapshot), kept for a clear order.
- [x] [Review][Patch] Test gaps (Blind Hunter, Acceptance Auditor): Rust
  tests for the gesture out of the save, the hashed view and a loaded
  simulation; the TypeScript test checks the hashed view; the raw-binding
  test checks both digests with a gesture open; another shaft's wiggle is
  billed every time in both engines; `endExtend` joins the glue check.
- [x] [Review][Patch] Docs: `engine-rs/API.md` and the cutover spine's
  tier 1 list name the new commands; the story's test claims match the
  tests.
- Dismissed (7): a selection change mid-drag re-billing (it predates #990;
  deferred in round 2 as #1014); `beginExtend`'s result unchecked in the
  editor (it refuses only what `isElevatorKind` already rules out);
  `endExtend` on the replaced simulation (it has no gesture and no relay); the
  public Rust field (every `Simulation` field is public to native code, which
  can set `money` too); a refused `beginExtend` op in the scenario and
  `endExtend` in the lock (both pinned across engines by `chargeBindingRaw`;
  the refused-begin half was only pinned in round 2); the backlog row marked
  done before merge (house style, as in #923); the scenario's mark equivalence
  (the unchanged lock shows it).

### Round 2 (`/gds-code-review`)

- [x] [Review][Patch] Round 1's `clearSelection` and button closes ended the
  editor's gesture but not the canvas drag: a selection cleared and restored,
  or a second finger on the button, during a held drag began a fresh gesture
  from the span, re-billing paid floors and recapturing undo mid-drag (Edge
  Case Hunter with a repro) [src/main.ts, src/game/editorActions.ts]: both
  reverted. The drag lifecycle (a lost pointer-up, a selection change while
  held) is deferred whole (its press half is new with #990, see round 3):
  backlog row `extend-drag-lifecycle`, #1014.
- [x] [Review][Patch] Round 1 dismissed a refused `beginExtend` op on the
  claim that `chargeBindingRaw` pinned it across engines, but its bad begins
  ran with no gesture open (Blind Hunter) [chargeBindingRaw]: it now opens a
  gesture, pays and shrinks, issues each refused begin, and requires the
  regrow billed and equal in both engines; the dual-run test regrows after
  its refused begins too.
- [x] [Review][Patch] `loadCommand` called the wrapped `sim.endExtend`, so
  on a tower a relay already watched it relayed an `endExtend` ahead of the
  load (Blind Hunter) [src/dualrun/mirror.ts]: it calls the engine's own.
- [x] [Review][Patch] Prose (Acceptance Auditor, Blind Hunter): the attach
  re-bills from the span, said so; "the hashed views" narrowed to the state
  view the tests check; the undo-order change called behavior-neutral.
- Dismissed (6): carrying the gesture into the shadow at attach (no UI path
  attaches mid-drag); a stale gesture on a reused id (ids are never reused
  within a tower); `endExtend` closing a gesture another caller opened (one
  editor drives gestures); no money check on the begin and end scenario
  ops (neither engine moves money there, and the unit tests pin it); the
  backlog row and the story status (house style); the scenario's mark
  equivalence (the unchanged lock shows it, and the Auditor traced it).

### Round 3 (`/gds-code-review`)

- [x] [Review][Patch] An attach mid-drag closed the gesture while the
  editor's drag went on, so every later wiggle of that drag was billed in
  both engines (Edge Case Hunter with a repro, Blind Hunter, Acceptance
  Auditor) [src/dualrun/mirror.ts, src/dualrun/shadow.ts,
  src/dualrun/commands.ts]: `loadCommand` reopens the gesture at its
  shaft's span and the load command carries the shaft, which the shadow
  reopens; the dual-run test wiggles after the attach and fails without
  the shadow's reopen.
- [x] [Review][Patch] With the round-1 button close reverted, a one-floor
  press inside a gesture a lost pointer-up left open is a step of it, which
  is new with #990 (on main the button billed from the span, so a floor
  the drag had paid for was billed again). Kept as the fairer behavior,
  pinned by the editor test, and noted on #1014, whose wording no longer
  says the whole lifecycle predates #990 (Edge Case Hunter, Blind Hunter,
  Acceptance Auditor).
- [x] [Review][Patch] The dual-run test's two refused begins ran back to
  back, so the second hid any gesture the first opened in Rust (Blind
  Hunter): each is followed by its own billed shrink and regrow.
- [x] [Review][Patch] The save and state-view checks ran only before any
  billing inside the gesture (Blind Hunter): a gestured tower now saves and
  views exactly as a twin billed without one.
- [x] [Review][Patch] Prose (Acceptance Auditor, Blind Hunter): "hashed
  views" narrowed to the save and the state view in the story, the backlog
  row, the Rust test name and the field doc; the attach wording matches the
  reopen; the raw test calls `endExtend` without a cast.
- Dismissed (5): the "dropped with the simulation" checks hold by
  construction (kept as smoke tests; the editor test covers the swap); a
  re-host outside `loadCommand` (round 2 traced every production attach
  through it); the shadow not comparing `beginExtend`'s answer (a split
  shows at the next billed step, which the dual run compares); the public
  Rust field (round 1); refused begins in the conformance lock (pinned
  across engines by `chargeBindingRaw` since round 2).

### Round 4 (`/gds-code-review`)

- [x] [Review][Patch] The attach reopened the gesture at the span, so a
  drag in progress at an attach re-billed floors it had paid for, and
  `loadCommand` changed the live tower even when the load then failed
  (Edge Case Hunter with a repro, Blind Hunter) [src/dualrun/mirror.ts,
  commands.ts, shadow.ts, engine-rs/src/wasm.rs, charges.rs]: the open
  gesture now rides with the boundary markers and `fromSave` restores it
  (`restore_extend`, crate-only), so `loadCommand` is pure again and both
  engines hold the live tower's own mark. A Rust test pins the markers;
  the dual-run test regrows paid floors free after the attach and fails
  without the hand-over.
- [x] [Review][Patch] Nothing pinned widening the gesture's mark to a span
  grown outside it (Blind Hunter): tests in both engines grow the shaft
  with the free `resizeTransport` mid-gesture and bill only the floor past
  it.
- [x] [Review][Patch] The scenario's `endExtend` ops were unobservable
  (Blind Hunter): a billed shrink-and-regrow follows the first, and the
  lock is regenerated (one events hash).
- [x] [Review][Patch] The Rust save check ran only before billing (Acceptance
  Auditor, Blind Hunter): it now compares a gestured tower with a twin.
- [x] [Review][Patch] Prose (Acceptance Auditor, Blind Hunter): the version
  reasoning names the press change; the WeakMap doc says the state view;
  the `extend-drag-lifecycle` row scopes "never an overcharge" to the
  lost pointer-up.
- Dismissed (6): dropping a gesture when its shaft goes (an extend on a
  gone shaft is refused, and ids are not reused); the editor and shadow
  ignoring `beginExtend`'s answer (a split shows at the next billed step);
  the two runners' wording of a refused begin (no harness compares it);
  `charges` functions imported by the mirror (the shadow command boundary
  is the relay's own); the `Simulation.ts` header merge (needed to stay
  under the file cap); the public Rust field (round 1).

### Round 5 (`/gds-code-review`)

- [x] [Review][Patch] The lock could not see a drag's billing: a `setMoney`
  overwrote the balance before every checkpoint after each drag, and the
  capacity events carry no amount, so the round-4 claim that the lock pinned
  `endExtend` was wrong, as were the earlier dismissals resting on "the
  unchanged lock shows it" (Acceptance Auditor with a deletion probe, Blind
  Hunter) [conformance/scenarios/engine-charges-classic.json]: checkpoints
  `dragged` and `dragged down` precede the `setMoney`s, the second drag also
  shrinks and regrows after its `endExtend`, and dropping any one begin or
  end op now moves a hash (probe rerun; a mutant no-op `endExtend` fails the
  lock).
- [x] [Review][Patch] Rust `apply_markers` read a null `extendGesture` as
  "leave any open gesture" while TypeScript sends null for none (Blind
  Hunter, Acceptance Auditor) [engine-rs/src/wasm.rs]: absent or null now
  closes it; the test checks both.
- [x] [Review][Patch] No dual-run test refused a begin with a gesture open
  (Blind Hunter) [dualRunEdits]: one now does, and the billed regrow after
  it stays in step.
- [x] [Review][Patch] The #1014 fix shape (close the gesture on a press with
  no pointer down) contradicted the pinned free press without saying so,
  and the story called the lost pointer-up rare (Blind Hunter, Edge Case
  Hunter: a mouse released over the inspector panel never reaches the
  canvas) [backlog, story]: the row says the pinned test changes with that
  fix and names the trigger; the story drops "rare".
- Dismissed (4): a gone shaft's gesture handed over by TypeScript and
  dropped by Rust (inert: an extend on a gone shaft is refused before the
  mark is read, a begin clears it, and ids are not reused); making
  `extendGesture` required (the only producer, `loadCommand`, always sets
  it, and absent now means none in Rust as well); a `fromSave` caller
  supplying a mark (a caller of `fromSave` supplies the whole save,
  `restore_extend` is not a binding command); the version bump (story).

### Round 6 (`/gds-code-review`)

No code findings: the Edge Case Hunter fed 400 random 40-op sequences
(begins on any shaft, refused and budget-clamped steps, money at exactly the
cost, free resizes) to both engines with byte-identical results, and attached
a shadow mid-gesture at a random step in each with no divergence; the
Acceptance Auditor confirmed every round-5 claim (the lock diff, the deletion
probe in both runners, the mutants) and all five criteria.

- [x] [Review][Patch] Stale prose (Acceptance Auditor, Blind Hunter)
  [engine-rs/src/charges.rs, src/engine/sim/charges.test.ts]: the Rust
  `INVALID_REQUEST` doc no longer names a mark or `parse_mark`, a TypeScript
  test title no longer names a mark, and the `restore_extend` doc says which
  shafts it keeps.
- Dismissed (5): the glue check's `endExtend` entry passing trivially (it
  takes no arguments; kept for completeness); "never saved or hashed" in
  What landed (true of the Rust field); the done row's "—" GH cell (house
  style); the `extendGesture` fields' bound (both bounds accept the same
  integers); scripting more gesture cases in the scenario (the unit tests in
  both engines and the fuzz cover them).
