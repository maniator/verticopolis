# Sound

How Verticopolis makes noise, what each sound is for, and how to add one.

The design record for the current material is
`_bmad-output/specs/spec-human-audio-theme/` and the crowd-din-ambience GDD
under `_bmad-output/planning-artifacts/gdds/`. When this doc and a SPEC
disagree about note data, the SPEC wins.

## The goal

The 1994 original's soundscape was dynamic in a specific way. Rather than cues
attached to events, it was a building you could hear: sounds arrived at their
own rates, layered without coordinating, and changed with the hour and with
where you were looking.

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
  `src/public/audio/voice-talk.mp3` and `voice-laughs.mp3`, seeds the crowd
  layer chops into murmur. Everything else is generated at runtime.
- The music and action cues are transcriptions of the owner's own recordings
  (hums, chest hits, taps, a bloop, a ping). New cues should speak in that
  voice rather than introduce a fresh instrument.

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
| `src/game/audioPrefs.ts` | Player commands: mute, volume, and their persistence. |

## The bus graph

- **`musicBus`** carries the composed tracks. The **Music** slider.
- **`ambBus`** and **`ambDryBus`** carry the crowd layer, room tone, and rain.
  The **Ambience** slider. Two nodes because rain stays dry while the rest
  shares the reverb.
- **`sfxBus`** carries the action jingles. The **Effects** slider.
- **`master`** sits under all of them at gain `0.35`; the topbar button mutes
  there.

A `bedFilter` lowpass on the ambient path opens as the camera zooms in, so
distance muffles the building's life. Music bypasses it. Percussion routes
around the music-path filters so its body survives a low Music setting.

Three sliders plus mute is the whole player-facing surface. Levels live in
`Prefs`, are clamped in the facade before reaching an `AudioParam`, and are
read back from the facade so prefs never store junk.

## Lifecycle

Browsers refuse to make noise before a gesture, and Tone.js is ~230 kB, so both
are handled together. `GameApp` builds the facade at boot with nothing heavy
loaded. The first real gesture calls `start()`, which feature-detects
`AudioContext` (so tests and unsupported environments never fetch the chunk),
then dynamically imports `ToneAudioEngine`. The chunk is precached by the
service worker, so audio works offline later. Once the engine exists the facade
replays what it was holding: mute, volumes, program, last focus.

A `generation` counter guards the load window, so a `dispose()` or superseding
`start()` mid-flight cannot resurrect a torn-down engine.

`setProgram("splash" | "game")` picks the track; the splash theme crossfades to
the in-game bed on entry.

## The cue vocabulary

`SfxName` is the complete list of one-shot cues. All play through `sfxBus`.

| Cue | Sound | Fired from |
| --- | ----- | ---------- |
| `build` | One bloop swooping 520 Hz down to 180 Hz | `buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts` |
| `click` | A small, quick high bloop | `editorActions.ts` |
| `sell` | Two falling bloops | `buildActions.ts`, `editorActions.ts` |
| `error` | A slow, sighing double bloop | Every refusal path, paired with its toast |
| `promote` | The splash theme's peak turn on the ping bell | `frameLoop.ts`, star promotion and the win |
| `notify` | A single ping on G4 | The onboarding step chime |
| `money` | An ascending four-note arpeggio | **Nothing. Defined and uncalled.** |

`money` predates the human-recorded pass; the SPEC deliberately left it alone
until "a later pass." The cash ding below is that pass.

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

### How firing works

There is no per-event probability roll. Each element runs a loop that sleeps a
drawn gap and fires:

```
gap = (rateMin + draw × rateVar) / clamp(activity, 0.2, 1)
activity = hourActivity(gate, hour) × crowdFactor
```

- **`rateMin`/`rateVar` are a gap, not a rate.** Bigger means rarer.
- **Low activity stretches the gap, up to 5x.** The clamp floors at 0.2, so a
  near-empty office types at a fifth of its busy rate instead of falling
  silent. This is what produces "quiet but alive."
- **Below 5% crowd (`EMPTY_CROWD`) activity is zero and the loop stops.**

So a sound's "probability" is really its average firings per minute, which is
what the tables give, quoted **at full activity**. Multiply by `activity` for
any other moment, down to the 0.2 floor. Both tables set aside camera focus,
which scales level and opens `bedFilter` but never changes what fires.

### Element sounds

`ping` and `thud` are pitched tones; `burst` is a noise hit whose frequency
column is a filter cutoff. Attack defaults to 0.004 s (a tick); longer is a
swish. "Companion" is the `pair` field: a second hit at that ratio, delay, and
relative gain.

| Scene | Kind | Freq (Hz) | Dur (s) | Gain | Attack | Firing at full activity | Companion | Gate | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| office | burst | 750–900 | 0.012 | 0.02–0.04 | 0.004 | 4–12 hits @ ~0.13 s, then ~2.7 s pause (**~128/min**) | | workday | Typist one |
| office | burst | 750–900 | 0.012 | 0.02–0.04 | 0.004 | 4–12 hits @ ~0.14 s, then ~3.5 s pause (**~105/min**) | | workday | Typist two |
| office | burst | 650–750 | 0.35 | 0.03–0.05 | 0.08 | ~6.0 s gap (**~10/min**) | | workday | Page turn |
| condo | ping | 1150–1350 | 0.18 | 0.05–0.08 | 0.004 | ~8.0 s gap (**~7.5/min**) | | condoDay | Household ping |
| condo | thud | 90–100 | 0.3 | 0.10–0.16 | 0.004 | ~12.0 s gap (**~5/min**) | | condoDay | Household thud |
| hotel | thud | 64–76 | 0.12 | 0.05–0.09 | 0.004 | 5–9 hits @ ~0.47 s, then ~14 s pause (**~24/min**) | | always | Footsteps |
| hotel | thud | 105–115 | 0.35 | 0.14–0.20 | 0.004 | ~13.5 s gap (**~4.4/min**) | ×0.636, +0.02 s, 0.8 | always | Door close |
| restaurant | ping | 850–1250 | 0.2 | 0.05–0.13 | 0.004 | ~2.1 s gap (**~29/min**) | ×1.5, +0.06 s, 0.7 | attendance | Cutlery |
| restaurant | thud | 150–210 | 0.18 | 0.06–0.10 | 0.006 | ~6.0 s gap (**~10/min**) | | attendance | Set-down |
| restaurant | burst | 360–420 | 0.4 | 0.06–0.10 | 0.12 | ~8.5 s gap (**~7.1/min**) | | attendance | Kitchen swish |
| fastFood | burst | 1300–1800 | 0.06 | 0.05–0.10 | 0.012 | 2–4 hits @ ~0.14 s, then ~1.5 s pause (**~95/min**) | | attendance | Tray / wrapper |
| fastFood | ping | 900–1400 | 0.15 | 0.05–0.08 | 0.004 | ~2.2 s gap (**~27/min**) | ×1.33, +0.11 s, 0.7 | attendance | Counter ping |
| fastFood | thud | 120–170 | 0.2 | 0.05–0.08 | 0.006 | ~5.0 s gap (**~12/min**) | | attendance | Set-down |
| shop | burst | 1050–1150 | 0.42 | 0.04–0.07 | 0.1 | ~3.6 s gap (**~17/min**) | | attendance | Browse rustle |
| outside | ping | 1300–1550 | 0.09 | 0.05–0.07 | 0.004 | ~5.3 s gap (**~11/min**) | ×1.25, +0.11 s, 0.7 | always | **Bird chirp** |
| outside | ping | 365–375 | 0.35 | 0.07–0.09 | 0.004 | ~20.0 s gap (**~3/min**) | ×1.26, +0 s, 0.8 | always | Distant car horn |

`lobby`, `cinema`, `partyHall`, and `metro` have no elements: murmur and, for
the last three, a composed program instead.

Look at the bird row twice. It fires about eleven times a minute whenever you
are looking outside, **at any hour**, because its gate is `always`.

### Murmur

Talker count scales with live occupancy, so the count listed is the ceiling.
The phrase rate is per talker, so a full lobby is six talkers each starting a
phrase about every second.

| Scene | Max talkers | Phrase gap | Per talker | Muffle | Gain | Pitch | Gate | Crowd floor | Program |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lobby | 6 | ~1.0 s | ~60/min | 950 Hz | 0.50 | | always | | |
| office | 1 | ~2.9 s | ~21/min | 850 Hz | 0.33 | -3.5 | workday | | |
| condo | 3 | ~1.8 s | ~33/min | 480 Hz | 0.30 | -2.5 | condoDay | | |
| hotel | 1 | ~3.7 s | ~16/min | 420 Hz | 0.24 | -4 | always | | |
| restaurant | 3 | ~3.3 s | ~19/min | 800 Hz | 0.34 | | attendance | | |
| fastFood | 5 | ~0.9 s | ~67/min | 1050 Hz | 0.46 | | attendance | | |
| shop | 2 | ~2.4 s | ~25/min | 950 Hz | 0.30 | | attendance | | |
| cinema | 1 | ~2.1 s | ~29/min | 650 Hz | 0.30 | -5.5 | attendance | | cinema |
| partyHall | 2 | ~3.3 s | ~18/min | 900 Hz | 0.30 | | attendance | | party |
| metro | 4 | ~1.4 s | ~43/min | 900 Hz | 0.42 | | always | 0.30 | metro |
| outside | 2 | ~3.0 s | ~20/min | 520 Hz | 0.30 | | always | 0.35 | |

A pitch offset means every talker shares one fixed shift (the office phone
call, the condo TV, the cinema dialogue). Blank means each talker draws its own
from the down-only range.

Voices are the special case: grains chopped from the two seed mp3s by
`toneCrowdVoices.ts`, which screens candidate windows by zero-crossing rate and
RMS so squeals and shouts are never sampled. Everything else is synthesized.

### Gate curves

`hourActivity(gate, hour)` in full. This is the entire time-of-day model today.

| Hour | 0 | 3 | 6 | 7 | 8 | 9 | 12 | 15 | 17 | 18 | 19 | 21 | 22 | 23 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| `workday` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 0.5 | 0 | 0 | 0 | 0 |
| `condoDay` | 0 | 0 | 0 | 1 | 1 | 0.2 | 0.2 | 0.2 | 1 | 1 | 1 | 1 | 0.5 | 0 |
| `attendance` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

`attendance` returns 1 at every hour by design: the live crowd factor is its
gate. `always` is ungated in both dimensions.

The missing row is the point: **no curve peaks at dawn and none peaks at
night.** Adding those two is the dawn/dusk work below.

## Playing a clip instead of a tone

Synthesized elements are a starting point. A real recording beats a filtered
sine for anything environmental, and most of these should eventually become
recordings. The playback machinery already exists and is more general than its
current use.

`CrowdVoices.emit` is, under the voice-specific methods wrapped around it, a
complete one-shot sample player:

```ts
emit(buffer, gainNode, { rate, offset, wallDur, fade })
```

It builds a `Tone.ToneBufferSource`, sets `playbackRate`, fades in and out so
clips never click, plays a region for a wall-clock length, and hands the source
to `track()`, which reaps it on `onended` with a timer backstop. Loading is
`new Tone.ToneAudioBuffer(url, onload)`, lazy and **silent on failure**: a
missing seed leaves the layer tone-only rather than throwing.

So a clip-backed element needs no new plumbing, only a way to declare itself
and a loader for arbitrary files.

### The shape

One optional field on `ElementSpec`:

```ts
/** Play a recording instead of synthesizing. When present, `kind`, `freqMin`,
 *  `freqMax`, and `attack` are inert. `gainMin`/`gainMax` and every timing
 *  field still apply, so firing behavior and the tables above are unchanged. */
clip?: {
  /** File under `src/public/audio/`, e.g. "bird-chirp.mp3". */
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
fourth is a third longer. For short environmental one-shots that is usually
what you want, and it is why ±3 semitones sounds natural while ±12 sounds like
a broken tape. Pitch without a length change means `Tone.PitchShift`, far too
expensive per firing. `pair` reinterprets cleanly: `ratio` multiplies playback
rate rather than frequency, so the bird's second chirp stays a higher echo.

### Swapping one sound

1. **Get a clip you can license.** `ASSETS-LICENSE.md` records provenance for
   everything shipped. Owner-recorded, or CC0 with a source line. Most likely
   to block you, so settle it first.
2. **Drop it in `src/public/audio/`.** With `root: "src"` that is Vite's public
   dir, so the file is served at `audio/<name>.mp3`, the path shape the seed
   loader already builds from `baseUrl`.
3. **Prefer mp3.** `globPatterns` is
   `**/*.{js,css,html,ico,png,svg,woff,woff2,mp3}`. A `.wav` works in the
   browser but **is not precached**, so it silently fails offline. Adding `wav`
   there is a one-word change if you want it.
4. **Add the `clip` field** to that element's row, with a pitch range (±2 to 3
   semitones is a good first guess for a bird).
5. **Leave the tonal parameters in place** as the fallback, matching how the
   voice layer already degrades to tone-only. Deleting them trades graceful
   degradation for silence.
6. **Update the element table above** to show the clip file.

The render harness does not cover clips (it mirrors the synth path), and the
crowd data tests pin the element specs, so a new field means updating them.

### Encoding

The seeds are the precedent and are encoded harder than people expect:
**22050 Hz, mono, 32 kbps CBR**, 18 seconds in 72 kB. That is right for this
material, because every detail is muffled through a steep lowpass before anyone
hears it. Match them unless a clip proves it needs more.

- **Mono always.** Stereo doubles file *and* decoded memory for no benefit.
- **22.05 kHz is usually enough**; 44.1 kHz is the ceiling worth shipping.
- **Low bitrate is fine** for anything soft. Spend bits only on sharp
  transients, where mp3 pre-echo is audible.
- **Peak-normalize** to a consistent level (say −1 dBFS). `gainMin`/`gainMax`
  assume a predictable peak, or gains tuned on one clip will not transfer.
- **Trim silence at both ends.**

**Decoded memory is codec-independent**: Web Audio decodes to float32 PCM, so
RAM is `duration × sampleRate × channels × 4 bytes` regardless of bitrate. A 3 s
mono 22.05 kHz clip is ~265 kB live; a 30 s stereo 44.1 kHz one is over 10 MB.
Bitrate buys download size, not runtime footprint. Watch the total precache
budget too: everything matching `globPatterns` is fetched at install, so it
matters more than the 6 MB per-file cap.

**The mp3 trap.** MP3 is not gapless. Encoders prepend delay (LAME's is 1105
samples, recorded in the Xing header) and pad the end, and browser decoders
vary in how much they strip, so a decoded mp3 can begin with silence: roughly
25 ms at 44.1 kHz, 50 ms at 22.05 kHz. Invisible for a bird or a horn. It
matters for anything rhythmic: typing fires at ~0.13 s, so 50 ms is over a
third of the gap and turns crisp ticks to mush. Cheapest fix is **`regions`
starting past the silence**, which costs nothing since `emit` already takes an
offset; otherwise ship percussive clips as wav, or trim once at load. Confirm
by measuring in the browser before relying on it: the numbers above are the
shape of the problem, not a measured constant for this app.

## House rules

Breaking one tends to produce a bug that shows up only on someone else's
hardware or in a replay.

- **Never draw from the simulation's RNG.** Sound is presentation and the
  seeded streams are part of save determinism. Vary with the `pseudo` hash
  seeded on things that already move. Never `Math.random`, never `sim.rng`.
- **No bloop ramps below 160 Hz.** The owner could not hear lower floors on
  phone or laptop speakers across two audition rounds. Deep cues add quiet
  octave and twelfth partials so small speakers reconstruct the pitch.
- **Guard retriggers.** `ERROR_HOLDOFF` is the model: a 0.65 s window keyed to
  the voice set by `WeakMap`, with an explicit check for a rewound Tone clock.
- **Keep the pure modules pure.** `toneScenes.ts` and `toneTracks.ts` carry no
  Tone.js import and no live state, which lets tests assert note data directly.
- **Fanfares are bells only.**
- **`src/engine/` stays free of audio.** The engine says what happened, never
  what it should sound like.

## Adding a cue

1. Add the name to the `SfxName` union in `toneScenes.ts`.
2. Add its recipe as a `case` in `playSfx`, reusing existing voices where you
   can. A new instrument means a new `SfxVoices` field, construction in
   `createSfxVoices`, and an entry in the engine's `dispose()` list.
3. Fire it with `app.audio.sfx("name")`. The facade no-ops before the engine
   loads, which is correct behavior.
4. Tests: `toneVoices.test.ts` for the recipe, `toneAudioEngineGraph.test.ts`
   for routing, `toneAudioEngine.test.ts` for the inert-without-audio contract.
5. If it is optional for the player, gate it at the call site in `src/game/`.
   Mute and the three volumes are the only policy the engine knows about.

## Planned: the cash ding

**Designed, not built.** One transaction rings once; several arriving together
ring as a cluster that differs every time, rather than one louder ding.

### What the engine needs to say

Money already emits bulletin lines tagged `"money"`, but that channel cannot
carry the cue:

- **Line count is not transaction count.** `collectRent` aggregates: forty
  offices produce one emit carrying a total and a count `n`. The cluster scales
  with `n`, so the count has to travel.
- **Not every `"money"` line is profit.** The same kind tags maintenance, the
  bomb-threat ransom, and other outflows. A ding on the maintenance bill would
  invert the point of the sound.

So: a transient cash-event channel on `Simulation`, parallel to the log and
**not serialized**. Income paths push `{ n, amount }`; the frame loop drains
it. That keeps `LogEntry` (which *is* persisted in the save's bulletin tail)
free of a presentation-only field, and keeps save schema and migrations out of
the change. Pushers are the rent collections, hourly traffic income, hotel
checkout, and condo sales. Buried treasure is a windfall and a judgment call.
Outflows push nothing.

### Turning a count into a cluster

Drain each frame, sum the counts, ask for one burst. Merging matters: rent and
a hotel checkout can land on the same tick, and two overlapping bursts sound
like a mistake.

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
functions, the channel with an economy test proving income pushes and
maintenance does not, and the pref alongside the existing slider tests.

## Candidates

None committed; each needs an audition. Roughly in order of what they add.

### Dawn and dusk gating (birds, owl)

The clearest gap and the cheapest fix. `outside` already has bird chirps, but
its gate is `always`, so they chirp at three in the morning exactly as at
sunrise. There is no owl.

The fix is new curves in `hourActivity`, not new machinery: a `dawn` curve
peaking around sunrise, a `night` curve for an owl that is silent by day. A
handful of lines beside `workday` and `condoDay`. An owl hoot is a low pair of
pings with the second lower, which `pair` already expresses. This buys the
park-like quality most directly and needs no engine signal: the layer already
has the sim hour.

### Elevator whir

The sound most associated with the original and the one with most ways to go
wrong. A whir on every arrival in a twenty-four-shaft tower is unbearable
within a minute.

The right shape is an ambient element driven by transport activity in view,
not a cue per arrival. That keeps it in the crowd layer's existing machinery
and sidesteps the firehose. Sketched in the element table's terms, **proposed,
every number a starting guess**:

| Scene | Kind | Freq (Hz) | Dur (s) | Gain | Attack | Firing at full activity | Companion | Gate | What it is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transport | burst | 200–320 | 0.6 | 0.04–0.07 | 0.15 | ~7 s gap (**~8.5/min**) | | attendance | Motor whir |
| transport | ping | 800–900 | 0.12 | 0.03–0.05 | 0.004 | ~11 s gap (**~5.5/min**) | ×1.5, +0.09 s, 0.6 | attendance | Arrival chime |

The design work is not the recipe, it is the **activity term**. Every scene
derives activity from occupancy of rooms in view; transport needs its own,
something like cars in motion over shafts in the viewport. Settle by ear
whether whir and chime are one element or two (two lets them drift out of
phase), and whether they belong to the shaft or the floor.

### Cinema genres

The original varied a theater by what was showing (a western being memorable).
`CinemaProgram` is one fixed program today, identical in every cinema.

The engine has a near-miss hook: `EconomySystem` books **blockbusters** monthly
per cinema, keyed by unit id and serialized, worth 2.2x income. But it is a
boolean, not a genre.

The real obstacle is that **`ViewFocus` carries no unit id** (`centerFloor`,
`dominant`, `night`, `zoom`, `weather`, `hour`, `crowd`), so the layer resolves
a scene, not a room, and cannot tell one cinema from another. Either derive the
genre from `pseudo(centerFloor, month)` (no plumbing, no engine or save change;
two cinemas on one floor would share a genre) or add `dominantId` to
`ViewFocus` for exactness. Start cheap: the interesting work is the genre
programs themselves, and that is identical either way.

Keep the vocabulary small, three or four recognizable through a wall, and keep
it muffled. The joke was hearing a shootout through the floor, not watching the
film.

### Cash registers in shops

`shop` has one element today, a browse rustle. A register would thicken it and
tie retail floors to the money loop texturally. Gated on `attendance`, which
the scene already uses.

This is a *different sound* from the cash ding: the ding is feedback about your
money, the register is the building sounding like itself. Both can exist; only
the ding gets a preference.

### More office activity

Phones, drawers, chairs. They cost nothing but data, since the `workday` gate
and cluster machinery already handle when and how often. The cheapest way to
make a floor sound busier.

### Event cues

A fire alarm (the fire event is visual and textual only today), a distinct VIP
arrival (it shares `notify`), and whether `notify` should split by severity.
These are conventional event cues rather than soundscape, so hold them to the
higher bar: an event cue earns its place only if the player must react and
might be looking elsewhere.

## Hearing the current sounds

Tweaked a recipe and want to hear it? Save the script below outside the repo,
then run it **from the repo root**:

```
node ~/render-cues.mjs                 # writes to $TMPDIR/verticopolis-cues.wav
node ~/render-cues.mjs ~/cues.wav      # or name the file
```

It covers the seven action cues, the two percussion voices, and **every ambient
element from the tables above**, in that order, with one-second gaps: about 80
seconds. It prints a timestamp and true level per sound, so you can seek to
what you changed:

```
/tmp/verticopolis-cues.wav
listening boost: cues x1.94, ambient x22.9  (dBFS below is the TRUE level at the master, before that boost)
     0.00s    -8.6 dBFS  sfx: build
     1.34s   -13.5 dBFS  sfx: click
     2.62s    -8.6 dBFS  sfx: sell
     4.08s    -6.7 dBFS  sfx: error
     5.83s   -14.7 dBFS  sfx: promote
     8.87s   -13.5 dBFS  sfx: notify
    10.91s   -16.3 dBFS  sfx: money
    12.33s   -19.9 dBFS  perc: thump (x3)
    14.47s   -26.2 dBFS  perc: tap (x3)
    16.52s   -58.4 dBFS  office: typist 1
    19.20s   -58.9 dBFS  office: typist 2
    21.79s   -54.0 dBFS  office: page turn
    26.05s   -41.4 dBFS  condo: household ping
    30.31s   -33.4 dBFS  condo: household thud
    34.67s   -36.9 dBFS  hotel: footsteps
    39.99s   -28.1 dBFS  hotel: door close
    44.43s   -35.7 dBFS  restaurant: cutlery
    48.77s   -36.0 dBFS  restaurant: set-down
    53.05s   -51.8 dBFS  restaurant: kitchen swish
    57.38s   -51.2 dBFS  fastFood: tray / wrapper
    58.96s   -39.7 dBFS  fastFood: counter ping
    63.31s   -37.9 dBFS  fastFood: set-down
    67.59s   -52.0 dBFS  shop: browse rustle
    71.88s   -40.8 dBFS  outside: bird chirp
    76.21s   -34.8 dBFS  outside: distant car horn
```

No new dependencies: `playwright` and `esbuild` are already here, and rendering
runs in Chromium's `OfflineAudioContext`, which is pure computation (no sound
card, no realtime wait). The whole sample takes a few seconds.

Those timings are a reference, not a fixture. The pitched `ping` and `thud`
rows reproduce exactly run to run, but `burst` rows are pink noise, which is
not deterministic, so their level moves a few dB and the silence trim shifts
their start slightly. Everything after a burst therefore drifts by a fraction
of a second between runs. Do not diff two listings and conclude a recipe
changed; check a `ping` or `thud` row, which will be identical if nothing did.

**Two things the sample is not.** The spacing inside an ambient sample is a
presentation choice: five hits about 0.7 s apart so you hear timbre and pitch
spread. Real rates are in the table and some are far slower (the horn's gap is
~20 s). Cluster elements are the exception and keep their real intra-cluster
gap, since that stutter is the character of typing. Judge timbre from the
sample and rate from the table.

And levels are boosted **per group**. Office typing sits around −58 dBFS at the
master against the error cue's −7, a 50 dB gap. That is correct in game
and useless in a sample, where one constant would leave the ambient half
inaudible. So cues and ambient normalize separately: balance *within* a group
is exactly what the engine produces, and the printed dBFS carries the
relationship *between* them.

**Things it has to get right**, all learned the hard way:

- **Render through the master gain (`0.35`)** or `build`, `sell`, and `error`
  clip, which will fool you into thinking a recipe is too hot.
- **Normalize per group, never per item.** Per-item flattens exactly the
  information you are listening for.
- **Trim silence per sound before joining**, or the gaps are not the second
  they claim and every later timestamp drifts.

Percussion and ambient elements render dry; their real paths pass the shared
reverb and, for ambient, the camera-driven `bedFilter`. Omitting the filter is
deliberate. The sfx cues are exact, since that path is dry by design.

Murmur is not included: talkers are runtime grains from the seed mp3s, so it is
voices rather than a recipe you would tune here.

One structural note: the harness reproduces `CrowdLayer`'s private
`fireElement` rather than calling it (same synths, volumes, gain multipliers,
and `pseudo` draws), because offline rendering has no timers, so hit times are
laid out explicitly. Change the synth definitions in `toneCrowd.ts` and you
must change them here too, or the sample quietly stops matching the game.

<details>
<summary><code>render-cues.mjs</code></summary>

```js
/**
 * Render every default cue recipe and every ambient element to one WAV.
 * Run from the repo root:  node render-cues.mjs [outfile.wav]
 */
import { createRequire } from "node:module";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const OUT = process.argv[2] ?? join(tmpdir(), "verticopolis-cues.wav");
const require = createRequire(join(REPO, "package.json"));
const { chromium } = require("playwright");
const esbuild = require("esbuild");

if (!existsSync(join(REPO, "src/audio/toneVoices.ts"))) {
  console.error("Run this from the repo root (no src/audio/toneVoices.ts here).");
  process.exit(1);
}

/* The harness itself, bundled from memory so this stays one file. */
const ENTRY = `
import * as Tone from "tone";
import { createSfxVoices, playSfx } from "./toneVoices";
import { createPercussion } from "./tonePercussion";
import { midiToFreq } from "./toneScenes";
import { CROWD_SCENES, pseudo } from "./toneCrowdData";

const SR = 44100, RENDER_S = 4, GAP_S = 1.0, TAIL_S = 0.12, FLOOR = 0.0006;
/** ToneAudioEngine's master gain. Render without it and the bloops clip. */
const MASTER = 0.35;
/** CrowdLayer's own master at full activity and full zoom-in detail:
 *  LAYER_LEVEL(0.5) * (0.38 + 0.62*detail) * sqrt(activity), with both at 1. */
const CROWD_MASTER = 0.5;
const CUES = ["build", "click", "sell", "error", "promote", "notify", "money"];

/** Plain-language labels for the element rows, in CROWD_SCENES order. */
const ELEMENT_LABELS = {
  office: ["typist 1", "typist 2", "page turn"],
  condo: ["household ping", "household thud"],
  hotel: ["footsteps", "door close"],
  restaurant: ["cutlery", "set-down", "kitchen swish"],
  fastFood: ["tray / wrapper", "counter ping", "set-down"],
  shop: ["browse rustle"],
  outside: ["bird chirp", "distant car horn"],
};
/** Hits per element sample, and the spacing between them. This is a
 *  PRESENTATION choice, not the real firing rate: a car horn every 20 s makes
 *  an unusable sample. Cluster elements keep their real intra-cluster gap,
 *  which is the whole character of typing. */
const SAMPLE_HITS = 5;
const SAMPLE_GAP_S = 0.7;

function trim(d) {
  let s = 0; while (s < d.length && Math.abs(d[s]) < FLOOR) s++;
  let e = d.length - 1; while (e > s && Math.abs(d[e]) < FLOOR) e--;
  return s >= e ? new Float32Array(0) : d.slice(s, Math.min(d.length, e + Math.round(TAIL_S * SR)));
}

async function renderSfx(name) {
  const buf = await Tone.Offline(() => {
    const master = new Tone.Gain(MASTER).toDestination();
    // sfxBus at a default Effects level of 1, deliberately dry (no reverb send).
    playSfx(createSfxVoices(new Tone.Gain(1).connect(master)), name);
  }, RENDER_S);
  return trim(buf.getChannelData(0));
}

async function renderPerc(which) {
  const buf = await Tone.Offline(() => {
    const master = new Tone.Gain(MASTER).toDestination();
    // Approximate: the real percussion path also passes the shared reverb.
    const perc = createPercussion(new Tone.Gain(1).connect(master), 0.8);
    const midi = which === "thump" ? 42 : 66;
    const voice = which === "thump" ? perc.thump : perc.tap;
    for (let i = 0; i < 3; i++) voice.triggerAttackRelease(midiToFreq(midi), 0.2, i * 0.4, 0.9);
  }, RENDER_S);
  return trim(buf.getChannelData(0));
}

/**
 * One ambient element, mirroring CrowdLayer's private fireElement: same three
 * synths, same volumes, same gain multipliers, same pseudo-hash draws for
 * frequency and gain. What it cannot mirror is the setTimeout firing loop
 * (offline rendering has no timers), so hit times are laid out explicitly.
 */
async function renderElement(scene, index) {
  const el = CROWD_SCENES[scene].elements[index];
  // Cluster elements keep their real gap; everything else gets readable spacing.
  const hits = el.cluster ? el.cluster.max : SAMPLE_HITS;
  const step = el.cluster ? el.rateMin + el.rateVar / 2 : SAMPLE_GAP_S;
  const dur = 0.4 + hits * step + el.dur + 1.2;
  let tick = index * 7919 + scene.length * 104729;

  const buf = await Tone.Offline(() => {
    const master = new Tone.Gain(MASTER).toDestination();
    // CrowdLayer: master -> toneGain(0.8) -> the three element synths. The
    // camera-driven bedFilter is deliberately omitted (it changes level and
    // brightness, never what fires).
    const toneGain = new Tone.Gain(0.8).connect(new Tone.Gain(CROWD_MASTER).connect(master));
    const ping = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 },
    }).connect(toneGain);
    ping.volume.value = -10; ping.maxPolyphony = 8;
    const thud = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.006, decay: 0.09, sustain: 0, release: 0.08 },
    }).connect(toneGain);
    thud.volume.value = -8; thud.maxPolyphony = 8;
    const noiseFilter = new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -48 }).connect(toneGain);
    const noise = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.004, decay: 0.1, sustain: 0 },
    }).connect(noiseFilter);
    noise.volume.value = -16;

    const attack = el.attack ?? 0.004;
    // fireElement sets the envelope per firing; within one element it is
    // constant, so hoisting it out of the loop changes nothing.
    if (el.kind === "burst") {
      noise.set({ envelope: { attack, decay: Math.max(0.05, el.dur - attack), sustain: 0 } });
    } else {
      (el.kind === "ping" ? ping : thud).set({
        envelope: { attack, decay: Math.max(0.06, el.dur - attack), sustain: 0 },
      });
    }

    for (let i = 0; i < hits; i++) {
      const at = 0.2 + i * step;
      const freq = el.freqMin + (el.freqMax - el.freqMin) * pseudo(tick++ * 40503 + 5);
      const gain = el.gainMin + (el.gainMax - el.gainMin) * pseudo(tick++ * 22695477 + 9);
      if (el.kind === "burst") {
        noiseFilter.frequency.rampTo(freq, 0.02, at);
        noise.triggerAttackRelease(el.dur, at + 0.02, gain * 4);
        continue;
      }
      const synth = el.kind === "ping" ? ping : thud;
      synth.triggerAttackRelease(freq, el.dur, at, gain * 3);
      if (el.pair) {
        synth.triggerAttackRelease(freq * el.pair.ratio, el.dur, at + el.pair.delayS, gain * 3 * el.pair.gainScale);
      }
    }
  }, dur);
  return trim(buf.getChannelData(0));
}

function encodeWav(s, rate) {
  const bytes = s.length * 2, ab = new ArrayBuffer(44 + bytes), dv = new DataView(ab);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, bytes, true);
  for (let i = 0; i < s.length; i++) {
    const v = Math.max(-1, Math.min(1, s[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  let bin = ""; const u8 = new Uint8Array(ab);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

const peakOf = (d) => { let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); return p; };
const dbOf = (p) => 20 * Math.log10(p || 1e-9);

globalThis.__renderCues = async () => {
  const parts = [];
  for (const n of CUES) parts.push({ group: "cue", name: "sfx: " + n, data: await renderSfx(n) });
  parts.push({ group: "cue", name: "perc: thump (x3)", data: await renderPerc("thump") });
  parts.push({ group: "cue", name: "perc: tap (x3)", data: await renderPerc("tap") });
  // Ambient elements last, in CROWD_SCENES order.
  for (const scene of Object.keys(CROWD_SCENES)) {
    const els = CROWD_SCENES[scene].elements;
    for (let i = 0; i < els.length; i++) {
      const label = ELEMENT_LABELS[scene]?.[i] ?? "element " + i;
      parts.push({ group: "ambient", name: scene + ": " + label, data: await renderElement(scene, i) });
    }
  }

  // TWO normalization groups, not one. The action cues and the ambient elements
  // are ~50 dB apart at the master (office typing renders around -54 dBFS
  // against the error cue's -1), which is correct in game and useless in a
  // listening sample: one constant across the file leaves the whole ambient
  // half inaudible. Normalizing each group separately keeps the balance WITHIN
  // each group exactly as the engine mixes it, and the per-item dBFS printed
  // below carries the cross-group relationship as a number instead.
  const boosts = {};
  for (const g of ["cue", "ambient"]) {
    const p = Math.max(...parts.filter((x) => x.group === g).map((x) => peakOf(x.data)), 0);
    boosts[g] = p > 0 ? 0.9 / p : 1;
  }

  const gap = Math.round(GAP_S * SR);
  const out = new Float32Array(parts.reduce((n, p) => n + p.data.length, 0) + gap * (parts.length - 1));
  const cues = []; let at = 0;
  parts.forEach((p, i) => {
    cues.push({ name: p.name, startS: at / SR, db: dbOf(peakOf(p.data)), group: p.group });
    const k = boosts[p.group];
    for (let j = 0; j < p.data.length; j++) out[at + j] = p.data[j] * k;
    at += p.data.length;
    if (i < parts.length - 1) at += gap;
  });
  return { wav: encodeWav(out, SR), cues, boosts };
};
`;

const bundle = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: join(REPO, "src/audio"), loader: "ts" },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  absWorkingDir: REPO,
  write: false,
  logLevel: "warning",
});

/** Playwright's expected browser build can trail what is installed; fall back to
 *  any Chromium already in the cache rather than forcing a fresh download. */
function installedChromium() {
  const root = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-")).sort();
  for (const d of dirs.reverse()) {
    for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

let browser;
try {
  browser = await chromium.launch();
} catch {
  const executablePath = installedChromium();
  if (!executablePath) throw new Error("No Chromium found. Run: npx playwright install chromium");
  browser = await chromium.launch({ executablePath });
}

const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[page]", e.message));
await page.setContent("<!doctype html><title>cues</title>");
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const result = await page.evaluate(() => globalThis.__renderCues());
await browser.close();

writeFileSync(resolve(OUT), Buffer.from(result.wav, "base64"));
console.log(resolve(OUT));
console.log(
  `listening boost: cues x${result.boosts.cue.toFixed(2)}, ambient x${result.boosts.ambient.toFixed(1)}` +
    `  (dBFS below is the TRUE level at the master, before that boost)`,
);
for (const c of result.cues) {
  console.log(`  ${c.startS.toFixed(2).padStart(7)}s  ${c.db.toFixed(1).padStart(6)} dBFS  ${c.name}`);
}
```

</details>

To extend it, add to `CUES` (any `SfxName`) or add a `render*` function beside
the three that exist.
