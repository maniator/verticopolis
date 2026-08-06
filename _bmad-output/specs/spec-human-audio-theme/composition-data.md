# Composition data

The audition-approved note data for every piece, distilled from the owner's
recordings. Times are beats unless marked. This file is the authority the
implementation transcribes into `toneTracks.ts` / `toneVoices.ts`; the rendered
previews the owner approved were generated from exactly these tables.

## Splash: "Terrace + Heartbeat" (S1)

96 BPM, D dorian, 10-bar loop (25.0 s). Voices: hook (melody, octave up),
bass (root per bar), pad (root+19 st, quiet fifth, vel 0.18), perc (heartbeat).

Chords, one per bar: Dm C G F Dm C Am F Dm DmL (DmL = Dm with the bass an octave lower).

Hook melody (bar, beat, durBeats, note, vel), played +12 st. Playback lifts
each recorded velocity by +0.25 (capped 0.85), exactly as the approved
previews did:

| bar | beat | dur | note | vel |
|----:|-----:|----:|:-----|----:|
| 1 | 0.0 | 1.0 | D4 | 0.45 |
| 1 | 1.0 | 0.5 | E4 | 0.4 |
| 1 | 1.5 | 0.5 | D4 | 0.4 |
| 1 | 2.0 | 0.5 | E4 | 0.45 |
| 1 | 2.5 | 1.0 | F4 | 0.5 |
| 1 | 3.5 | 1.5 | G4 | 0.55 |
| 2 | 1.0 | 0.5 | G4 | 0.5 |
| 2 | 1.5 | 1.0 | F4 | 0.5 |
| 2 | 2.5 | 0.5 | E4 | 0.4 |
| 2 | 3.0 | 1.0 | D4 | 0.45 |
| 3 | 1.0 | 0.5 | B4 | 0.5 |
| 3 | 1.5 | 2.5 | A4 | 0.5 |
| 4 | 0.0 | 0.5 | C5 | 0.65 |
| 4 | 0.5 | 0.5 | D5 | 0.6 |
| 4 | 1.0 | 2.0 | B4 | 0.6 |
| 4 | 3.0 | 1.5 | A4 | 0.45 |
| 5 | 2.0 | 0.5 | C4 | 0.35 |
| 5 | 2.5 | 1.5 | D4 | 0.45 |
| 6 | 0.0 | 0.5 | E4 | 0.45 |
| 6 | 0.5 | 1.5 | F4 | 0.5 |
| 6 | 2.0 | 1.0 | G4 | 0.5 |
| 6 | 3.0 | 1.0 | F4 | 0.45 |
| 7 | 1.0 | 0.5 | A4 | 0.5 |
| 7 | 1.5 | 1.5 | A4 | 0.5 |
| 7 | 3.0 | 1.0 | B4 | 0.55 |
| 8 | 0.0 | 2.0 | C5 | 0.65 |
| 8 | 2.0 | 0.5 | B4 | 0.55 |
| 8 | 2.5 | 1.0 | A4 | 0.45 |
| 9 | 0.0 | 1.0 | F4 | 0.5 |
| 9 | 1.0 | 0.5 | E4 | 0.4 |
| 9 | 1.5 | 0.5 | D4 | 0.45 |
| 9 | 2.0 | 2.0 | D4 | 0.4 |

Heartbeat: perc thump every eighth note for the whole loop, velocity 1.0 on the
beat, 0.55 off the beat, level 0.32 relative to the music bed.

## Bed: "Two Chapters"

One shared pulse: 76 BPM throughout. Loop 101.1 s. No arpeggio events.
Chapter one: the New_humm hum verbatim (dedup-quantized, low register as sung)
over per-bar roots from {Gm, Eb, Bb, Cm, F, Dm}, first bar forced to Gm.
Seam one: one bar, F root, hook C3 (2 beats) then D3 (1 beat).
Chapter two: the Hummm tune as sung (low register) over roots from
{Dm, C, G, F, Am}.
Seam two: half-bar F root then half-bar Bb root, hook C3 then D3 rising into
the wrap. Wrap resolves Dm into Gm (v-i).
Support per bar in both chapters: bass root vel 0.5 + quiet fifth (root+19,
vel 0.16). Melody vel = (recorded vel + 0.12, capped 0.7) x 0.8: the trim is
the party refinement that seats the in-game melody under crowd din (the
audition previews were heard in isolation).


Chapter one melody (New_humm, dedup-quantized): (beat, durBeats, note, vel)

| beat | dur | note | vel |
|-----:|----:|:-----|----:|
| 0.0 | 1.0 | D#3 | 0.33 |
| 1.0 | 1.5 | G3 | 0.34 |
| 2.5 | 1.0 | A#3 | 0.4 |
| 3.5 | 1.0 | D3 | 0.23 |
| 4.5 | 0.5 | D#3 | 0.17 |
| 5.0 | 0.5 | F3 | 0.18 |
| 5.5 | 0.5 | C4 | 0.33 |
| 6.0 | 0.5 | C4 | 0.47 |
| 7.0 | 2.0 | G3 | 0.2 |
| 9.0 | 1.0 | G3 | 0.23 |
| 10.0 | 0.5 | A#3 | 0.13 |
| 12.0 | 0.5 | C4 | 0.31 |
| 12.5 | 0.5 | G#3 | 0.21 |
| 13.0 | 0.5 | F3 | 0.2 |
| 13.5 | 0.5 | G#3 | 0.28 |
| 14.0 | 0.5 | G#3 | 0.26 |
| 14.5 | 0.5 | D3 | 0.23 |
| 15.0 | 1.0 | G3 | 0.22 |
| 16.0 | 0.5 | D3 | 0.18 |
| 16.5 | 0.5 | F3 | 0.2 |
| 17.0 | 0.5 | F3 | 0.14 |
| 17.5 | 0.5 | D3 | 0.19 |
| 18.0 | 0.5 | G#3 | 0.25 |
| 18.5 | 0.5 | C4 | 0.29 |
| 19.0 | 0.5 | A#3 | 0.21 |
| 19.5 | 1.0 | A#3 | 0.27 |
| 20.5 | 0.5 | G3 | 0.16 |
| 21.0 | 0.5 | G3 | 0.18 |
| 21.5 | 0.5 | G3 | 0.1 |
| 23.0 | 0.5 | C4 | 0.39 |
| 23.5 | 1.0 | C4 | 0.36 |
| 24.5 | 0.5 | G3 | 0.21 |
| 25.0 | 0.5 | G3 | 0.2 |
| 25.5 | 0.5 | G3 | 0.16 |
| 26.0 | 0.5 | D3 | 0.17 |
| 26.5 | 0.5 | D3 | 0.17 |
| 27.0 | 0.5 | D3 | 0.16 |
| 27.5 | 0.5 | F3 | 0.17 |
| 28.0 | 0.5 | G3 | 0.15 |
| 28.5 | 0.5 | C4 | 0.34 |
| 29.5 | 1.0 | D#4 | 0.51 |
| 30.5 | 0.5 | D4 | 0.56 |
| 31.0 | 0.5 | C4 | 0.57 |
| 31.5 | 0.5 | A#3 | 0.36 |
| 32.0 | 1.0 | G#3 | 0.2 |
| 33.0 | 0.5 | G3 | 0.28 |
| 35.0 | 0.5 | A#3 | 0.9 |
| 35.5 | 0.5 | A#3 | 0.57 |
| 36.0 | 0.5 | G3 | 0.35 |
| 36.5 | 0.5 | A#3 | 0.34 |
| 37.0 | 0.5 | A#3 | 0.35 |
| 37.5 | 0.5 | D4 | 0.45 |
| 38.5 | 0.5 | C4 | 0.39 |
| 39.0 | 1.0 | A#3 | 0.48 |
| 40.0 | 0.5 | G3 | 0.3 |
| 42.0 | 0.5 | G3 | 0.31 |
| 42.5 | 0.5 | G#3 | 0.33 |
| 43.0 | 0.5 | F3 | 0.28 |
| 43.5 | 0.5 | G3 | 0.22 |
| 44.0 | 0.5 | C4 | 0.32 |
| 44.5 | 0.5 | A#3 | 0.36 |
| 45.0 | 0.5 | G3 | 0.3 |
| 45.5 | 0.5 | G3 | 0.29 |
| 46.0 | 0.5 | G3 | 0.26 |
| 46.5 | 0.5 | G3 | 0.2 |
| 47.0 | 0.5 | D#3 | 0.14 |
| 49.0 | 0.5 | C3 | 0.25 |
| 50.0 | 0.5 | D4 | 0.29 |
| 50.5 | 0.5 | C4 | 0.24 |
| 52.0 | 0.5 | D3 | 0.17 |
| 52.5 | 0.5 | F3 | 0.17 |
| 53.0 | 0.5 | D3 | 0.16 |
| 53.5 | 0.5 | A#3 | 0.24 |
| 54.0 | 0.5 | C4 | 0.18 |
| 55.5 | 0.5 | D4 | 0.4 |
| 56.0 | 0.5 | C4 | 0.3 |
| 56.5 | 0.5 | A#3 | 0.2 |
| 57.0 | 0.5 | G3 | 0.18 |
| 57.5 | 0.5 | G3 | 0.18 |
| 58.0 | 0.5 | G3 | 0.12 |
| 58.5 | 0.5 | G3 | 0.13 |
| 59.0 | 0.5 | F3 | 0.07 |
| 59.5 | 1.0 | D#4 | 0.19 |
| 61.0 | 0.5 | C3 | 0.12 |
| 61.5 | 0.5 | F3 | 0.14 |
| 62.0 | 0.5 | F3 | 0.11 |
| 62.5 | 0.5 | C4 | 0.21 |
| 63.0 | 0.5 | A#3 | 0.18 |
| 64.5 | 1.0 | D#3 | 0.14 |
| 66.0 | 0.5 | C4 | 0.15 |
| 66.5 | 0.5 | A#3 | 0.1 |
| 68.0 | 0.5 | A#3 | 0.15 |
| 68.5 | 0.5 | C4 | 0.21 |
| 69.0 | 0.5 | D4 | 0.23 |
| 69.5 | 0.5 | D#4 | 0.17 |
| 71.0 | 0.5 | D#3 | 0.19 |
| 72.0 | 0.5 | G3 | 0.15 |
| 72.5 | 0.5 | G#3 | 0.1 |
| 74.0 | 0.5 | C4 | 0.36 |
| 74.5 | 0.5 | C4 | 0.1 |
| 75.5 | 0.5 | G#3 | 0.17 |
| 76.0 | 0.5 | G3 | 0.16 |
| 76.5 | 0.5 | D3 | 0.14 |
| 77.0 | 0.5 | C3 | 0.14 |
| 77.5 | 0.5 | C3 | 0.12 |

Chapter two melody (Hummm, dedup-quantized): (beat, durBeats, note, vel)

| beat | dur | note | vel |
|-----:|----:|:-----|----:|
| 0.0 | 1.0 | D3 | 0.22 |
| 1.0 | 0.5 | E3 | 0.23 |
| 1.5 | 0.5 | D3 | 0.29 |
| 2.0 | 0.5 | E3 | 0.38 |
| 2.5 | 1.0 | F3 | 0.34 |
| 3.5 | 0.5 | G3 | 0.4 |
| 5.0 | 0.5 | G3 | 0.45 |
| 5.5 | 1.0 | F3 | 0.4 |
| 6.5 | 0.5 | E3 | 0.27 |
| 7.0 | 0.5 | D3 | 0.31 |
| 9.0 | 0.5 | B3 | 0.46 |
| 9.5 | 2.5 | A3 | 0.35 |
| 12.0 | 0.5 | C4 | 0.75 |
| 12.5 | 0.5 | D4 | 0.49 |
| 13.0 | 2.0 | B3 | 0.56 |
| 15.0 | 2.0 | A3 | 0.26 |
| 18.0 | 0.5 | D3 | 0.25 |
| 18.5 | 0.5 | C3 | 0.33 |
| 20.0 | 0.5 | E3 | 0.32 |
| 20.5 | 1.5 | F3 | 0.4 |
| 22.0 | 1.0 | G3 | 0.34 |
| 23.0 | 1.0 | F3 | 0.27 |
| 25.0 | 0.5 | A3 | 0.37 |
| 25.5 | 1.5 | A3 | 0.37 |
| 27.0 | 1.0 | B3 | 0.49 |
| 28.0 | 2.0 | C4 | 0.57 |
| 30.0 | 0.5 | B3 | 0.51 |
| 30.5 | 1.0 | A3 | 0.26 |
| 32.0 | 0.5 | E3 | 0.41 |
| 33.0 | 0.5 | D3 | 0.44 |
| 34.0 | 2.5 | D3 | 0.21 |

Tap groove (from the object taps at the end of New_humm), a 16-beat cycle
repeated for the whole loop on one continuous grid; positions in beats with
relative velocity:

| pos | vel |
|----:|----:|
| 0.0 | 0.5 |
| 1.0 | 0.3 |
| 1.5 | 0.35 |
| 4.0 | 0.45 |
| 4.5 | 0.4 |
| 6.5 | 0.3 |
| 9.0 | 0.6 |
| 9.5 | 0.3 |
| 10.5 | 0.4 |
| 12.0 | 0.45 |
| 12.5 | 0.4 |
| 14.0 | 0.3 |
| 15.5 | 0.25 |

Tap level: 0.4 under chapter one, 0.3 under chapter two; within two bars of
any seam (the loop wrap included, measured circularly) the level ramps down
to 30% of base and back. No hard stops anywhere.

## Fanfare: "Terrace Peak", bells only (F4)

The splash song's peak turn on the ping bell voice. No bloop, no thump.

| time (s) | note | vel |
|---------:|:-----|----:|
| 0.00 | C5 | 0.45 |
| 0.20 | D5 | 0.50 |
| 0.52 | B4 | 0.55 |
| 1.00 | A4 | 0.40 |

Bell voice = PR #776 recipe: sine fundamental (attack 0.002, decay 1.1,
sustain 0, release 0.4) + one partial +19 st (decay 0.5) at 0.16 gain.

## SFX family

Carried from PR #776 unchanged: build bloop (sine swoop 520 to 180 Hz over
0.16 s, envelope attack 0.008 / decay 0.2 / sustain 0), notify (bell G4),
promote carillon retired in favor of the F4 fanfare above.

New in this package (family extensions PR #776 deferred):

| cue | recipe |
|:----|:-------|
| click | bloop swoop 700 to 380 Hz, ramp 0.10 s, envelope decay 0.09, vel 0.5 |
| sell | two falling bloops: 420 to 200 Hz then 320 to 160 Hz, 0.12 s apart, second on its own voice |
| error | slow double bloop: 440 to 170 Hz (ramp 0.24 s) then 340 to 160 Hz at +0.28 s, envelope decay 0.3, second on its own voice, 0.65 s retrigger holdoff |

Audibility rules (owner-tested on phone/laptop speakers, two audition rounds):
every bloop (the click included) floors at 160 Hz minimum and carries quiet
octave and twelfth partials, triggered at 0.32 and 0.14 of the swoop's
velocity (the perceptual equivalent of the preview waveform's normalized
0.6/0.28 harmonic mix). The chest thump is authored at midi 42 (~92.5 Hz);
its membrane sweeps a half octave (~131 down to 92 Hz, decay ~0.16 s) with
partials at 0.4/0.15 of the hit, the membrane attack supplying the click.
