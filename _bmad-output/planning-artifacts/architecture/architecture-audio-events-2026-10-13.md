# Audio and engine events: ownership, mapping and plan (2026-10-13)

Status: **proposed**, from a source-level audit of `main` at `316595a` and a
planning review on 2026-10-13, revised after a `/bmad-code-review` of the plan
(three layers and three confirming passes) and the owner's decisions of the
same day. Nothing here is implemented. Each stage below is its own PR
with its own backlog row and issue.

## Why

The web game's audio decides some of its cues by reading simulation state
directly, while the engine already emits the same facts as gameplay events.
Any host that runs the engine (the web game, and any other frontend built on
the published crate) should take gameplay-derived cues from one shared event
contract, keep its own playback, and never repeat a gameplay decision in an
audio adapter.

## Principles (adopted)

1. The engine owns gameplay outcomes, game time and gameplay-derived events.
2. A frontend owns playback, sound assets, synthesis, mixing, listener
   position and the player's audio preferences.
3. UI-only cues (a click, a refused placement, a slider tick) stay in the
   frontend.
4. No audio adapter repeats a gameplay decision. A frontend may **observe**
   state the engine publishes (a car's stop count, a room on fire); it never
   **infers** an engine decision from indirect signals (guessing an arrival
   from a car's position and direction).
5. Audio stays frontend-owned. The engine exposes gameplay events and state;
   it never plays, schedules or mixes sound, and no audio playback code or
   dependency enters `engine-rs/` or `src/engine/` (owner, 2026-10-13).
6. Audio reuses the gameplay event catalog (`conformance/events/catalog.json`);
   there is no separate audio event system.
7. Determinism and saves are untouched: audio only reads, and nothing it does
   enters the save, the hashed views or the RNG streams.
8. One fact, one cue: when an event and a state change describe the same
   moment, exactly one of them carries the sound.
9. Every sound is original to Verticopolis, UI effects included. No
   third-party sound pack ships, free or paid (owner, 2026-10-13).

## Inventory (facts from the audit)

### Web audio today (`src/audio/`, about 4,500 lines, Tone.js 15.1.22)

- **Facade:** `AudioEngine` (`src/audio/Audio.ts`): `start`, `setMuted`,
  `setProgram("splash" | "game")`, `setVolumes(music, ambience, sfx)`,
  `update(focus)`, `sfx(name)`, `dispose`. The Tone chunk (about 230 kB) loads
  on the first gesture.
- **Graph** (`ToneAudioEngine.ts`): master gain 0.35 (mute ramps it to 0),
  then four buses: `sfxBus` (dry), `musicBus` and `ambBus` (through a shared
  reverb), `ambDryBus` (rain). Bus gains are the square of the slider value.
- **Music:** two composed programs in `toneTracks.ts`: the splash "Terrace +
  Heartbeat" (96 BPM, 25 s loop) and the in-game "Two Chapters" (76 BPM,
  about 101 s loop). Program changes crossfade over 0.8 s. Music does not
  follow the camera.
- **Ambience:** 12 room-tone scenes chosen by `sceneFor(focus)` with an
  overview hysteresis latch; a crowd layer (`toneCrowd*.ts`) with 11 scene
  keys, six talker slots on two owner-recorded voice seeds
  (`src/public/audio/voice-*.mp3`, 82 KB), element one-shots, a street hum,
  and venue programs for the party hall, cinema and metro; a rain bed.
- **Cues:** `SfxName` is `build | sell | error | promote | money | notify |
  click`. `money` is defined and never played.
- **Preferences:** `vc.prefs` in `localStorage` (`src/storage/Prefs.ts`):
  `muted`, `musicVolume`, `ambienceVolume`, `sfxVolume`. Controls: the top bar
  mute, the splash mute, and three sliders in Settings. There is no master
  volume slider.
- **Runtime cases:** a pause keeps music and ambience playing; a blocking
  modal freezes ambience updates; there is no `visibilitychange` handling;
  `dispose()` is never called by the app, and the crowd's `humSwell` gain is
  never disposed; a load or new game makes no audio call (it resets
  `lastStar` and `shownWin`).
- **Tests:** seven suites in `src/audio/` (a mocked Tone graph, pure data and
  math, the facade's lazy-load contract), plus preference, controller and
  splash-mute tests elsewhere. No e2e test plays audio.

### How web cues are triggered today

| Channel | Cues | Source |
| --- | --- | --- |
| Command results at the call site | `build`, `sell`, `error`, `click` | `src/game/buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts` |
| UI | `click`, `notify` (onboarding step), mute, program change | `src/ui/Onboarding.ts`, `src/game/audioPrefs.ts` |
| **Polled simulation state** | `promote` on `sim.star > lastStar`; `promote` on `sim.evaluatedTower` (with the win dialog); `error` on `sim.pendingChoice` (with the choice modal) | `src/game/frameLoop.ts` |
| Read-model state, about 6 Hz | ambience scene, crowd level, rain, venue programs | `ViewFocus` from `towerInputCamera.ts` (camera plus `sim.weather`, `sim.clock`, unit `occupants` and `customersIn`) |

The `sim.star` poll repeats a fact the engine already emits as
`star_reached`, which the analytics bridge drains in the same frame.

### Engine outputs audio can use (`engine-rs/`)

- **Gameplay events** (`engine-rs/src/gameplay.rs`, the catalog's 11 events):
  `tower_founded`, `facility_placed`, `facility_removed`, `pricing_changed`,
  `capacity_changed`, `star_reached`, `fire_started`, `fire_gutted`,
  `bomb_detonated`, `emergency_resolved`, `milestone_reached`. A bounded ring
  (1,024, oldest dropped and counted cumulatively), drained destructively, in
  emission order, with no per-event time stamp. Never saved; the drained
  batch is part of the conformance `events` hash. A load never emits.
  Commands emit too, so events can arrive while the game is paused (a build,
  a price change, the consequences of answering an emergency).
- **Cosmetic sequences** (`FxState`, frame header slots 7 to 17): slot 7
  Santa sequence; 8 to 10 explosion (sequence, floor, x); 11 to 13 thief
  (sequence, caught, floor); 14 to 16 treasure (sequence, floor, x); 17 VIP
  sequence. Latest value only, not saved, not hashed.
- **Read model** (`frameView`): clock minutes, weather (clear, cloudy, rain),
  star, the pending-choice flag, people, unit states and occupancy, and car
  position, direction and load.
- **Gaps:** no car stop or door state (the dwell counter is private in
  `dispatch.rs`), no construction-finished, move-in or move-out event, no
  income event. The log ring covers many of these as player text, which audio
  must not parse.
- **Couplings worth knowing:** `start_fire` sets the pending fire-rescue
  choice in the same step it emits `fire_started`; the winning VIP visit bumps
  the VIP sequence and emits `star_reached` 6 in the same step.

### The drain is single-consumer today

`src/analyticsEngineBridge.ts` is the only caller of
`Simulation.drainGameplayEvents()` (from `src/game/frameLoop.ts` every frame,
and through `bindEngineBridge` on page hide and on a consent change). The
drain empties the buffer, so a second consumer would steal the batch. The
bridge also handles a drain that throws or returns no array, and discards in
two cases: the title backdrop (`discardOnHandOff`) and a closing analytics
consent window. A tower swap carries the replaced tower's undrained events
ahead of the new tower's (`GameplayEventBuffer.inherit`, and under the WASM
host the `carried` events at attach and the owed events at detach), with no
marker of where one tower ends.

## Recommended architecture

### One drain per host, fanned out

A host-level **gameplay event hub** owns the drain. It drains the live tower
once per frame, on page hide and on a consent close, and hands the same
read-only batch to every registered consumer:

```text
engine (Rust under WASM, TypeScript otherwise)
  -> drainGameplayEvents()                 host only, once per occasion
  -> GameplayEventHub.publish(batch)
       batch = { events, ownFrom, dropped, reason, backdrop }
       -> analytics bridge  (all events; discards a backdrop batch and a
                             consentClose batch, as today)
       -> audio router      (events from ownFrom on; nothing for a backdrop
                             or a hide batch)
```

- **`ownFrom`** is the index where the live tower's own events start. The
  event buffer keeps it: `inherit` sets it to the inherited count, the WASM
  host carries it through attach and detach, eviction on overflow lowers it
  (never below 0), and any number of swaps between two drains leaves every
  earlier tower's events before it.
- **`dropped`** is the per-batch delta of the live tower's cumulative drop
  counter. The baseline is kept across a swap, because `inherit` and the WASM
  host's detach already carry the replaced tower's count forward; if the
  counter ever reads lower than the baseline (a tower that inherited
  nothing), the hub rebases to it and reports 0.
- **Swaps** need no signal beyond the buffer: `ownFrom` and the drop counter
  travel with the events.
- **`reason`** is `frame`, `hide` or `consentClose`, so the bridge keeps its
  consent discard and audio ignores a batch drained as the tab hides. The
  hub takes the hide and consent drains through the analytics session's
  existing flush hook (as `bindEngineBridge` does today) and adds no
  listeners of its own; a build without those listeners publishes frame
  batches only.
- **Drain failures** stay guarded: a drain that throws or returns no array is
  counted and publishes nothing that occasion.
- A consumer that throws is counted and isolated; the others still run.
- The hub reads only the drain and the drop counter, and writes nothing to
  the simulation.
- **Timing:** the frame loop drains before it ticks (`frameLoop.ts`), so a
  frame's batch holds the previous frame's tick events, while read-model
  edges show the current frame. The plan keeps that order (analytics relies
  on it around the modal freeze) and never pairs an event with a same-frame
  state edge.
- This matches the cutover plan's single-drain rule (AD-6 in
  `_bmad-output/planning-artifacts/architecture/architecture-rust-wasm-cutover-2026-10-13/ARCHITECTURE-SPINE.md`,
  merged in #947). If the
  engine later moves into a worker, the worker drains and posts each batch
  with `ownFrom` and its snapshot; the hub's API is unchanged.

### Three channels, one owner each

| Channel | Owner | Used for |
| --- | --- | --- |
| Gameplay events (catalog) | Engine | Things the tower does on its own: a star, a milestone, a bomb, an emergency that times out |
| Read-model state | Engine publishes, frontend observes | Continuous sound (ambience, crowd, rain, time of day), modal-bound cues (the pending choice, the win), and per-entity edges a catalog event would flood (a car's stop count, a fx sequence stepping) |
| Command results | Engine answers (after #954), frontend plays | Feedback to the player's own action: `build`, `sell`, `error` on a refusal, `click` |

The audio router never plays `build` or `sell` from `facility_placed` or
`facility_removed`: those cues come from the command result so they land on
the player's input frame and cover refusals, which have no event. A test pins
that no action plays its cue twice.

### Event-to-sound mapping (web, proposed)

| Source | Trigger | Cue | Stage |
| --- | --- | --- | --- |
| `star_reached` | `star` 2 to 5 | `promote` (the highest star in the frame) | 2: retires the `sim.star` poll |
| Win dialog (`evaluatedTower`) | the dialog opens | `win` (today's `promote` sound, its own cue id) | Unchanged: stays on the dialog, so a load or undo of a won tower replays it as today; `star_reached` 6 plays nothing |
| Pending-choice modal | the modal opens | `error` today; the alarm (fire rescue) or a threat cue (bomb) in stage 6 | Unchanged in stage 2; one cue per emergency |
| `fire_started` | any | none (the modal that opens in the same step carries the alarm) | Rule: one fact, one cue |
| `emergency_resolved` | `source: timeout` | `notify` | 6 |
| `emergency_resolved` | `source: player` | none (the modal click is UI) | Rule |
| `bomb_detonated` | `rooms` 1 or more | new explosion cue | 6 |
| `bomb_detonated` | `rooms` 0 (nothing to burn, no explosion drawn) | none | Rule: the visual twin |
| Explosion fx sequence | any | none (`bomb_detonated` carries it) | Rule: one fact, one cue |
| `fire_gutted` | `rooms` | new low impact | 6, auditioned |
| `milestone_reached` | any id | `notify` | 6 |
| `facility_placed`, `facility_removed`, `pricing_changed`, `capacity_changed` | any | none (the command result plays it) | Rule |
| `tower_founded` | any | none (the program change is UI) | Rule |
| Car stop counter | counter increases, cars in view only | new elevator chime, one per car per frame, rate capped | 5 |
| Fx sequences | sequence increases | Santa, thief, treasure and VIP cues; the VIP cue is skipped when `evaluatedTower` turns true in the same frame (the winning visit, seen in the simulation state the win dialog already reads) | 6, auditioned |
| Weather, clock, occupancy | continuous | rain bed, crowd gates, crowd level | Unchanged |
| Command result | ok, refused, removed | `build`, `error`, `sell`, `click` | Unchanged |

The router's map is exhaustive over event names and, for
`emergency_resolved`, over `source`, so a new catalog event or payload value
fails the build until it is mapped to a cue or to none.

### Ordering, arbitration and time

- **Order:** a batch is read in emission order.
- **Arbitration per frame:** events and read-model edges are arbitrated
  together once per frame. Each distinct cue plays at most once per frame; if
  more than two distinct cues compete, the two highest play, in this order:
  `win`, alarm or threat, explosion, `promote`, chime, `notify`, fx cues. A
  `win` and a `promote` in the same frame play `win` only. Each cue
  also has a real-time cooldown. Events carry no time stamp and one frame can
  span hours of game time at top speed, so nothing is spread out or replayed.
- **Pause:** ticks emit nothing while paused; commands still emit. A cue from
  the player's own action (a build, or the explosion after declining a bomb
  ransom) plays while paused. The first paused frame still drains the last
  running frame's tick events, so a one-frame tail can play.
- **Save, load, new game, undo, redo:** a load never emits, so no phantom
  promote; the router drops events before `ownFrom`; read-model edge
  detectors re-baseline on a swap and never fire on their first frame.
- **Overflow:** a batch with `dropped > 0` plays what it holds; nothing is
  replayed.
- **Determinism:** audio randomness stays on the audio layer's own hash; the
  engine RNG is never read or advanced by audio. The router takes an injected
  clock so tests are deterministic.

### What stays where

- `engine-rs/` and `src/engine/`: events and read-model fields only. No
  playback and no audio crate.
- `src/audio/`: playback, synthesis, mixing, cue choice, cooldowns.
- Host glue (`src/game/`): the hub, the router's registration, the
  command-result cues.
- The ambience scene tables (`sceneFor`, `resolveCrowdScene`,
  `hourActivity`, the crowd specs) are presentation data. Exporting them as
  generated, engine-neutral data lets any frontend reproduce the soundscape
  without re-coding the rules; the dead per-scene music fields in `SCENES`
  leave in the same change.

## Decisions recorded

| Question | Decision | Trigger to revisit |
| --- | --- | --- |
| A separate audio event stream? | **No.** The gameplay catalog plus the read model cover every cue. | A cue that needs a gameplay fact neither carries. |
| Elevator stops as catalog events? | **No.** A busy tower stops cars hundreds of times a game hour, which would flood the 1,024 ring at top speed. A per-car stop counter in the read model survives any frame rate, and only cars in view chime. | A playtest shows chimes that do not match visible stops. |
| Third-party sound packs? | **None, UI effects included** (owner, 2026-10-13). Every sound is the project's own: code-generated, rendered from the project's code, or recorded by the owner. | None planned. |
| Performance budgets | **Provisional until measured on real hardware** (owner, 2026-10-13). The numbers below are starting targets for the stages' own micro-benchmarks, never CI thresholds without the owner's approval. | The first measurement on real hardware. |
| Promote the fx sequences to catalog events? | **Not now.** A sequence that jumps by two still tells audio the moment happened; only the earlier position is lost, which is not audible. Dissent recorded: promoting them first would avoid a later lock change. | A playtest shows a missed or wrong cue traced to the latest-value counters. |
| Where does the win cue live? | **On the win dialog**, as today, so a load or undo of a won tower replays it. | The win dialog's own replay rule changes. |
| Baking the web's ambient score? | **Unchanged: rejected for the web** (backlog row `audio-first-cue-latency`, #554). An offline render tool for review and A/B listening is a separate tooling item. | As in #554. |

## Staged plan (each a small PR)

| # | Story | Change | Audible? | Review |
| --- | --- | --- | --- | --- |
| 1 | `gameplay-event-hub` (#964) | The hub owns the drain (frame loop, plus the analytics session's flush hook for hide and consent); `ownFrom` in the event buffer through inherit, attach, detach and eviction; `reason`, per-batch `dropped`, guarded drain; the bridge becomes a consumer | No | `/gds-code-review` and `/bmad-code-review` |
| 2 | `web-audio-engine-events` (#965) | Audio router on the hub; retire the `sim.star` poll; per-frame arbitration and cooldowns; the win and pending-choice cues stay on their dialogs | No | `/gds-code-review` |
| 3 | `audio-scene-data` (#968) | Export the ambience scene tables as generated data pinned by a test; drop the dead `SCENES` fields | No | `/bmad-code-review` |
| 4 | `audio-offline-render` (#969) | A tool that renders the programs, beds and cues offline (Tone.js `Offline`) to files for review and A/B listening | No (tooling) | `/bmad-code-review` |
| 5 | `engine-car-door-state` (#966) | A per-car stop counter in the frame read model and on the TypeScript engine, with every frame decoder updated in the same PR; the web elevator chime for cars in view (the chime needs stage 2) | Yes (minor) | `/gds-code-review` |
| 6 | `web-audio-event-cues` (#967) | New cues: alarm and threat on the modal, explosion, low impact, milestone, timeout, fx cues, auditioned with stage 4's renders | Yes (minor) | `/gds-code-review` |
| 7 | `audio-docs-drift` (#970) | Docs true-up and two comment fixes (below) | No | `/bmad-code-review` |
| 8 | `web-audio-lifecycle-a11y` (#973) | Mute when the tab is hidden (on by default, kept apart from the player's mute), teardown and the `humSwell` leak, a mono toggle, and a test that every informative cue has a visual twin | Yes (minor) | `/bmad-code-review` |

The master volume slider joins the audio panel row (`audio-button-panel`,
#483).

Dependencies and order around open work:

- **1 lands after #950 and #907.** #950 (capacity events from the
  simulation layer) changes `Simulation.ts`, `wasmHost.ts` and the catalog;
  #907 (one typed drain, one buffer restore with its drop count, a flatter
  detach) is the code `ownFrom` has to travel through. Stage 1 builds on
  #907's helpers instead of writing its own, and lands before or with #954
  (the engine answers commands).
- 2 needs 1. The engine field in 5 needs nothing; its chime needs 2. 6 needs
  2 and benefits from 4. 3, 4, 7 and 8 need nothing and can go any time.
- **7 coordinates with #823** (the open sounds contributor doc): if #823
  merges first, stage 7 trues it up with the rest.
- **Benchmarking (#972) does not wait for audio.** It starts from `main`. No
  audio stage edits `e2e/perf.spec.ts`, `e2e/perf/baseline.json` or the
  `perf:compare` harness, or adds a CI threshold. Stage 1 adds the same host
  work on both engines; because `perf:compare` records the commit it ran on,
  a run before and after stage 1 shows that cost without either effort
  waiting on the other.

## Test strategy

- **Event parity:** the router's map is exhaustive (a TypeScript `never`
  check over names and `emergency_resolved.source`). Fixture batches go in
  and a cue list comes out. A conformance scenario runs on both engines with
  one batch per step and an injected clock, and the router's cue lists must
  match.
- **One fact, one cue:** a build command and its `facility_placed` play one
  `build`; a fire plays one alarm (the modal), with `fire_started` silent; the
  winning VIP visit plays `win` and no VIP cue; a bomb with nothing to burn
  plays no explosion.
- **Swap and backdrop:** a load, a new game, an undo and a redo play nothing
  from the replaced tower; two swaps between drains and an overflow after a
  swap keep `ownFrom` right, on both engines; an overflow, a drain, a swap
  and a drain report 0 dropped; the title backdrop plays
  nothing; loading a tower above one star plays no star `promote`, and
  loading a won tower replays the win cue as today.
- **Reasons:** a consent close still delivers the batch to audio and the
  bridge still discards it; a hide batch reaches analytics only.
- **Fast-forward:** a batch with three `star_reached` plays one `promote`;
  cooldowns hold across consecutive frames; the chime cap holds at top speed.
- **Pause and resume:** no tick-sourced cue after the first paused frame; a
  build while
  paused plays `build`; today's ambience behavior is pinned by a test before
  anything changes.
- **Volume controls:** the existing preference and graph suites stay green;
  the master slider and the mono toggle get the same clamp, curve and
  persistence tests when they land.
- **Determinism:** the conformance lock and the state, crowd and events
  hashes are unchanged with the hub and router attached; the hub never writes
  to the simulation.
- **Performance (provisional targets):** the hub and router together aim
  for 0.1 ms or less a frame (median, 0.3 ms at the 99th percentile) at top
  speed, measured by a Vitest micro-benchmark over recorded batches from the
  perf towers. It reports and never fails the build; the targets are revised
  once measured on real hardware.

## Docs drift found by the audit (stage 7)

- `_bmad-output/project-context.md` says all audio is generated in code; the
  game ships two owner-recorded voice seeds (`ASSETS-LICENSE.md` records
  them).
- `README.md` still describes music that crossfades between scenes; music now
  follows the program, and only ambience follows the scene.
- `CONTRIBUTING.md` lists `src/audio/` as three files and omits the crowd,
  track, percussion and rain modules.
- Two code comments say an item is tracked in the backlog without a row: the
  venue census reading empty for a few seconds after a load
  (`src/render/excalibur/towerInputCamera.ts`) and the splash theme skipped on
  an instant Continue (`src/game/appBoot.ts`). Either add rows with issues or
  reword the comments.

## Licensing

All web audio is the project's own work: code-generated synthesis of the
owner's compositions, and two voice seeds the owner recorded, all licensed
CC BY 4.0 (`ASSETS-LICENSE.md`). Nothing from the 1994 original and no
third-party sample or sound pack ships, UI effects included, and none of the
stages above changes that. Any
rendered file from stage 4 is a derived work of those assets and carries the
same license and attribution.
