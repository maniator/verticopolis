# Crowd Din and Venue Ambience - Development Epic

One epic (CD), one PR. Stories are ordered by dependency; all land together.
Review skill: `/gds-code-review` (zoom-reactive audio engine, gameplay-feel
surface). Version bump: minor (player-facing feature).

## Epic CD: The tower you can hear

**Goal:** every viewable area of the tower has its approved ambient identity,
generated live from two tiny voice seeds plus tones, driven by zoom, scene,
occupancy, and the clock; the old synthesized accents are gone.

### Story cd-1: Seeds shipped and licensed

Encode the two approved seeds from the owner's recordings (talk seed: the
crying/laughing-free cut, about 15 s; laugh seed: outtakes A+B, about 2.4 s)
to a Safari-compatible compressed format, mono, combined at most 100 KB.
Serve from the public directory, include in the PWA precache, and record
provenance and terms in ASSETS-LICENSE.md.

Acceptance: files decode via `decodeAudioData` in Chromium and WebKit; budget
held; license entry present.

### Story cd-2: Focus plumbing

Add `hour` (sim clock hour as a float in [0, 24)) and `crowd` (0-1 occupancy of the dominant
kind among viewed floors) to `ViewFocus`, computed at the existing focus
build site, refreshed at most once per second. No sim writes, no sim RNG.

Acceptance: unit test pins the fields' ranges and the 1 Hz refresh; golden
masters byte-identical.

### Story cd-3: Voice machinery

Pure module: calm-mask computation (100 ms windows, ZCR under 1500 Hz, RMS
under 0.32, segment gate at 85 percent), talker phrase scheduling math, whoop
rate ramp. Live module: lazy seed buffer loading with silent tone-only
degradation, talker voices (buffer playback at down-only pitch rates through
the layer's filters), laugh one-shots, whoop synthesis.

Acceptance: pure tests for mask and scheduling determinism-safety (no
`Math.random`; a seeded hash like the music's `pseudo`); graph tests prove
loading failure degrades silently.

### Story cd-4: Scene generators

The murmur scenes (lobby, restaurant, fast food, shop, office, condo, hotel,
outside, metro platform) per the GDD table: per-scene talker counts, pauses,
muffles, one-shot elements with irregular timing, occupancy scaling, clock
gating, zoom response through the existing distance filter.

Acceptance: graph tests assert per-scene element sets, the steep `-48`
rolloff on every noise filter (regression for the static rule), occupancy
scaling to silence, and clock gating (office at 03:00 is silent).

### Story cd-5: Venue music and events

The party remix (124 BPM hook arrangement through the wall, laughs, whoops),
the cinema program (plucks, dialogue, riser-booms), and the metro train event
(da-dum rhythm, dark rumble, doors), each gated per the GDD (attendance or
in-view timers).

Acceptance: graph tests pin the party tempo and hook reuse from
`toneTracks`, the cinema no-sustained-swells rule, and that events stop on
scene exit.

### Story cd-6: Retirement and integration

Remove the accent path (`maybeAccent`, `accentHit`, accent voices, the
`accent` field consumers) and its tests; integrate the layer into
`ToneAudioEngine` update/dispose; wire the volume/mute buses; update the
in-code docs. Quality gates, coverage thresholds, `/gds-code-review`, version
bump and changelog, backlog true-up (#481 row), preview deployment for the
owner's audition.

Acceptance: all gates green; review skill run with findings fixed or
deferred; owner sign-off on the preview.
