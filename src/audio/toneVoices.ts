import * as Tone from "tone";
import { midiToFreq, type SfxName } from "./toneScenes";

/**
 * The one-shot action jingles (build, sell, promote, and friends) the game
 * fires on demand through the sfx bus. This module once also carried the
 * scene melody and the close-up accent cues; the melody was replaced by the
 * composed tracks (`./toneTracks.ts`) and the accents by the crowd/venue
 * ambience layer (`./toneCrowd.ts`), leaving the jingles as its whole job.
 *
 * Every cue is human-voiced: the owner recorded a "bloop" and a "ping" with
 * their own voice, and the synth recipes here are ear-approved recreations
 * (GDD crowd-din-ambience, "Human-recorded audio theme" amendment). The bloop
 * family carries build, click, sell, and error; the ping bell carries notify
 * and the promote phrase, which quotes the splash theme's peak turn so the
 * milestones ring the same tune the start screen sings. `money` keeps the
 * legacy jingle recipe, defined but uncalled.
 *
 * Audibility rule (owner-tested on phone and laptop speakers): no bloop ramps
 * below 160 Hz, and the deep cues add quiet octave/twelfth partials so small
 * speakers reconstruct the low pitch. The error cue reads by its slow
 * double-bloop gesture, never by depth alone.
 */

/** The instrument set `playSfx` plays through. All owned by ToneAudioEngine
 *  and connected to the sfx bus, so every cue follows the Effects slider. */
export interface SfxVoices {
  /** Short percussive sine synth: the legacy money jingle. */
  jingle: Tone.PolySynth;
  /** Mono sine with a schedulable frequency glide: every bloop is a ramp. */
  bloop: Tone.Synth;
  /** Second mono glide voice: the trailing bloop of a two-bloop gesture
   *  (sell, error) lives here so a gesture's own second swoop can never
   *  cancel its first's ramp, and a build or click can never cancel a
   *  pending second swoop. Two OVERLAPPING two-bloop gestures can still
   *  collide here; error-into-error is holdoff-guarded, and the remaining
   *  window (a sell inside an error's 0.28 s gap) is accepted as rare and
   *  brief rather than guarded. */
  bloop2: Tone.Synth;
  /** Quiet partials over the deeper bloops (octave + twelfth), poly so a
   *  double bloop's partials can overlap. */
  bloopPartial: Tone.PolySynth;
  /** Bell fundamentals: long natural decay, no sustain. */
  bell: Tone.PolySynth;
  /** Bell color: one quiet inharmonic partial per strike, shorter decay. */
  bellPartial: Tone.PolySynth;
}

/** Build the full jingle instrument set on the given bus, deliberately dry:
 *  a reverb send here would escape the Effects slider. The recipes live in
 *  this module beside the cues that play them; ToneAudioEngine owns the
 *  lifecycle (it disposes every synth returned here). */
export function createSfxVoices(bus: Tone.ToneAudioNode): SfxVoices {
  const built: Array<{ dispose(): void }> = [];
  try {
    return buildSfxVoices(bus, built);
  } catch (err) {
    // A mid-build throw would strand already-connected synths on the live bus
    // (the engine's catch never sees these locals): reap them here.
    for (const n of built) {
      try {
        n.dispose();
      } catch {
        /* already gone */
      }
    }
    throw err;
  }
}

function buildSfxVoices(bus: Tone.ToneAudioNode, built: Array<{ dispose(): void }>): SfxVoices {
  const track = <T extends { dispose(): void }>(n: T): T => {
    built.push(n);
    return n;
  };
  const jingle = track(new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.12 },
  }).connect(bus));
  jingle.maxPolyphony = 12;
  // The bloop is a mono voice because its swoop is a scheduled frequency ramp.
  const bloop = track(new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.008, decay: 0.2, sustain: 0, release: 0.08 },
  }).connect(bus));
  const bloop2 = track(new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.008, decay: 0.2, sustain: 0, release: 0.08 },
  }).connect(bus));
  const bloopPartial = track(new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.008, decay: 0.18, sustain: 0, release: 0.06 },
  }).connect(bus));
  bloopPartial.maxPolyphony = 8;
  const bell = track(new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.4 },
  }).connect(bus));
  bell.maxPolyphony = 12;
  const bellPartial = track(new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.2 },
  }).connect(bus));
  bellPartial.maxPolyphony = 12;
  return { jingle, bloop, bloop2, bloopPartial, bell, bellPartial };
}

/** One bell strike: the fundamental plus a partial 19 semitones up (just shy
 *  of the 3rd harmonic; the slight inharmonicity is what reads as "bell") at
 *  about -16 dB relative to the strike. */
function strikeBell(voices: SfxVoices, midi: number, t: number, vel: number): void {
  voices.bell.triggerAttackRelease(midiToFreq(midi), 1.1, t, vel);
  voices.bellPartial.triggerAttackRelease(midiToFreq(midi + 19), 0.5, t, vel * 0.16);
}

/** One bloop: a smooth exponential swoop from `f0` down to `f1` Hz on the
 *  given mono glide voice. The ramp must be scheduled AFTER the trigger so it
 *  overrides the setValueAtTime the trigger itself schedules. `f1` never goes
 *  below 160 Hz, and every bloop carries its quiet octave and twelfth
 *  partials (small-speaker rules, owner-tested). */
function swoopBloop(
  voice: Tone.Synth,
  voices: SfxVoices,
  f0: number,
  f1: number,
  ramp: number,
  t: number,
  vel: number,
  decay = 0.2,
): void {
  const floor = Math.max(f1, 160);
  // Per-cue envelope: the click is a short blip (0.09 s), the error a slow
  // sigh (0.3 s). Setting the mono voice's decay is immediate, so both bloops
  // of one gesture share the cue's value.
  voice.envelope.decay = decay;
  voice.triggerAttackRelease(f0, ramp + 0.06, t, vel);
  // Cancel strictly at this swoop's start. A caller scheduling two swoops on
  // ONE voice must keep the gap wider than the first ramp: Web Audio cancels
  // events at times >= the cancel point, so a gap equal to the ramp length
  // deletes the first swoop's ramp end and it plays flat (two-bloop gestures
  // therefore put their second swoop on `bloop2`).
  voice.frequency.cancelScheduledValues(t);
  voice.frequency.setValueAtTime(f0, t);
  voice.frequency.exponentialRampToValueAtTime(floor, t + ramp);
  // Every bloop carries its quiet octave and twelfth partials (the approved
  // previews baked them into the waveform itself), so the gesture keeps its
  // color on small speakers at any landing pitch.
  voices.bloopPartial.triggerAttackRelease(floor * 2, ramp + 0.05, t, vel * 0.32);
  voices.bloopPartial.triggerAttackRelease(floor * 3, ramp + 0.04, t, vel * 0.14);
}

/** The promote phrase: the splash theme's peak turn (C5 D5 B4 A4) struck as
 *  bells. [midi, offsetSeconds, vel]; shared by star promotions and the win. */
const PROMOTE_BELLS: ReadonlyArray<readonly [number, number, number]> = [
  [72, 0, 0.45],
  [74, 0.2, 0.5],
  [71, 0.52, 0.55],
  [69, 1.0, 0.4],
];

/** The error double bloop spans ~0.6 s across its two voices; retriggering
 *  mid-gesture would stack cancel-and-ramp schedules into an audible pop, so
 *  repeats inside the WHOLE gesture are dropped (drag-painting an invalid
 *  zone fires error every frame). Seconds, on the Tone clock. */
const ERROR_HOLDOFF = 0.65;
let lastErrorAt = -Infinity;

/** Exposed for tests: reset the error holdoff clock. */
export function resetSfxHoldoff(): void {
  lastErrorAt = -Infinity;
}

/** Play a one-shot action jingle through the sfx voices. */
export function playSfx(voices: SfxVoices, name: SfxName): void {
  const t = Tone.now();
  const play = (midi: number, dur: Tone.Unit.Time, offset: number, vel = 0.5) =>
    voices.jingle.triggerAttackRelease(midiToFreq(midi), dur, t + offset, vel);
  switch (name) {
    case "build":
      // The bloop: one smooth swoop from 520 Hz down to 180 Hz, the piece
      // landing where it belongs.
      swoopBloop(voices.bloop, voices, 520, 180, 0.16, t, 0.9);
      break;
    case "click":
      // A tiny high bloop: the same gesture, small and quick.
      swoopBloop(voices.bloop, voices, 700, 380, 0.1, t, 0.5, 0.09);
      break;
    case "sell":
      // Two falling bloops: the piece leaves in two steps.
      swoopBloop(voices.bloop, voices, 420, 200, 0.12, t, 0.8);
      swoopBloop(voices.bloop2, voices, 320, 160, 0.12, t + 0.12, 0.8);
      break;
    case "error": {
      // A slow, sighing double bloop. Guarded: see ERROR_HOLDOFF. A restarted
      // audio context rewinds the Tone clock; a stored timestamp from the old
      // clock would then gag the cue for minutes, so a stamp in the future
      // means the clock restarted and the holdoff resets.
      if (t < lastErrorAt) lastErrorAt = -Infinity;
      if (t - lastErrorAt < ERROR_HOLDOFF) return;
      lastErrorAt = t;
      swoopBloop(voices.bloop, voices, 440, 170, 0.24, t, 1, 0.3);
      swoopBloop(voices.bloop2, voices, 340, 160, 0.24, t + 0.28, 1, 0.3);
      break;
    }
    case "money":
      play(76, "16n", 0, 0.45);
      play(80, "16n", 0.06, 0.45);
      play(83, "16n", 0.12, 0.45);
      play(88, "16n", 0.18, 0.45);
      break;
    case "promote":
      // The splash theme's peak turn on the ping bell: the tower sings its
      // own tune back at every star promotion and the win.
      for (const [midi, offset, vel] of PROMOTE_BELLS) strikeBell(voices, midi, t + offset, vel);
      break;
    case "notify":
      // A single ping on G4: the onboarding step chime and other small nudges.
      strikeBell(voices, 67, t, 0.7);
      break;
  }
}
