import type * as Tone from "tone";
import { LightMonoSynth, LightPolySynth } from "./lightSynth";

/** The composed tracks' pitched voices: the arpeggio, the bass and the melody. */
export interface MusicVoices {
  readonly arp: LightPolySynth;
  readonly bass: LightMonoSynth;
  readonly hook: LightPolySynth;
}

/** Build the track voices, each wired into `musicGain` (the music path's level
 *  stage ahead of its warm filters). Percussion is built apart, in tonePercussion. */
export function createMusicVoices(musicGain: Tone.Gain): MusicVoices {
  // Rolling sine arpeggio (the bed's main texture): a soft pluck.
  const arp = new LightPolySynth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.03, decay: 0.5, sustain: 0.05, release: 0.8 },
  }).connect(musicGain);
  arp.volume.value = -9;
  arp.maxPolyphony = 12; // a runaway arpeggio would stack tails

  // Soft triangle bass root under each bar.
  const bass = new LightMonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.6 },
  }).connect(musicGain);
  bass.volume.value = -8;

  // The melody voice: the owner's hummed tune (splash hook and, since the
  // Two Chapters bed, the in-game lead as well).
  const hook = new LightPolySynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.025, decay: 0.3, sustain: 0.2, release: 0.3 },
  }).connect(musicGain);
  hook.volume.value = -6;
  hook.maxPolyphony = 12;
return { arp, bass, hook };
}
