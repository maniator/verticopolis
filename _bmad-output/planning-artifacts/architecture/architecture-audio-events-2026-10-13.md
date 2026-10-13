# Audio and engine events: ownership, mapping and plan (2026-10-13)

Status: **proposed**, from a source-level audit of `main` at `316595a` and a
planning review on 2026-10-13. Nothing here is implemented. Each stage below is
its own PR with its own backlog row and issue.

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
   state the engine publishes (a car's door is open, a room is on fire); it
   never **infers** an engine decision from indirect signals (guessing an
   arrival from a car's position and direction).
5. No audio playback code or dependency enters `engine-rs/` or `src/engine/`.
6. Audio reuses the gameplay event catalog (`conformance/events/catalog.json`)
   rather than a parallel audio event system.
7. Determinism and saves are untouched: audio only reads, nothing it does
   enters the save, the hashed views or the RNG streams.

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
  `dispose()` is never called by the app; a load or new game makes no audio
  call (it resets `lastStar` and `shownWin`).
- **Tests:** seven suites in `src/audio/` (a mocked Tone graph, pure data and
  math, the facade's lazy-load contract), plus preference, controller and
  splash-mute tests elsewhere. No e2e test plays audio.

### How web cues are triggered today

| Channel | Cues | Source |
| --- | --- | --- |
| Command results at the call site | `build`, `sell`, `error`, `click` | `src/game/buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts` |
| UI | `click`, `notify` (onboarding step), mute, program change | `src/ui/Onboarding.ts`, `src/game/audioPrefs.ts` |
| **Polled simulation state** | `promote` on `sim.star > lastStar`; `promote` on `sim.evaluatedTower`; `error` on `sim.pendingChoice` | `src/game/frameLoop.ts` |
| Read-model state, about 6 Hz | ambience scene, crowd level, rain, venue programs | `ViewFocus` from `towerInputCamera.ts` (camera plus `sim.weather`, `sim.clock`, unit `occupants` and `customersIn`) |

The polled `promote` repeats a fact the engine already emits as
`star_reached`, which the analytics bridge drains in the same frame.

### Engine outputs audio can use (`engine-rs/`)

- **Gameplay events** (`engine-rs/src/gameplay.rs`, the catalog's 11 events):
  `tower_founded`, `facility_placed`, `facility_removed`, `pricing_changed`,
  `capacity_changed`, `star_reached`, `fire_started`, `fire_gutted`,
  `bomb_detonated`, `emergency_resolved`, `milestone_reached`. A bounded ring
  (1,024, oldest dropped and counted), drained destructively, in emission
  order, with no per-event time stamp. Never saved; the drained batch is part
  of the conformance `events` hash. A load never emits.
- **Cosmetic sequences** (`FxState`, frame header slots 7 to 17): Santa,
  explosion, thief, treasure and VIP. Latest value only, not saved, not
  hashed.
- **Read model** (`frameView`): clock minutes, weather (clear, cloudy, rain),
  star, the pending-choice flag, people, unit states and occupancy, and car
  position, direction and load.
- **Gaps:** no car arrival or door state (the dwell counter is private in
  `dispatch.rs`), no construction-finished, move-in or move-out event, no
  income event. The log ring covers many of these as player text, which audio
  must not parse.

### The drain is single-consumer today

`src/analyticsEngineBridge.ts` is the only caller of
`Simulation.drainGameplayEvents()` (from `src/game/frameLoop.ts` and on page
hide). The drain empties the buffer, so a second consumer would steal the
batch. The bridge also drains and discards in two cases that must not silence
audio: the title backdrop (`discardOnHandOff`, which audio should also skip)
and a closing analytics consent window (which audio should not skip). A tower
swap carries the replaced tower's undrained events ahead of the new tower's,
which analytics needs and audio must drop.

## Recommended architecture

### One drain per host, fanned out

A host-level **gameplay event hub** owns the drain. Once per frame (and on
page hide) it drains the live tower once and hands the same read-only batch to
every registered consumer:

```text
engine (Rust under WASM, TypeScript otherwise)
  -> Simulation.drainGameplayEvents()      once per frame, host only
  -> GameplayEventHub.publish(batch)
       batch = { events, dropped, swapIndex, backdrop }
       -> analytics bridge   (all events; its own consent discard)
       -> audio router       (events from swapIndex on; none for a backdrop)
```

- `swapIndex` marks where the replaced tower's carried events end, so audio
  skips them and analytics keeps them.
- A consumer that throws is counted and isolated; the others still run.
- The hub reads nothing else from the simulation and writes nothing to it.
- This matches the cutover plan's single-drain rule (AD-6 in the open
  cutover plan) and survives a later move of the engine into a worker: the
  worker posts each batch with its snapshot, and the hub's API is unchanged.

### Three channels, one owner each

| Channel | Owner | Used for |
| --- | --- | --- |
| Gameplay events (catalog) | Engine | Things the tower does on its own: a star, a milestone, a fire, a bomb, an emergency that times out |
| Read-model state | Engine publishes, frontend observes | Continuous sound (ambience, crowd, rain, time of day) and per-entity edges a catalog event would flood (a car's door opening, a fx sequence stepping) |
| Command results | Engine answers (after #954), frontend plays | Feedback to the player's own action: `build`, `sell`, `error` on a refusal, `click` |

The audio router never plays `build` or `sell` from `facility_placed` or
`facility_removed`: those cues come from the command result so they land on
the player's input frame and cover refusals, which have no event. A test pins
that no action plays its cue twice.

### Event-to-sound mapping (web, proposed)

| Source | Trigger | Cue | Stage |
| --- | --- | --- | --- |
| `star_reached` | `star` 2 to 5 | `promote` (one per batch, highest star) | Retires the `sim.star` poll |
| `star_reached` | `star` 6 (TOWER) | the win `promote` | Retires the `evaluatedTower` poll, if the two are shown to coincide; otherwise the win cue stays on the win dialog |
| `milestone_reached` | any id | `notify` | New cue |
| `fire_started` | none | new alarm cue (falls back to `error`) | New cue |
| `fire_gutted` | `rooms` | new low impact, or none | New cue, design call |
| `bomb_detonated` | `rooms` | new explosion cue | New cue |
| `emergency_resolved` | `source: timeout` | `notify` | New cue |
| `facility_placed`, `facility_removed`, `pricing_changed`, `capacity_changed` | any | none (the command result plays it) | Rule |
| `tower_founded` | any | none (the program change is UI) | Rule |
| Pending-choice flag | rising edge, with the modal | `error` | Unchanged (state, tied to the modal) |
| Car door-open flag | rising edge, cars in view only, rate capped | new elevator chime | Needs the read-model field |
| Fx sequences | sequence increases | optional Santa, thief, treasure, VIP cues | New cues, design call |
| Weather, clock, occupancy | continuous | rain bed, crowd gates, crowd level | Unchanged |
| Command result | ok, refused, removed | `build`, `error`, `sell`, `click` | Unchanged |

### Ordering, deduplication and time

- **Order:** a batch is folded in emission order.
- **Collapse:** events carry no time stamp, and at top speed one frame's
  batch can span hours of game time. The router plays each cue at most once
  per batch, keeps the highest-priority cue when several compete (alarm, then
  explosion, then promote, then notify), and applies a real-time cooldown per
  cue.
- **Pause:** the engine emits nothing while paused; ambience behavior is
  unchanged.
- **Save, load, new game, undo:** a load never emits, so no phantom promote;
  the router drops events before `swapIndex`; read-model edge detectors
  re-baseline on a swap and never fire on their first frame.
- **Overflow:** a batch with `dropped > 0` plays what it holds; nothing is
  replayed.
- **Determinism:** audio randomness stays on the audio layer's own hash; the
  engine RNG is never read or advanced by audio.

### What stays where

- `engine-rs/` and `src/engine/`: events and read-model fields only. No
  playback, no audio crate, no audio-specific event family.
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
| Elevator arrivals as catalog events? | **No.** A busy tower stops cars hundreds of times a game hour, which floods the 1,024 ring at top speed. A per-car door flag in the read model is enough, and only cars in view play. | None planned. |
| Promote the fx sequences to catalog events? | **Not now.** A sequence that jumps by two still tells audio the moment happened; only the earlier position is lost, which is not audible. Dissent recorded: promoting them first would avoid a later lock change. | A playtest shows a missed or wrong cue traced to the latest-value counters. |
| Baking the web's ambient score? | **Unchanged: rejected for the web** (backlog row `audio-first-cue-latency`, #554). An offline render tool for review and A/B listening is a separate tooling item. | As in #554. |

## Staged plan (each a small PR)

| # | Story | Change | Audible? | Review |
| --- | --- | --- | --- | --- |
| 1 | `gameplay-event-hub` | Move the drain from the analytics bridge into a host hub with `swapIndex` and backdrop flags; the bridge becomes a consumer | No | `/gds-code-review` and `/bmad-code-review` |
| 2 | `web-audio-engine-events` | Audio router on the hub; retire the `sim.star` and `evaluatedTower` polls; per-batch collapse and cooldowns | No | `/gds-code-review` |
| 3 | `audio-scene-data` | Export the ambience scene tables as generated data pinned by a test; drop the dead `SCENES` fields | No | `/bmad-code-review` |
| 4 | `audio-offline-render` | A tool that renders the programs, beds and cues offline (Tone.js `Offline`) to files for review and A/B listening | No (tooling) | `/bmad-code-review` |
| 5 | `engine-car-door-state` | Per-car door-open flag in the frame read model and on the TypeScript engine; the web elevator chime for cars in view | Yes (minor) | `/gds-code-review` |
| 6 | `web-audio-event-cues` | New cues for fire, bomb, milestone, emergency timeout and optionally the fx sequences, auditioned with stage 4's renders | Yes (minor) | `/gds-code-review` |
| 7 | `audio-docs-drift` | Docs true-up (below) | No | none needed |

A master volume slider joins the existing audio panel row (`audio-button-panel`,
#483).

Dependencies: 2 needs 1. 5 and 6 need 2. 6 benefits from 4. 1 should land
before or with the cutover's engine-answers work (#954) and is compatible
with the typed drain cleanup (`gameplay-events-glue`, #907).

## Test strategy

- **Event parity:** the router's map is exhaustive over the catalog (a
  TypeScript `never` check), so a new catalog event fails the build until it
  is mapped to a cue or to none. Fixture batches go in and a cue list comes
  out. A conformance scenario runs on both engines and the router's cue lists
  must match.
- **No double play:** a build command and its `facility_placed` in one frame
  play one `build`.
- **Swap and backdrop:** a load, a new game and an undo play nothing from the
  replaced tower; the title backdrop plays nothing; loading a tower above one
  star plays no promote.
- **Consent:** closing the analytics consent window still delivers the batch
  to audio.
- **Fast-forward:** a batch with three `star_reached` plays one `promote`;
  cooldowns hold across consecutive batches.
- **Pause and resume:** no cue while paused; today's ambience behavior is
  pinned by a test before anything changes.
- **Volume controls:** the existing preference and graph suites stay green;
  the master slider gets the same clamp and curve tests when it lands.
- **Determinism:** the conformance lock and the state, crowd and events
  hashes are unchanged with the hub and router attached; the hub never writes
  to the simulation.
- **Performance:** the hub and router cost per frame is measured on the perf
  fixture and stays within the frame loop's existing budget.

## Docs drift found by the audit (stage 7)

- `_bmad-output/project-context.md` says all audio is generated in code; the
  game ships two owner-recorded voice seeds (`ASSETS-LICENSE.md` records
  them).
- `README.md` still describes music that crossfades between scenes; music now
  follows the program, and only ambience follows the scene.
- `CONTRIBUTING.md` lists `src/audio/` as three files and omits the crowd,
  track, percussion and rain modules.
- Two code comments say an item is tracked in the backlog without a row:
  the venue census reading empty for a few seconds after a load
  (`src/render/excalibur/towerInputCamera.ts`) and the splash theme skipped on
  an instant Continue (`src/game/appBoot.ts`).

## Licensing

All web audio is the project's own: code-generated synthesis of the owner's
compositions, and two owner-recorded voice seeds with all rights held by the
owner (`ASSETS-LICENSE.md`, CC BY 4.0). Nothing from the 1994 original and no
third-party sample ships, and none of the stages above changes that. Any
rendered file from stage 4 is a derived work of the project's own audio and
carries the same attribution.
