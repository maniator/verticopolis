import * as Tone from "tone";
import { midiToFreq, type SfxName } from "./toneScenes";

/**
 * The one-shot action jingles (build, sell, promote, and friends) the game
 * fires on demand through the sfx bus. This module once also carried the
 * scene melody and the close-up accent cues; the melody was replaced by the
 * composed tracks (`./toneTracks.ts`) and the accents by the crowd/venue
 * ambience layer (`./toneCrowd.ts`), leaving the jingles as its whole job.
 */

/** Play a one-shot action jingle through the sfx synth. */
export function playSfx(synth: Tone.PolySynth, name: SfxName): void {
  const t = Tone.now();
  const play = (midi: number, dur: Tone.Unit.Time, offset: number, vel = 0.5) =>
    synth.triggerAttackRelease(midiToFreq(midi), dur, t + offset, vel);
  switch (name) {
    case "build":
      play(72, "16n", 0);
      play(79, "16n", 0.07);
      break;
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
      [60, 64, 67, 72, 76].forEach((n, i) => play(n, "8n", i * 0.1, 0.55));
      break;
    case "click":
      play(84, "32n", 0, 0.3);
      break;
  }
}
