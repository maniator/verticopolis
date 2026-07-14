import * as Tone from "tone";
import { midiToFreq, type Accent, type Scene, type SceneDef, type SfxName } from "./toneScenes";

/**
 * Synthesis routines for the procedural audio engine: given the live Tone.js
 * voices, these play the melody step, the close-up accents, and the one-shot
 * action jingles. They hold no state of their own; {@link ToneAudioEngine} owns
 * the graph and the sequencer counters and calls in with the current values, so
 * the same (step, tick, detail, scene) that drove the old inline methods drives
 * these. Keeping the note choices here keeps the engine class focused on the
 * graph lifecycle and per-frame scene state.
 */

/** The close-up accent voices, resolved non-null by the caller. */
export interface AccentNodes {
  accentSynth: Tone.PolySynth;
  membrane: Tone.MembraneSynth;
  noiseAccent: Tone.NoiseSynth;
  accentFilter: Tone.Filter;
}

/** Deterministic 0..1 hash so the melody varies without Math.random. */
function pseudo(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}

/** Schedule this eighth-note's melody note (plus overview/sparkle doublings). */
export function scheduleStep(
  lead: Tone.PolySynth,
  def: SceneDef,
  scene: Scene,
  step: number,
  tick: number,
  detail: number,
  time: number,
): void {
  // Seeded-but-varied note choice; seed off the free-running tick so the line
  // evolves bar to bar rather than looping a fixed 16-note pattern.
  const r = pseudo(tick * 2654435761);
  if (r > def.density) return;
  // Land on chord tones on strong beats so the melody feels grounded.
  const onBeat = step % 4 === 0;
  let note: number;
  if (onBeat && def.pad.length) {
    const pi = Math.floor(pseudo(tick * 22695477 + 3) * def.pad.length);
    note = def.root + def.pad[pi];
  } else {
    const degree = Math.floor(pseudo(tick * 40503 + 7) * def.scale.length);
    const octave = pseudo(tick * 19349663) > 0.7 ? 12 : 0;
    note = def.root + def.scale[degree] + octave;
  }
  // Soften the harsher timbres so square/saw leads don't fatigue the ear.
  const vel = def.wave === "square" || def.wave === "sawtooth" ? 0.35 : 0.5;
  lead.triggerAttackRelease(midiToFreq(note), "8n", time, vel);
  // Overview doubling, two octaves up and very quiet: the whole zoomed-out
  // mix sits below ~500 Hz, which small phone speakers cannot reproduce, so
  // give them a faint musical partial to render instead of silence.
  if (scene === "overview") {
    lead.triggerAttackRelease(midiToFreq(note + 24), "8n", time + 0.02, 0.18);
  }
  // A high sparkle on off-beats — but only once you've zoomed in enough to
  // "hear the detail", giving close-ups their own extra shimmer.
  if (step % 4 === 2 && def.density > 0.5 && detail > 0.45) {
    lead.triggerAttackRelease(midiToFreq(note + 12), "16n", time + 0.04, 0.18);
  }
}

/** Occasionally fire a scene-specific close-up accent. */
export function maybeAccent(
  nodes: AccentNodes,
  def: SceneDef,
  tick: number,
  detail: number,
  time: number,
): void {
  if (def.accent === "none") return;
  // Fire sparingly (and only well zoomed in) so accents feel like occasional
  // life in the room, not a stream of random noises.
  const g = pseudo(tick * 2246822519 + 101);
  if (g > 0.05 * detail) return;
  accentHit(nodes, def.accent, time);
}

export function accentHit(nodes: AccentNodes, accent: Accent, time: number): void {
  const { accentSynth, membrane, noiseAccent, accentFilter } = nodes;
  switch (accent) {
    case "ding": // elevator arrival chime
      accentSynth.triggerAttackRelease(midiToFreq(84), "4n", time, 0.5);
      accentSynth.triggerAttackRelease(midiToFreq(79), "4n", time + 0.13, 0.4);
      break;
    case "clatter": // dishes / cutlery
      accentFilter.type = "bandpass";
      accentFilter.frequency.value = 2600;
      accentFilter.Q.value = 6;
      noiseAccent.triggerAttackRelease("32n", time, 0.6);
      accentSynth.triggerAttackRelease(midiToFreq(96), "32n", time + 0.02, 0.2);
      break;
    case "keys": // keyboard typing
      accentFilter.type = "highpass";
      accentFilter.frequency.value = 3200;
      accentFilter.Q.value = 0.7;
      noiseAccent.triggerAttackRelease("64n", time, 0.4);
      noiseAccent.triggerAttackRelease("64n", time + 0.09, 0.35);
      break;
    case "rumble": // a train passing through the metro
      membrane.triggerAttackRelease(midiToFreq(41), "2n", time, 0.9);
      break;
    case "boom": // a deep cinema hit
      membrane.triggerAttackRelease(midiToFreq(33), "2n", time, 0.9);
      break;
    case "register": // shop register beep
      accentSynth.triggerAttackRelease(midiToFreq(88), "16n", time, 0.4);
      accentSynth.triggerAttackRelease(midiToFreq(83), "16n", time + 0.08, 0.4);
      break;
    case "chatter": // muffled conversation
      accentFilter.type = "bandpass";
      accentFilter.frequency.value = 700;
      accentFilter.Q.value = 2;
      noiseAccent.triggerAttackRelease("8n", time, 0.3);
      break;
  }
}

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
