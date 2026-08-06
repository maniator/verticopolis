---
title: Crowd Din and Venue Ambience
game_type: simulation
platforms: browser
created: 2026-07-17
updated: 2026-08-06
---

# Verticopolis Crowd Din and Venue Ambience - Game Design Document

**Author:** BMad
**Game Type:** Simulation
**Target Platform(s):** Browser

---

## Executive Summary

### Core Concept

The tower looks alive but does not sound alive. Since v1.60.0 the game has a
composed music bed, but the life underneath it is a generic filtered-noise
"room rush" plus a handful of synthesized close-up accents (elevator dings,
register beeps, keystrokes) that read as random beeping; v1.61.1 quieted them
as a stopgap. This feature replaces that layer with a crowd-and-venue ambience
system generated live in the audio engine from roughly 20 seconds of
owner-recorded voice material: people talking, laughing, and whooping, plus
tone-built venue character (a party band through the wall, a cinema score
behind a door, a train rolling into the metro). What the player hears tracks
what the simulation actually is: which area is on screen, how full it really
is, how far the camera sits, and what time it is.

Every sound in the kit was prototyped as audio files and auditioned by the
owner across nine review rounds before this document was written; the specs
below record the approved results, not proposals.

### Target Audience

Existing Verticopolis players on desktop and mobile browsers, playing
multi-hour building sessions with sound on. The bar, set during the music
work: nothing may fatigue, pierce, or read as static on small phone speakers
or headphones.

### Unique Selling Points (USPs)

- The entire population of the tower speaks with one family's voice: a single
  gibberish recording becomes every crowd, pedestrian, phone call, and TV.
- Ambience is honest: an empty restaurant is near-silent, a packed one
  murmurs, and the party hall plays a dance remix of the game's own theme.
- Two tiny audio assets; everything else is synthesized live, in keeping with
  the game's procedural-audio design.

---

## Goals and Context

### Project Goals

1. Make the tower audibly alive: every viewable area has an approved ambient
   identity driven by real simulation state.
2. Retire the old synthesized accents (`ding`, `register`, `keys`, `clatter`,
   `chatter`, `boom`, `rumble`) that clash with the composed music.
3. Keep the shipped asset budget tiny: two compressed voice seeds, at most
   100 KB combined, the game's first audio files.
4. Hold the line on the audition-derived quality rules (see Art and Audio
   Direction) so no future sound regresses into hiss or beeping.

### Background and Rationale

Tracked as issue #481 (backlog story `crowd-din-ambience`). The owner rejected
two rounds of purely procedural crowd prototypes as static, chose real
recordings over sourcing CC0 samples (session egress policy blocks external
audio sources, and self-recorded material has clean licensing), and supplied
two recordings: footsteps (ultimately cut; overlapped footfall never read as
natural) and a gibberish talk track (which, cut up, pitch-shifted down, and
layered, convincingly became a crowd). All eleven venue sounds were then
approved one by one. This document specifies that approved kit for
implementation in a single PR.

---

## Core Gameplay

### Game Pillars

1. **Honest rooms you can hear.** Loudness and density track live occupancy.
   An empty venue is room tone; a full one is a crowd. No sound implies people
   who are not there (the audio extension of the game's honest-rooms pillar).
2. **Voices and tones, never static.** Human texture comes from the voice
   seeds; character comes from pitched tones. Broadband noise appears only
   where physically motivated (a train, a cart) and always dark.
3. **Felt zoomed out, detailed zoomed in.** Pulled back, ambience is a muffled
   suggestion under the music; pushing in opens the distance filter and
   resolves per-venue detail. The music is never crowded out.
4. **The clock shapes the soundscape.** Offices patter during the workday and
   sleep at night; condos are quiet at midday and lively in the evening; the
   party hall and cinema sound only when events actually run; trains arrive as
   events, not loops.

### Core Gameplay Loop

The player builds, zooms, and inspects as before. The loop this feature
touches is observational: zoom out to plan (calm, muffled tower hum), zoom
into a floor to inspect (that area's ambience resolves), linger (the ambience
stays alive without repeating a fixed loop, because element timing is
generated, not sampled). The reward for building a busy tower is hearing it.

### Win/Loss Conditions

Not applicable (presentation layer). The success condition is behavioral:
players leave sound on for whole sessions.

---

## Game Mechanics

### Primary Mechanics

**The talker model (shared by every voiced element).** A talker plays phrases
cut live from the talk seed: phrase length 0.9 to 1.8 s, trapezoid envelope
with 120 ms ramps, per-talker pitch shift drawn from -1.5 to -6 semitones
(down only; upward shifts read as chipmunks), fixed within a phrase. Segment
choice is gated by a precomputed calm mask over 100 ms windows (zero-crossing
rate below 1500 Hz and RMS below 0.32; a segment needs at least 85 percent
calm windows) so squeals and sibilance are never sampled. Pauses between
phrases are per-scene (dense murmur: 0.3 to 1.7 s; occasional conversation:
1.5 to 5 s).

**Occupancy scaling.** Each scene defines a maximum talker count (and element
rates). The live crowd factor (0 to 1, see Technical Specifications) scales
them: `activeTalkers = round(maxTalkers * crowd)`, floored at one while the
room is live (a sparsely occupied room is a quiet conversation, not silence;
see Progression and Balance and decision row 24), element gaps stretch by
`1 / activity` (with a 0.2 floor), the layer master scales by the square root
of activity as well as zoom (loudness is logarithmic; see decision row 23),
and below 0.05 the layer is silent (room tone only). Both the floor and the
sqrt sit behind that 0.05 activity gate, so a genuinely empty or closed room
is still exactly silent. Two deliberate floors, both the city's own spaces
rather than tower rooms: the street (0.35) and the metro platform (0.3) keep
a small crowd floor because the city has pedestrians and trains no matter
what the tower tracks; no indoor tower scene has a floor.

**Zoom response.** The crowd layer routes through the existing distance
lowpass (`bedFilter`, 650 to 7500 Hz across the detail ramp), so zooming in
opens the muffle naturally. The layer's own gain also scales from 0.38 (fully
out) to 1.0 (fully in) along the same detail value.

**Clock gating.** Scenes with a schedule multiply their activity by an hourly
curve: offices ramp 8:00 to 9:00, full 9:00 to 17:00, ramp out to 19:00,
silent overnight; condos are lively 7:00 to 9:00 (departure bustle), quiet
9:00 to 15:00 (single-presence sounds only), ramp back up 15:00 to 17:00,
lively 17:00 to 21:00, ramp down 21:00 to 23:00, silent 23:00 to 7:00; the
party hall and cinema sound only while their venue has live attendance. (The
metro train event is view-gated, not clock-gated; see the metro scene row.)

**One-shot elements.** Non-voiced details (clinks, thuds, chirps, typing) are
scheduled as randomized one-shots with per-scene rate and gain ranges, never
on a fixed grid, so nothing reads as a loop.

### Controls and Input

One control added during live preview testing: an independent Ambience volume
slider in Settings (Music / Ambience / Effects), because the crowd and voices
rode the music bus, so turning music down to hear the talking silenced the
talking too. The layer otherwise obeys the master mute and the gesture-gated
audio start.

---

## Simulation Specific Design

### Per-scene sound specs (approved kit)

All filter cutoffs below are the steep kind (see Art and Audio Direction).
Gains are relative within the crowd layer; the layer master sits well below
the composed music bed.

| Scene (dominant kind) | Elements and approved parameters |
| --- | --- |
| Lobby | Murmur: up to 6 talkers, pauses 0.3-1.7 s, muffle 850-1000 Hz. |
| Office | Typing: 2 typists, bursts of 4-12 keystrokes (10-15 ms dark ticks, 1400 Hz source cutoff, low gain), key spacing 0.08-0.18 s, thinking pauses 1.2-4.2 s, whole patter muffled 900 Hz and seated far back. One-sided phone call: 1 talker at -3.5 st, pauses 1.6-4.2 s, muffle 850 Hz. Page turns: soft 0.25-0.45 s dark swishes (700 Hz) every 4-8 s. Workday-gated. |
| Residential (condo) | Midday: faint TV (1 talker at -2.5 st, pauses 0.4-1.3 s, heavy 480 Hz muffle, with occasional soft melody notes), sparse domestic one-shots (dish clink 1150-1350 Hz, cupboard thud 95 Hz), a passing vacuum (detuned triangle pair 112/113.5 Hz, 4.5 s swell) at most once per view. Evening: TV plus up to 3 family talkers. Night: silent. |
| Hotel | Hushed hallway: housekeeping cart pass (dark 220 Hz noise swell under soft wheel bumps 64-76 Hz in a roll rhythm) occasionally; a door thud (110 + 70 Hz) rarely; one behind-door conversation (talker at -4 st, 420 Hz muffle, pauses 2.2-5.2 s). Overall level the lowest of any inhabited scene. |
| Food: restaurant | Quiet ambient hum: 3 talkers, pauses 1.5-5 s, muffle 800 Hz, low level. Three one-shot characters on their own irregular cadences so no stretch repeats: a wide-pitch glass tinkle (850-1250 Hz sine ping with a two-note pair, the fundamental capped so the companion note stays in the warm band), a soft low plate set-down (150-210 Hz thud), and an occasional chair scrape (360-420 Hz soft-attack swish). Only the chair scrape uses the scene's single noise voice. Gains at most 0.13 relative. |
| Food: fast food | Busy cousin: 5 talkers, pauses 0.4-1.4 s, muffle 1050 Hz. Varied counter life on distinct cadences: tray clatter in short 2-4 hit clusters (dark bursts at 1300-1800 Hz source cutoff), a two-note register tone at varied pitch (900-1400 Hz pings), and a low counter thud (120-170 Hz). Only the tray clatter uses the scene's single (mono) noise voice; the register and thud are pitched, so the frequent tray hits cannot chop a longer noise texture. |
| Retail (shop) | Browse murmur: 2 talkers, pauses 1.2-3.6 s, muffle 950 Hz; occasional soft rustle (0.3-0.55 s dark swish, 1100 Hz) every 2.2-5 s. |
| Cinema (dominant cinema) | Show-gated. Sparse plucked minor arpeggio (D4/F4/A4/D5 triangles, about 0.7 s decay, staggered, never sustained together); muffled dialogue (1 talker at -5.5 st, 650 Hz muffle); occasional riser (180 to 420 Hz over about 1 s) into a boom (55-60 Hz fundamental plus 110 and 225 Hz partials so small speakers render it). No sustained low swells, ever (they beat into a drone). |
| Cinema (dominant partyHall or weddingHall; weddings are parties) | Event-gated. Upbeat remix of the game's own splash hook at 124 BPM: kick 54-56 Hz each beat, backbeat thud 210 Hz, bouncing root/octave triangle bass, chord stabs, hook melody on top, the whole band muffled about 1150 Hz (through the wall). Up to 2 talkers with long pauses; the owner's real laughs (the laugh seed) roughly twice a minute; voice whoops (a calm seed chunk pitch-bent upward, rate 0.9 to 1.9 accelerating over 0.4-0.55 s) at a similar rate. |
| Metro | Standing platform crowd: 4 talkers, muffle 900 Hz (the shared bed reverb supplies the hall's echo). Train event (fires while in view, roughly once a minute): wheel da-dum pairs (58 + 64 Hz thumps with a 130 Hz partial) rolling in over a swelling dark rumble (140 Hz cutoff), brakes easing (descending 180 Hz), two door thunks (95 and 88 Hz), then da-dums accelerating away (gap 0.7 s shrinking toward 0.32 s) as the rumble recedes. |
| Outside | Noise-free street: city hum (65 Hz swells offset against quieter 98 Hz swells, never beating), sidewalk pedestrians (2 talkers, heavy 520 Hz muffle, pauses 1.6-4.4 s), sparse warm bird chirps (two-note pairs, 1300-1550 Hz, under 0.1 s), a distant car horn (370 + 466 Hz dual tone, about 0.35 s) rarely. Rain remains the existing weather layer, unchanged. |
| Overview / quiet / service | No crowd layer. Music and the existing room-tone bed carry these; the service floors keep their current sound deliberately. |

### Retired sounds

The accent path (`maybeAccent`, `accentHit`, the accent synth/membrane/noise
voices and their bandpass) and its seven cues are removed outright; the scenes
above are their replacement. Action jingles (`build`, `sell`, `money`, and
the rest), the rain layer, and the composed music are untouched.

The room-tone bed keeps its role but was re-filtered (owner playtest,
2026-07-18): the per-scene beds were mid-band bandpasses (e.g. food at 900 Hz)
that read as mid-range static under occupied scenes. They now take the same
no-static treatment as the crowd layer: a steep rolloff -48 over a subsonic
highpass, seated about 2 dB quieter, with every scene's filter moved to a
lowpass at a warm low cutoff (food 720 Hz, most scenes lower). The steepness
and highpass are fixed in the engine; the per-scene cutoff and level still
come from `SCENES[].amb`, so the bed reads as a soft low room rush rather than
mid hiss while keeping each scene's own level (a deeper rumble under the
cinema and metro, a lighter rush elsewhere).


### Human-recorded audio theme (amendment, 2026-08-06)

The owner recorded six sources with their own voice and hands (three hums, a
chest-hit pulse, object taps, a "bloop", and a "ping"); over five audition
rounds these were transcribed, arranged, and approved by ear into the game's
whole musical identity, replacing the agent-composed D-major tracks and the
raw sine jingles. This supersedes the "Human-voiced action jingles" plan of
draft PR #776, carrying its ear-approved bloop and ping recipes forward. The
exact note tables live in `_bmad-output/specs/spec-human-audio-theme/`;
party-ratified engineering refinements are in the party memlog (2026-08-06).

- **Splash, "Terrace + Heartbeat"**: the owner's hummed tune (D dorian, 96
  BPM, 10 bars) as the hook an octave up, over one bass root and a quiet held
  fifth per bar, with their chest-hit pulse as strong/soft eighth-note thumps.
  The old rolling-arpeggio accompaniment is retired everywhere: the owner
  ruled it out as not theirs.
- **In-game bed, "Two Chapters"**: their long wandering hum verbatim (G minor
  territory), then the splash tune slow and in its sung register (D minor),
  one shared 76 BPM pulse end to end, about 101 seconds per loop. Their
  object-tap groove runs on one continuous 16-beat grid, breathing quieter
  near the two seam bars instead of stopping. The first chapter opens on G
  minor so the second chapter's D-minor ending resolves v-i at the loop wrap.
  The bed melody sits 20 percent under the audition mix (it plays beneath
  crowd din and jingles).
- **Milestone fanfare**: `promote` plays the splash tune's peak turn (C5 D5
  B4 A4) struck on the ping bell voice, bells only; the owner auditioned six
  fanfare shapes and vetoed bloops and thumps inside fanfares, and vetoed a
  louder win variant, so star promotions and the tower win share the same
  phrase. The five-note carillon run of the superseded plan is retired.
- **Jingles**: `build` keeps the approved 520-to-180 Hz bloop; `click` is a
  small high bloop; `sell` two falling bloops; `error` a slow sighing double
  bloop with a 0.4 s retrigger holdoff (drag-painting an invalid zone must
  not stack the mono voice's ramps). `notify` keeps its single ping. `money`
  stays on the legacy jingle synth, defined but uncalled.
- **Small-speaker rule** (owner-tested on phone and laptop speakers over two
  audition rounds): no bloop ramp lands below 160 Hz, deep bloops add quiet
  octave and twelfth partials, and the heartbeat thump keeps its body between
  92 and 130 Hz with the same reinforcement. Depth alone is never a cue's
  signal.
- **Percussion routing**: the heartbeat and taps play through two dedicated
  membrane voices feeding the music bus directly, bypassing the music chain's
  2400 Hz lowpass and 90 Hz highpass (which would gut them), while still
  following the music volume slider, the shared reverb, the master mute, and
  the crossfade dip.
- The party venue remix quotes the new tune's first phrase (its loop is 16
  beats; the full tune is 36), so the tower still dances to the game's own
  melody.

Player notes must say the music, rhythm, and sound effects are made from the
owner's own recordings: human-made, not AI-generated.

---

## Progression and Balance

The layer has one balance axis: it must sit under the music. Targets, from
the approved previews: crowd layer master at roughly half the music bed's
perceived level when zoomed fully in, near-inaudible when zoomed fully out;
one-shot elements individually no louder than the murmur they decorate. The
mute switch gates the whole layer; its level rides the dedicated Ambience
slider (its own bus, separate from the music bus), so the player can lower
the music and still hear the crowd, or the reverse.

Two rules keep a lightly-visited venue from collapsing to a bare hum (owner
playtest, 2026-07-18). Loudness scales with the square root of activity
(clock times occupancy), not linearly, because loudness perception is
logarithmic: a linear curve read as near-silent for any half-full room, the
same fallacy the volume sliders correct. And while a room is live at all, at
least one talker plays: `round(maxTalkers * crowd)` alone rounded a sparsely
occupied room to zero voices, muting a real conversation. Honest silence
still holds because both rules sit behind the activity gate, an empty room
(nobody there, or a closed hour) is exactly zero either way. The metro
platform, like the street, is one of the city's own spaces rather than a
tower room, so it carries a small crowd floor and never falls fully silent.

---

## Level Design Framework

Not applicable; the tower itself is the level. Scene resolution reuses the
existing `sceneFor` mapping, with the food and cinema scenes splitting on the
dominant facility kind (restaurant versus fastFood, cinema versus partyHall).

---

## Art and Audio Direction

Two hard rules, both earned through audition failures, both non-negotiable:

1. **Voices and tones over noise.** Human presence comes from the voice
   seeds; musical character from pitched tones. Rejected counterexamples:
   synthesized murmur (read as static), overlapped footfall (read as horses),
   bright bandpassed crowd (read as hiss).
2. **Any noise source is steep-filtered and seated low.** Every noise element
   (train rumble, cart bed, clatter, page turns, rustle) passes through a
   steep filter (Tone.js `Filter` with `rolloff: -48`, cutoffs as specified,
   all at or below 1800 Hz) at low gain. A single gentle pole leaves audible
   hiss; four poles do not. Rejected counterexamples: wind swells, car
   swishes, the air-handler bed (all cut or rebuilt dark).

Corollaries, also from the rounds: voices shift down only; speech is sampled
in long natural phrases, never short swelling chunks; no sustained low tone
clusters (they beat into a lawnmower drone); percussive one-shots get soft
attacks and irregular timing.

---

## Technical Specifications

- **Assets.** Two files, the game's first shipped audio, served from the
  public directory and precached by the PWA: the talk seed (about 15 s of the
  crying/laughing-free gibberish cut, mono, compressed) and the laugh seed
  (outtakes A and B, about 2.4 s). Combined budget: at most 100 KB. Format
  must decode in Chrome, Firefox, and Safari (AAC/M4A or MP3, not Ogg
  Vorbis). Licensing: recorded by the project owner and family for this
  purpose; an ASSETS-LICENSE.md entry records provenance and terms.
- **Loading.** Seeds fetch lazily after the engine's gesture-gated start,
  never blocking boot or the music. Tone-built elements run immediately;
  voiced elements fade in when their buffer arrives; a failed fetch degrades
  to tone-only ambience silently.
- **Focus plumbing.** `ViewFocus` gains two fields: `hour` (sim clock hour as
  a float in [0, 24)) and `crowd` (0-1, live occupancy of the dominant kind's units among
  the floors in view, against their capacity). Computed where focus is built
  today, refreshed at most once per second (the census walk must not run per
  frame).
- **Modules.** New code respects the 500-line file guard: a pure data/math
  module (scene specs, calm mask, note tables, whoop math), a voice module
  (seed buffers, talker scheduling), and the layer class (graph lifecycle,
  scene switching, events). The engine class integrates the layer and slims
  by the removed accent path.
- **Performance.** Same budget discipline as the music: a handful of synth
  voices and one or two buffer sources per scene; scheduling on the Transport
  or short timers; zero allocations in the per-frame update path. The audio
  context runs with the `playback` latency hint (larger buffers; the default
  interactive hint underruns on phones and reads as random crackles), synth
  polyphony is capped, venue programs run only while their venue is live, and
  the ambience scene key must win two consecutive updates before a switch so
  a mixed floor cannot churn programs while panning.
- **Volume.** The player sliders are perceptual: the stored 0..1 is squared
  at the bus, so half slider is audibly half (a linear gain slider reads as
  doing nothing across most of its travel). Three channels, each on its own
  bus: Music (the composed tracks), Ambience (room tone, crowd, venue sounds,
  rain), and Effects (action jingles). The ambience bus split off the music
  bus after live testing showed the two fought each other (lowering music to
  hear the voices lowered the voices too).
- **Determinism.** Ambience shares the music's non-determinism budget: it
  reads sim state but never writes it and draws no simulation RNG. Golden
  masters are untouched by construction.

---

## Development Epics

One epic, delivered as a single PR. Detail in `epics.md`.

| Story | Scope |
| --- | --- |
| cd-1 | Seeds encoded, shipped, licensed, precached |
| cd-2 | Focus plumbing: `hour` and `crowd` on `ViewFocus` |
| cd-3 | Voice machinery: buffers, calm mask, talkers, laughs, whoops |
| cd-4 | Scene generators: murmur scenes and one-shot elements |
| cd-5 | Venue music and events: party remix, cinema, metro train |
| cd-6 | Accent retirement, integration, tests, review |

---

## Success Metrics

- The owner confirms the in-engine result matches the approved preview WAVs
  per scene (the acceptance bar for the PR's preview build).
- Shipped audio assets total at most 100 KB; initial bundle size otherwise
  unchanged (the layer lives in the lazy audio chunk).
- All four quality gates green; per-file coverage thresholds hold; golden
  master hashes unchanged in both modes.
- None of the old complaints applies: nothing beeps, hisses, drones, or
  whistles in any approved scene.

## Out of Scope

- Footsteps in any form (cut by the owner after three rejected rounds).
- A new service-floor sound (existing room tone suffices).
- Wind and other broadband weather beyond the existing rain layer.
- Stereo placement or per-person spatial audio.
- Additional recordings (restaurant/party/cinema real-room beds); the voice
  seeds carry v1.
- Three fine-texture details from the audition prototypes, deferred at review
  triage and tracked in the backlog: the condo vacuum pass and TV melody
  notes, and the hotel cart's dark noise bed (its wheel-bump roll rhythm
  shipped).
- Any simulation-side behavior change whatsoever.

## Assumptions and Dependencies

- [ASSUMPTION] Live attendance (`customersIn`) is readable for the cinema and
  party hall from the focus computation site, as the venue-people-routing
  feature established; if a cheap read is unavailable, v1 gates those scenes
  on the clock alone and the backlog records the refinement.
- The metro has no arrival schedule the audio can read; the train event
  therefore fires on its own timer while the metro is in view (documented as
  presentation, not simulation).
- Seed files are the owner's recordings with all rights held by the project
  owner; no third-party material ships.
