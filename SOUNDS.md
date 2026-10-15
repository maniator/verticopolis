# Sound

How Verticopolis makes noise, what each sound is for, and how to add one.

The design record for the current material is
`_bmad-output/specs/spec-human-audio-theme/` and the crowd-din-ambience GDD
under `_bmad-output/planning-artifacts/gdds/`. When this doc and a SPEC
disagree about note data, the SPEC wins.

Where cues come from, who owns the engine's event drain, and which new sounds
are planned are decided in
`_bmad-output/planning-artifacts/architecture/architecture-audio-events-2026-10-13.md`
("the audio plan" below). It is staged work, tracked in the backlog
(`_bmad-output/implementation-artifacts/backlog.md`) with one GitHub issue per
stage. When this doc and the audio plan disagree about ownership or what gets
built next, the plan wins.

This doc describes `main` as of 2026-10-15. Numbers quoted from the source
(gains, rates, frequencies) are a snapshot; the source files named in each
section are the live values.

When sources disagree, this is the order: the code in `src/audio/` and
`src/game/` is the truth about what plays today; the SPEC is the truth about
the intended note data; the audio plan is the truth about ownership and what
gets built next. This doc only summarizes them.

## The goal

The 1994 original's soundscape was dynamic in a specific way. It was a
building you could hear: sounds arrived at their own rates, layered without
coordinating, and changed with the hour and with where you were looking.

- **Probability.** An elevator arrival sometimes made a sound and sometimes
  stayed quiet. That is most of why it never became tiring; a cue that fires on
  every instance of a frequent event becomes noise within a minute.
- **Stacking.** Typing, registers, whirs, and the crowd ran at once at
  independent rates, and the density of the pile was the information.
- **Time of day.** Birds at sunrise, an owl at night. They tell you the hour
  while you are looking at something else, and give the tower a park-like
  quality a purely mechanical building would lack.

Verticopolis already has this machinery in the crowd layer. When weighing a new
sound, ask whether it thickens that soundscape or merely announces an event.

## The short version

- Sound is **Tone.js**, synthesized live. Excalibur's audio system is not used
  at all: Excalibur draws the tower and nothing more. No `ex.Sound`, no audio
  `Loader`, no per-cue asset files.
- Almost nothing is sampled. The only files that ship are
  `src/public/audio/voice-talk.mp3` and `voice-laughs.mp3`: gibberish talk and
  laughter the owner recorded (provenance and license in `ASSETS-LICENSE.md`),
  which the crowd layer chops into murmur. Everything else is generated at
  runtime.
- The music and action cues are transcriptions of the owner's own recordings
  (hums, chest hits, taps, a bloop, a ping). New cues should speak in that
  voice rather than introduce a fresh instrument.
- Every sound is original to Verticopolis, UI effects included: synthesized in
  code, rendered from the project's code, or recorded by the owner. No
  third-party sample or sound pack ships, free or paid (audio plan, principle 9).
- The engine (`engine-rs/`, and `src/engine/` while both run) owns gameplay
  outcomes and emits gameplay events. It never plays, schedules, or mixes
  sound. Everything audible lives in `src/audio/`, with the call sites in
  `src/game/`.

## Module map

| File | Job |
| ---- | --- |
| `src/audio/Audio.ts` | The `AudioEngine` facade built at boot. No `tone` import; holds mute/volume/program synchronously and lazy-loads the real engine on first gesture. |
| `src/audio/ToneAudioEngine.ts` | The live orchestrator: bus graph, every voice, the music `Tone.Part`, the ambient bed driven by camera focus. |
| `src/audio/toneScenes.ts` | Scene vocabulary and pure math (`SCENES`, `sceneFor`, `midiToFreq`), plus the `SfxName` union. No Tone.js import. |
| `src/audio/toneTracks.ts` | Composed music: note data for the two tracks and the builders that time them. No Tone.js import. |
| `src/audio/toneVoices.ts` | Action jingles: the `SfxVoices` instrument set and `playSfx`. |
| `src/audio/tonePercussion.ts` | The chest-hit thump and object-tap membrane voices. |
| `src/audio/toneRain.ts` | The outdoor rain bed, on a dry path. |
| `src/audio/toneCrowd.ts` | The crowd/venue ambience layer: talkers, per-scene details, venue programs. |
| `src/audio/toneCrowdData.ts` | Crowd specs and math, including the `pseudo` hash the layer varies itself with. |
| `src/audio/toneCrowdVoices.ts` | Slices the two seed mp3s into murmur grains. |
| `src/audio/toneCrowdPrograms.ts` | `PartyBand`, `CinemaProgram`, `MetroProgram`. |
| `src/audio/audioAssets.ts` | Every file the audio layer fetches at run time (`AUDIO_RUNTIME_FILES`) and the lazy chunk's name, so the offline precache check can find them. |
| `src/game/audioPrefs.ts` | Player commands: mute, volume, and their persistence (in `src/storage/Prefs.ts`). |

## The bus graph

- **`musicBus`** carries the composed tracks. The **Music** slider.
- **`ambBus`** and **`ambDryBus`** carry the crowd layer, room tone, and rain.
  The **Ambience** slider. Two nodes because rain stays dry while the rest
  shares the reverb.
- **`sfxBus`** carries the action jingles. The **Effects** slider.
- **`master`** is downstream of all of them (directly, or through the shared
  reverb) at gain `0.35`; mute ramps it to zero.

A `bedFilter` lowpass on the ambient path opens as the camera zooms in, so
distance muffles the building's life. Music bypasses it. Percussion feeds the
music bus directly, skipping the music path's warm lowpass and sub highpass so
the tap stays bright and the thump keeps its body; it still sits behind the
Music slider, the shared reverb, and mute.

Three sliders plus mute is the whole player-facing surface. Levels live in
`Prefs`, are clamped in the facade before reaching an `AudioParam`, and are
read back from the facade so prefs never store junk.

## Lifecycle

Browsers refuse to make noise before a gesture, and the Tone.js chunk is
large (about 230 kB minified, per the audio plan's audit), so both are handled
together. `GameApp` (`src/main.ts`) builds the facade at boot with
nothing heavy loaded. The first real gesture calls `start()`, which
feature-detects `AudioContext` (so tests and unsupported environments never
fetch the chunk), then dynamically imports `ToneAudioEngine`. Once the engine
exists the facade replays what it was holding: mute, volumes, program, last
focus.

An installed game has to play every sound offline (#985). The lazy chunk and
both voice seeds are in the service worker's precache, and three checks keep
it that way: `scripts/verify-precache.ts` (part of `npm run build`) fails when
the audio chunk or any file in `AUDIO_RUNTIME_FILES` is missing from the
manifest, `src/audio/audioAssets.test.ts` fails when a sound file ships or the
source names one without listing it, and `e2e/offline.spec.ts` plays today's
sounds from the cache with the network off. `verify-precache.ts` also fails
the build when the whole precache passes its budget
(`PRECACHE_BUDGET_BYTES`, 4 MiB today), so a new sound file has to fit.

While the chunk loads, a second `start()` returns early. A `generation`
counter guards the load window, so a `dispose()` mid-flight cannot resurrect a
torn-down engine.

`setProgram("splash" | "game")` picks the track; the splash theme crossfades to
the in-game bed on entry.

Known runtime behavior, from the audio plan's audit: pausing the game keeps
music and ambience playing; a blocking modal freezes ambience updates; there
is no `visibilitychange` handling, so a hidden tab keeps playing; and the app
never calls `dispose()`, so the crowd's `humSwell` gain is never released. The
last two are `web-audio-lifecycle-a11y` (#973).

## The cue vocabulary

`SfxName` is the complete list of one-shot cues. All play through `sfxBus`.

| Cue | Sound | Fired from |
| --- | ----- | ---------- |
| `build` | One bloop swooping 520 Hz down to 180 Hz | `buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts` |
| `click` | A small, quick high bloop | `editorActions.ts` |
| `sell` | Two falling bloops | `buildActions.ts`, `editorActions.ts` |
| `error` | A slow, sighing double bloop | Most player-initiated refusals in `buildActions.ts`, `editorActions.ts`, and `keyboardPlay.ts` (drag paths and a few edge refusals stay quiet); also `frameLoop.ts` when the emergency choice modal opens |
| `promote` | The splash theme's peak turn on the ping bell | `frameLoop.ts`: a star promotion (2 to 5 stars) and the win dialog |
| `notify` | A single ping on G4 | The onboarding step chime (wired in `appBoot.ts`) |
| `money` | An ascending four-note arpeggio | **Nothing. Defined and uncalled.** |

`money` predates the human-recorded pass; the SPEC deliberately left it alone
until "a later pass." The cash ding below sketches one possible use.

## Where cues come from

Today the `src/game/` call sites decide every cue in one of four ways:

- **The player's own action.** `buildActions.ts`, `editorActions.ts`, and
  `keyboardPlay.ts` play `build`, `sell`, `click`, or `error` from the command
  result, so the cue lands on the input frame and covers refusals.
- **UI only.** The onboarding step chime (`notify`, wired in `appBoot.ts`),
  mute, and the program change. These stay in the frontend for good.
- **Polled simulation state.** `frameLoop.ts` plays `promote` when `sim.star`
  rises, `promote` again when `sim.evaluatedTower` opens the win dialog, and
  `error` when `sim.pendingChoice` opens the emergency modal.
- **The read model, about 6 times a second.** `ViewFocus` (camera plus the
  sim's weather, clock, and occupancy, built in `towerInputCamera.ts`) drives
  the ambience scene, the crowd layer, and rain.

The engine also emits gameplay events (`star_reached`, `fire_started`,
`bomb_detonated`, `milestone_reached`, and the rest of
`conformance/events/catalog.json`), but audio does not read them yet. The
drain, `Simulation.drainGameplayEvents()`, empties the buffer, and the
analytics bridge (`src/analyticsEngineBridge.ts`) is its only caller. **Never
call it from audio code**: a second caller would steal the batch from
analytics.

The audio plan changes this in stages, each its own backlog row and issue.
The first two matter most here:

- **Stage 1**, `gameplay-event-hub` (#964): a host-level hub owns the one
  drain and hands the same read-only batch to every consumer, with a
  throwing consumer isolated from the others.
- **Stage 2**, `web-audio-engine-events` (#965): an audio router on the hub
  plays `promote` from `star_reached` and retires the `sim.star` poll. The
  win and emergency cues stay on their dialogs. No audible change.

Until those land, new gameplay-driven cues have nowhere correct to hook in.
Rules the plan fixes for every cue, now and later:

- **No separate audio event stream.** Audio uses the gameplay catalog and the
  read model; a fact neither carries is an engine ask on both engines, never a
  side channel.
- **Observe, never infer.** Audio may read state the engine publishes (a
  star, a pending choice, occupancy). It never reconstructs an engine decision
  from indirect signals, such as guessing an elevator arrival from a car's
  position, or parsing the log's player text.
- **One fact, one cue.** When an event and a state change describe the same
  moment, only one of them makes the sound (`build` comes from the command
  result, never also from `facility_placed`).
- **Existing sounds first.** New compositions wait until stages 1 and 2 have
  shipped with today's sounds unchanged (the "initial audio gate").

## The ambient layer

The cues are the small part. The soundscape lives in `toneCrowd.ts` with its
data in `toneCrowdData.ts`, and it is closer to the original's behavior than
the cue table suggests: the stacking, rate-driven, occupancy-scaled machinery
is **already built**. What is missing is mostly content and time-of-day gating.

A **scene** resolves from camera focus and the dominant facility kind: `lobby`,
`office`, `condo`, `hotel`, `restaurant`, `fastFood`, `shop`, `cinema`,
`partyHall`, `metro`, `outside`. Overview, quiet, and service areas resolve to
nothing and get music and room tone only. Each scene carries a **murmur spec**,
a list of **elements** (one-shot details on independent timers), a **gate**,
optionally a composed **program**, and optionally a **`crowdFloor`** for the
city's own spaces, which never fall fully silent (indoor rooms have none, so
empty means silent).

Everything is scheduled on timers seeded by the `pseudo` hash, so the layer
varies without `Math.random` and without a fixed loop becoming audible.
`outside` also swells a low street hum (two oscillators under an LFO) while it
is live.

### How firing works

There is no per-event probability roll. Each element runs a loop that sleeps a
drawn gap and fires:

```
gap = (rateMin + draw × rateVar) / clamp(activity, 0.2, 1)
activity = hourActivity(gate, hour) × crowdFactor
```

- **`rateMin`/`rateVar` describe a gap.** Bigger means rarer.
- **Low activity stretches the gap, up to 5x.** The clamp floors at 0.2, so a
  near-empty office types at a fifth of its busy rate instead of falling
  silent. This is what produces "quiet but alive."
- **Below 5% crowd (`EMPTY_CROWD`) activity is zero and the loop idles.**
  `metro` and `outside` set a `crowdFloor`, so they never drop that low.

So a sound's "probability" is really its average firings per minute, which is
what the tables give, quoted **at full activity**. Multiply by `activity` for
any other moment, down to the 0.2 floor. Camera position picks the scene;
within a scene, zoom scales the layer's level and opens `bedFilter` but never
changes what fires.

### Element sounds

`ping` and `thud` are pitched tones; `burst` is a noise hit whose frequency
column is a filter cutoff. Attack defaults to 0.004 s (a tick); longer is a
swish. "Companion" is the `pair` field: a second hit at that ratio, delay, and
relative gain. A cluster of N hits has N - 1 short gaps and then the pause, and
the per-minute figures count it that way.

| Scene | Kind | Freq (Hz) | Dur (s) | Gain | Attack | Firing at full activity | Companion | Gate | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| office | burst | 750–900 | 0.012 | 0.02–0.04 | 0.004 | 4–12 hits @ ~0.13 s, then ~2.7 s pause (**~133/min**) | | workday | Typist one |
| office | burst | 750–900 | 0.012 | 0.02–0.04 | 0.004 | 4–12 hits @ ~0.14 s, then ~3.5 s pause (**~108/min**) | | workday | Typist two |
| office | burst | 650–750 | 0.35 | 0.03–0.05 | 0.08 | ~6.0 s gap (**~10/min**) | | workday | Page turn |
| condo | ping | 1150–1350 | 0.18 | 0.05–0.08 | 0.004 | ~8.0 s gap (**~7.5/min**) | | condoDay | Dish clink |
| condo | thud | 90–100 | 0.3 | 0.10–0.16 | 0.004 | ~12.0 s gap (**~5/min**) | | condoDay | Cupboard thud |
| hotel | thud | 64–76 | 0.12 | 0.05–0.09 | 0.004 | 5–9 hits @ ~0.47 s, then ~14 s pause (**~25/min**) | | always | Cart wheel bumps |
| hotel | thud | 105–115 | 0.35 | 0.14–0.20 | 0.004 | ~13.5 s gap (**~4.4/min**) | ×0.636, +0.02 s, 0.8 | always | Door close |
| restaurant | ping | 850–1250 | 0.2 | 0.05–0.13 | 0.004 | ~2.1 s gap (**~29/min**) | ×1.5, +0.06 s, 0.7 | attendance | Glass tinkle |
| restaurant | thud | 150–210 | 0.18 | 0.06–0.10 | 0.006 | ~6.0 s gap (**~10/min**) | | attendance | Set-down |
| restaurant | burst | 360–420 | 0.4 | 0.06–0.10 | 0.12 | ~8.5 s gap (**~7.1/min**) | | attendance | Chair scrape |
| fastFood | burst | 1300–1800 | 0.06 | 0.05–0.10 | 0.012 | 2–4 hits @ ~0.14 s, then ~1.5 s pause (**~102/min**) | | attendance | Tray / wrapper |
| fastFood | ping | 900–1400 | 0.15 | 0.05–0.08 | 0.004 | ~2.2 s gap (**~27/min**) | ×1.33, +0.11 s, 0.7 | attendance | Register tone |
| fastFood | thud | 120–170 | 0.2 | 0.05–0.08 | 0.006 | ~5.0 s gap (**~12/min**) | | attendance | Set-down |
| shop | burst | 1050–1150 | 0.42 | 0.04–0.07 | 0.1 | ~3.6 s gap (**~17/min**) | | attendance | Browse rustle |
| outside | ping | 1300–1550 | 0.09 | 0.05–0.07 | 0.004 | ~5.3 s gap (**~11/min**) | ×1.25, +0.11 s, 0.7 | always | **Bird chirp** |
| outside | ping | 365–375 | 0.35 | 0.07–0.09 | 0.004 | ~20.0 s gap (**~3/min**) | ×1.26, +0 s, 0.8 | always | Distant car horn |

`lobby`, `cinema`, `partyHall`, and `metro` have no elements in this table.
The last three run a composed program from `toneCrowdPrograms.ts` instead,
while the venue is live:

- **Party hall:** the band plays a 124 BPM remix of the splash hook, and the
  crowd layer adds the owner's laughs (every 18 to 40 s) and voice-bent whoops
  (every 22 to 46 s).
- **Cinema:** a sparse plucked score under muffled dialogue, with a riser into
  a boom every 8 to 14 s.
- **Metro:** a scripted train arrival and departure about every 55 s (jittered
  by up to 20 percent), over a low rumble.

Under every scene sits the room-tone bed (pink noise behind a steep lowpass,
set per scene in `SCENES`), and rain joins on the dry path when the weather
calls for it.

Look at the bird row twice. Outside, it chirps whenever you are looking,
**at any hour**, because its gate is `always`: about eleven times a minute
with a full street, and still about four a minute at the street's 0.35 crowd
floor.

### Murmur

Talker count scales with live occupancy, so the count listed is the ceiling
(at least one talker while the room is live). Each talker loops: one phrase of
0.9 to 1.8 seconds (about 1.35 s on average), then a pause drawn from
`pauseMin + draw × pauseVar`. "Per talker" counts phrases a minute over that
whole cycle, so a full lobby is six talkers each starting a phrase about every
2.4 seconds.

| Scene | Max talkers | Pause between phrases | Per talker | Muffle | Gain | Pitch | Gate | Crowd floor | Program |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lobby | 6 | ~1.0 s | ~25/min | 950 Hz | 0.50 | | always | | |
| office | 1 | ~2.9 s | ~14/min | 850 Hz | 0.33 | -3.5 | workday | | |
| condo | 3 | ~1.8 s | ~19/min | 480 Hz | 0.30 | -2.5 | condoDay | | |
| hotel | 1 | ~3.7 s | ~12/min | 420 Hz | 0.24 | -4 | always | | |
| restaurant | 3 | ~3.3 s | ~13/min | 800 Hz | 0.34 | | attendance | | |
| fastFood | 5 | ~0.9 s | ~27/min | 1050 Hz | 0.46 | | attendance | | |
| shop | 2 | ~2.4 s | ~16/min | 950 Hz | 0.30 | | attendance | | |
| cinema | 1 | ~2.1 s | ~17/min | 650 Hz | 0.30 | -5.5 | attendance | | cinema |
| partyHall | 2 | ~3.3 s | ~13/min | 900 Hz | 0.30 | | attendance | | party |
| metro | 4 | ~1.4 s | ~22/min | 900 Hz | 0.42 | | always | 0.30 | metro |
| outside | 2 | ~3.0 s | ~14/min | 520 Hz | 0.30 | | always | 0.35 | |

A pitch offset means every talker shares one fixed shift (the office phone
call, the condo TV, the cinema dialogue). Blank means each talker draws its own
from the down-only range.

Voices are the special case: grains chopped from the two seed mp3s by
`toneCrowdVoices.ts`, which screens candidate windows by zero-crossing rate and
RMS so squeals and shouts are never sampled. Everything else is synthesized.

### Gate curves

`hourActivity(gate, hour)` sampled at the hours where it changes. Between
the listed hours it ramps linearly (`workday` from 8 to 9 and 17 to 19,
`condoDay` from 15 to 17 and 21 to 23) or holds. This is the entire
time-of-day model today.

| Hour | 0 | 3 | 6 | 7 | 8 | 9 | 12 | 15 | 17 | 18 | 19 | 21 | 22 | 23 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| `workday` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 0.5 | 0 | 0 | 0 | 0 |
| `condoDay` | 0 | 0 | 0 | 1 | 1 | 0.2 | 0.2 | 0.2 | 1 | 1 | 1 | 1 | 0.5 | 0 |
| `attendance` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

`attendance` returns 1 at every hour by design: the live crowd factor is its
gate. `always` ignores the hour; its activity still follows the crowd factor.

The missing row is the point: **no curve peaks at dawn and none peaks at
night.** Adding those two is the dawn/dusk work below.

## Playing a clip instead of a tone

**This section is a proposal with no schedule.** No backlog row covers
clip-backed elements, and the audio plan puts existing fidelity first: a new or replacement sound waits
for the initial audio gate (see "Where cues come from") and an owner audition.

Synthesized elements are a starting point. A real recording can beat a
filtered sine for anything environmental, so some of these may become
recordings. The playback machinery already exists and is more general than its
current use.

Inside `toneCrowdVoices.ts`, the private method `CrowdVoices.emit` already
does everything a one-shot sample player needs. It is internal today: the
public surface is `phrase`, `laugh`, and `whoop`, so a clip player would add a
new public method on `CrowdVoices` that calls it.

```ts
emit(buffer, gainNode, { rate, offset, wallDur, fade })
```

It builds a `Tone.ToneBufferSource`, sets `playbackRate`, fades in and out so
clips never click, plays a region for a wall-clock length, and hands the source
to `track()`, which reaps it on `onended` with a timer backstop. Loading is
`new Tone.ToneAudioBuffer(url, onload)`, lazy and **silent on failure**: a
missing seed leaves the layer tone-only rather than throwing.

So a clip-backed element needs little new plumbing: a way to declare itself,
a loader for more files, and that new public method.

### The shape

One optional field on `ElementSpec`:

```ts
/** Play a recording instead of synthesizing. When present, `kind`, `freqMin`,
 *  `freqMax`, and `attack` are inert. `gainMin`/`gainMax` and every timing
 *  field still apply, so firing behavior and the tables above are unchanged. */
clip?: {
  /** One of the path constants in `audioAssets.ts`, e.g. a new
   *  `BIRD_CHIRP_CLIP = "audio/bird-chirp.mp3"`. A full literal path, never
   *  one assembled at run time (`audioAssets.test.ts` rejects built paths). */
  file: string;
  /** Random pitch range in semitones, drawn per firing. Omit for no shift. */
  semiMin?: number;
  semiMax?: number;
  /** Optional `[start, end]` regions in seconds; one is picked per firing, so
   *  several variants fit in one file (as LAUGH_REGIONS already does). */
  regions?: [number, number][];
  /** Fade in and out, seconds. Default around 0.01. */
  fade?: number;
};
```

`fireElement` branches at the top: clip present and buffer loaded, draw region
and pitch, `emit`, return. Presence of `clip` is the whole "disable the tone"
mechanism. It is per element, so a scene can mix recorded and synthesized
details.

Pitch is playback rate, reusing the talkers' idiom:

```ts
const semi = semiMin + (semiMax - semiMin) * pseudo(tick++ * 40503 + 5);
const rate = Math.pow(2, semi / 12);
```

**Playback rate changes length as well as pitch.** A chirp pitched down a
fourth is a third longer. `emit`'s `wallDur` is wall-clock time, so a region
`[start, end]` played at `rate` needs `wallDur = (end - start) / rate`;
passing the region's own length cuts a pitched-down clip short and lets a
pitched-up one run into the next variant (`phrase` does the same conversion
the other way round). For short environmental one-shots that is usually
what you want, and it is why ±3 semitones sounds natural while ±12 sounds like
a broken tape. Pitch without a length change means `Tone.PitchShift`, far too
expensive per firing. `pair` reinterprets cleanly: `ratio` multiplies playback
rate rather than frequency, so the bird's second chirp stays a higher echo.

### Swapping one sound

1. **Use a clip that is the project's own.** Every sound must be original to
   Verticopolis: recorded by the owner or rendered from the project's code.
   No third-party sample or pack ships, CC0 included (audio plan, principle
   9). `ASSETS-LICENSE.md` records provenance for everything shipped, and the
   new file gets its own entry there.
2. **Drop it in `src/public/audio/`.** With `root: "src"` that is Vite's public
   dir, so the file is served at `audio/<name>.mp3`.
3. **List it in `src/audio/audioAssets.ts`** as a named constant added to
   `AUDIO_RUNTIME_FILES`, and load it from that constant (the seeds load as
   `` `${baseUrl}${VOICE_TALK_SEED}` ``). `audioAssets.test.ts` fails when a
   file in `src/public/audio/` is missing from the list, and
   `scripts/verify-precache.ts` fails the build when a listed file is missing
   from the service worker's precache.
4. **Prefer mp3.** `globPatterns` in `vite.config.ts` is
   `**/*.{js,css,html,ico,png,svg,woff,woff2,mp3,wasm}`. A `.wav` would not be
   precached, and `audioAssets.test.ts` fails on a listed file the glob does
   not cover. Supporting `wav` means widening that glob and rechecking the
   precache budget in the same change.
5. **Add the `clip` field** to that element's row, with a pitch range (±2 to 3
   semitones is a good first guess for a bird).
6. **Leave the tonal parameters in place** as the fallback, matching how the
   voice layer already degrades to tone-only. Deleting them trades graceful
   degradation for silence.
7. **Update the element table above** to show the clip file.

The crowd data tests (`toneCrowdData.test.ts`) pin the element specs, so a new
field means updating them, and the offline render tool (#969) would need to
cover clips too.

### Encoding

The seeds are the precedent and are encoded harder than people expect:
**22050 Hz, mono, 32 kbps CBR**, 18 seconds in 72 kB. That is right for this
material, because every detail is muffled through a steep lowpass before anyone
hears it. Match them unless a clip proves it needs more.

- **Mono always.** Stereo doubles file *and* decoded memory for no benefit.
- **22.05 kHz is usually enough** for download size; 44.1 kHz is the ceiling
  worth shipping.
- **Low bitrate is fine** for anything soft. Spend bits only on sharp
  transients, where mp3 pre-echo is audible.
- **Peak-normalize** to a consistent level (say −1 dBFS). `gainMin`/`gainMax`
  assume a predictable peak, or gains tuned on one clip will not transfer.
- **Trim silence at both ends.**

**Decoded memory is codec-independent**: Web Audio decodes to float32 PCM and
resamples to the audio context's rate (usually 44.1 or 48 kHz), so RAM is
`duration × contextRate × channels × 4 bytes` whatever the file's bitrate or
sample rate. A 3 s mono clip is about 530 to 580 kB live; a 30 s stereo one is
over 10 MB. Bitrate and file sample rate buy download size only. Watch the
total precache budget too: everything matching `globPatterns` is fetched at
install, so it matters more than the 6 MB per-file cap.

**The mp3 trap.** MP3 is not gapless. Encoders prepend delay (LAME's is 1105
samples, recorded in the Xing header) and pad the end, and browser decoders
vary in how much they strip, so a decoded mp3 can begin with silence: roughly
25 ms at 44.1 kHz, 50 ms at 22.05 kHz. Invisible for a bird or a horn. It
matters for anything rhythmic: typing fires at ~0.13 s, so 50 ms is over a
third of the gap and turns crisp ticks to mush. Cheapest fix is **`regions`
starting past the silence**, which costs nothing since `emit` already takes an
offset; otherwise trim once at load (a percussive wav needs the glob change in
step 4 above). Confirm by measuring in the browser before relying on it: the
numbers above show the shape of the problem and were never measured in this
app.

## House rules

Breaking one tends to produce a bug that shows up only on someone else's
hardware or in a replay.

- **Never draw from the simulation's RNG.** Sound is presentation and the
  seeded streams are part of save determinism. Vary with the `pseudo` hash
  seeded on things that already move. Never `Math.random`, never `sim.rng`.
- **No bloop ramps below 160 Hz.** The owner tested on phone and laptop
  speakers and could not hear lower floors (the audibility rule in
  `toneVoices.ts`). Deep cues add quiet octave and twelfth partials so small
  speakers reconstruct the pitch.
- **Guard retriggers.** `ERROR_HOLDOFF` is the model: a 0.65 s window keyed to
  the voice set by `WeakMap`, with an explicit check for a rewound Tone clock.
- **Keep the pure modules pure.** `toneScenes.ts` and `toneTracks.ts` carry no
  Tone.js import and no live state, which lets tests assert note data directly.
- **Fanfares are bells only.**
- **The engine stays free of audio.** No playback code or audio dependency
  enters `engine-rs/` or `src/engine/`. The engine says what happened and
  never what it should sound like.
- **Audio only reads.** It never calls `drainGameplayEvents()`, never writes
  to the simulation, and never parses log or bulletin text for a cue.

## Adding a cue

1. Add the name to the `SfxName` union in `toneScenes.ts`.
2. Add its recipe as a `case` in `playSfx`, reusing existing voices where you
   can. A new instrument means a new `SfxVoices` field and its construction in
   `createSfxVoices`; the engine's `dispose()` already tears down every
   `SfxVoices` value.
3. Fire it with `app.audio.sfx("name")` from a player action in `src/game/`.
   The facade no-ops before the engine loads, which is correct behavior. A cue
   driven by something the tower does on its own belongs to the audio router
   the audio plan adds (#965); see "Where cues come from" before wiring one.
4. Tests: `toneVoices.test.ts` for the recipe, `toneAudioEngineGraph.test.ts`
   for routing, `toneAudioEngine.test.ts` for the inert-without-audio contract.
5. If it is optional for the player, gate it at the call site in `src/game/`.
   Mute and the three volumes are the only policy the engine knows about.

Before any of that, check that the sound may be added at all:

- **It is original.** Owner-recorded or synthesized in the project's code,
  per the short version above.
- **It can wait for the gate.** A new composition lands only after the
  initial audio gate (stages 1 and 2 of the audio plan), and only after the
  owner has auditioned it.
- **It is player-facing.** A new or changed cue bumps `package.json`
  `version` (minor, with the lockfile via `npm version`), and its deep review
  is `/gds-code-review` (see `CLAUDE.md`).

## Idea: the cash ding

**This is an idea with no schedule.** No backlog row or issue covers it yet,
and as a
new composition it waits for the initial audio gate. One transaction rings
once; several arriving together ring as a cluster that differs every time, so
a big payday never becomes one louder ding.

### What the engine would need to say

The engine has no income event today; the audio plan lists that as a known
gap. The bulletin lines tagged `"money"` cannot stand in for one:

- **Audio never parses log text.** The log is player-facing prose, and the
  audio plan rules it out as a cue source.
- **Line count is not transaction count.** Rent collection aggregates: forty
  offices produce one line carrying a total and a count. The cluster scales
  with the count, so the count has to travel.
- **Not every `"money"` line is profit.** The same kind tags maintenance, the
  bomb-threat ransom, and other outflows. A ding on the maintenance bill would
  invert the point of the sound.

The plan also rules out a separate audio side channel on `Simulation`. So the
route is an engine ask: a new gameplay catalog event (for example an income
event carrying a source and a transaction count) added to
`conformance/events/catalog.json` and emitted by both engines, with the
conformance lock updated in the same change. Income sources would be the rent
collections, hourly traffic income, hotel checkouts, and condo sales; buried
treasure is a windfall and a judgment call; outflows emit nothing. Whether the
event volume fits the 1,024-event ring at top speed is part of that design.
The cue then plays from the audio router (#965), never from a second drain.

### Turning a count into a cluster

Per frame, sum the counts in the batch and ask for one burst. Merging matters:
rent and a hotel checkout can land on the same tick, and two overlapping
bursts sound like a mistake.

- Ding count is **compressive**: one transaction is one ding, forty is eight or
  ten. Cap it (twelve is reasonable) so a mature tower does not machine-gun.
- Bound the burst to roughly half a second, so it reads as one chunky event.
- Vary via jittered onsets and pitches from a fixed consonant set, seeded from
  `pseudo`, so no two collections match and none can clash with the bed.
- A holdoff stops a fast-forwarded catch-up tick stacking bursts.

### Voice, preference, process

The voice is an open question for the owner. The existing `money` arpeggio
predates the human-recorded pass; the ping bell (`strikeBell`) is the obvious
candidate and clusters well. That is a taste call and an audition.

A `cashDing` switch in `Prefs` (default on) in the Settings **Sound** section,
`role="switch"` with an `aria-describedby` note like the existing toggles,
gated at the call site in `src/game/`. A three-way (off / single / cluster) is
worth considering if the binary proves blunt.

Player-facing, so `version` takes a **minor** bump with the lockfile. Deep
review is `/gds-code-review`. Test the count mapping and merge/holdoff as pure
functions, the event with a conformance scenario on both engines proving
income emits and maintenance does not, and the pref alongside the existing
slider tests.

## Candidates

Two of these are already planned in the audio plan: the elevator chime and
the event cues, each with its own backlog row and issue. The rest are ideas
with no row yet. Every new sound needs an owner audition, and as a new
composition it waits for the initial audio gate. Roughly in order of what
they add.

### Dawn and dusk gating (birds, owl)

The clearest gap and the cheapest fix. `outside` already has bird chirps, but
its gate is `always`, so they chirp at three in the morning exactly as at
sunrise. There is no owl.

The fix needs new curves in `hourActivity` and no new machinery: a `dawn` curve
peaking around sunrise, a `night` curve for an owl that is silent by day. A
handful of lines beside `workday` and `condoDay`. An owl hoot is a low pair of
pings with the second lower, which `pair` already expresses. This buys the
park-like quality most directly and needs no engine signal: the layer already
has the sim hour.

### Elevator chime and whir

The sound most associated with the original and the one with most ways to go
wrong. A sound on every arrival in a twenty-four-shaft tower is unbearable
within a minute.

**The arrival chime is planned** (audio plan, stages 5a and 5b). No engine
output says a car stopped today, and audio must not guess a stop from a car's
position and direction. So the engine first publishes a per-car stop counter
in the frame read model (`engine-car-door-state`, #966), kept off the event
catalog because stops at top speed would flood it. The web chime then plays
when a counter rises, for cars in view only, at most one per car per frame
and rate capped (`web-elevator-chime`, #981). Follow those rows rather than
adding a chime as a crowd element.

A **motor whir** as ambient texture is still an open idea. If it comes back,
its activity term should read published state, such as the cars in view and
their direction from the read model, and never re-derive dispatch decisions.
Settle by ear whether it belongs to the shaft or the floor.

### Cinema genres

The original varied a theater by what was showing (a western being memorable).
`CinemaProgram` is one fixed program today, identical in every cinema.

The engine has a near-miss hook: it books **blockbusters** monthly per cinema,
keyed by unit id and saved, worth 2.2x income. But that is only a yes or no
with no genre, and it is not in the frame read model, so audio could use it
only after the engine publishes it.

The real obstacle is that **`ViewFocus` carries no unit id** (`centerFloor`,
`dominant`, `night`, `zoom`, `weather`, `hour`, `crowd`), so the layer resolves
a scene and cannot tell one cinema from another. Either derive the
genre from `pseudo(centerFloor, month)` (no plumbing, no engine or save change;
two cinemas on one floor would share a genre) or add `dominantId` to
`ViewFocus` for exactness. Start cheap: the interesting work is the genre
programs themselves, and that is identical either way.

Keep the vocabulary small, three or four recognizable through a wall, and keep
it muffled. The joke was hearing a shootout through the floor.

### Cash registers in shops

`shop` has one element today, a browse rustle. A register would thicken it and
tie retail floors to the money loop texturally. Gated on `attendance`, which
the scene already uses.

The register and the cash ding would be two separate sounds: the ding is
feedback about your money, the register is the building sounding like
itself. Both can exist; only the ding gets a preference.

### More office activity

Phones, drawers, chairs. They cost nothing but data, since the `workday` gate
and cluster machinery already handle when and how often. The cheapest way to
make a floor sound busier.

### Event cues

**Planned** (`web-audio-event-cues`, #967, audio plan stage 6, after the
initial audio gate). Today a fire or bomb threat plays only the generic
`error` when its choice modal opens, and a VIP visit plays nothing. The plan
maps each cue to one source:

- an alarm (fire rescue) and a threat cue (bomb) when the choice modal opens,
  replacing `error` there; `fire_started` itself stays silent because the
  modal opens in the same step;
- an explosion on `bomb_detonated` when rooms burn, and a low impact on
  `fire_gutted`;
- `notify` on `milestone_reached` and on an emergency that times out;
- Santa, thief, treasure, and VIP cues when their effect sequences step, with
  the VIP cue skipped on the winning visit (the win cue covers it).

Each informative cue keeps its visual twin, and no alarm loops while a modal
waits. These are conventional event cues, so they are held to the higher bar:
an event cue earns its place only if the player must react or might be
looking elsewhere. Read the plan's mapping table before proposing another.

## Hearing the current sounds

There is no checked-in way to render the sounds to a file yet. The planned
tool is `audio-offline-render` (#969, audio plan stage 4): it renders the real
graph under `Tone.Offline` in headless Chromium to files (the programs, venue
programs, beds per scene, and jingles) with a manifest, and the outputs stay
out of the repository. Until it lands, listen in the running game (`npm run
dev`), zoomed in on the scene you changed.

An earlier draft of this doc carried a local render script. It was dropped
because nothing tested it and it re-implemented the crowd layer's synths, so
it could drift from the game unnoticed. The lessons from it are worth carrying
into #969:

- **Render through the master gain (`0.35`)** or `build`, `sell`, and
  `error` clip, which makes a recipe sound hotter than it is.
- **Normalize per group (cues, ambience), never per item.** At the master,
  office typing sits around 50 dB below the `error` cue. That is right in
  game and inaudible in a sample, and per-item normalizing would flatten the
  balance you are listening for.
- **Trim silence per sound before joining**, or every later timestamp
  drifts.
- **`burst` elements are pink noise**, so their level varies a few dB run to
  run; compare a `ping` or `thud` render to tell whether a recipe changed.
- **Lay out the sample for listening.** A horn every 20 s makes an unusable
  sample, so space hits for timbre and judge rates from the tables above.
