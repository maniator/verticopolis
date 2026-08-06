import * as Tone from "tone";
import { midiToFreq, type SfxName } from "./toneScenes";

/**
 * The one-shot action jingles (build, sell, promote, and friends) the game
 * fires on demand through the sfx bus. This module once also carried the
 * scene melody and the close-up accent cues; the melody was replaced by the
 * composed tracks (`./toneTracks.ts`) and the accents by the crowd/venue
 * ambience layer (`./toneCrowd.ts`), leaving the jingles as its whole job.
 *
 * Two cues are human-voiced: the owner recorded a "bloop" and a "ping" with
 * their own voice, and the synth recipes here are ear-approved recreations
 * (GDD crowd-din-ambience, "Human-voiced action jingles" amendment). The
 * bloop is the build confirm; the ping bell carries the notify cue and the
 * promote carillon. `sell`/`error`/`click` stay on the plain jingle synth
 * until the recorded main theme lands and the family is re-voiced together.
 */

/** The instrument set `playSfx` plays through. All owned by ToneAudioEngine
 *  and connected to the sfx bus, so every cue follows the Effects slider. */
export interface SfxVoices {
  /** Short percussive sine synth: the legacy jingles (sell, error, money, click). */
  jingle: Tone.PolySynth;
  /** Mono sine with a schedulable frequency glide: the bloop needs a ramp. */
  bloop: Tone.Synth;
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
  const jingle = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.12 },
  }).connect(bus);
  jingle.maxPolyphony = 12;
  // The bloop is a mono voice because its swoop is a scheduled frequency ramp.
  const bloop = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.008, decay: 0.2, sustain: 0, release: 0.08 },
  }).connect(bus);
  const bell = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.4 },
  }).connect(bus);
  bell.maxPolyphony = 12;
  const bellPartial = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.2 },
  }).connect(bus);
  bellPartial.maxPolyphony = 12;
  return { jingle, bloop, bell, bellPartial };
}

/** One bell strike: the fundamental plus a partial 19 semitones up (just shy
 *  of the 3rd harmonic; the slight inharmonicity is what reads as "bell") at
 *  about -16 dB relative to the strike. */
function strikeBell(voices: SfxVoices, midi: number, t: number, vel: number): void {
  voices.bell.triggerAttackRelease(midiToFreq(midi), 1.1, t, vel);
  voices.bellPartial.triggerAttackRelease(midiToFreq(midi + 19), 0.5, t, vel * 0.16);
}

/** Play a one-shot action jingle through the sfx voices. */
export function playSfx(voices: SfxVoices, name: SfxName): void {
  const t = Tone.now();
  const play = (midi: number, dur: Tone.Unit.Time, offset: number, vel = 0.5) =>
    voices.jingle.triggerAttackRelease(midiToFreq(midi), dur, t + offset, vel);
  switch (name) {
    case "build": {
      // The bloop: one smooth swoop from 520 Hz down to 180 Hz, the piece
      // landing where it belongs. The ramp must be scheduled AFTER the trigger
      // so it overrides the setValueAtTime the trigger itself schedules.
      voices.bloop.triggerAttackRelease(520, 0.2, t, 0.9);
      voices.bloop.frequency.cancelScheduledValues(t);
      voices.bloop.frequency.setValueAtTime(520, t);
      voices.bloop.frequency.exponentialRampToValueAtTime(180, t + 0.16);
      break;
    }
    case "sell":
      play(67, "16n", 0);
      play(60, "16n", 0.08);
      break;
    case "error":
      play(48, "8n", 0, 0.6);
      break;
    case "money":
      [76, 80, 83, 88].forEach((n, i) => play(n, "16n", i * 0.06, 0.45));
      break;
    case "promote":
      // The same five-note fanfare as always, struck on the ping's bell voice:
      // a small carillon, so the moment keeps its size in the human timbre.
      [60, 64, 67, 72, 76].forEach((n, i) => strikeBell(voices, n, t + i * 0.1, 0.55));
      break;
    case "notify":
      // A single ping on G4: the onboarding step chime and other small nudges.
      strikeBell(voices, 67, t, 0.7);
      break;
    case "click":
      play(84, "32n", 0, 0.3);
      break;
  }
}
