import * as Tone from "tone";

/**
 * The owner's recorded percussion, rebuilt as membrane voices: the chest-hit
 * heartbeat under the splash theme and the object-tap groove under the
 * in-game bed (GDD crowd-din-ambience, "Human-recorded audio theme"
 * amendment). Two synths because one tuning cannot voice both: the thump
 * needs a low swept body (about 130 down to 92 Hz), the tap a short bright
 * knock.
 *
 * Routing is the load-bearing part: `percGain` feeds the MUSIC BUS directly,
 * bypassing the music chain's warm lowpass (2400 Hz would dull the tap) and
 * sub highpass (90 Hz would gut the thump). It still sits behind the music
 * volume slider, the shared reverb, and the master mute, and the engine ramps
 * `percGain` with `musicGain` during a program crossfade so the heartbeat
 * never thumps on alone.
 */

export interface PercVoices {
  /** Level node into the music bus; the engine ramps it with musicGain. */
  percGain: Tone.Gain;
  /** The chest-hit heartbeat: low membrane, swept body with soft partials. */
  thump: Tone.MembraneSynth;
  /** The object tap: short bright membrane knock. */
  tap: Tone.MembraneSynth;
}

/** Build the percussion voices on the given music bus at the given level.
 *  ToneAudioEngine owns the lifecycle (it disposes everything returned). */
export function createPercussion(musicBus: Tone.ToneAudioNode, level: number): PercVoices {
  const percGain = new Tone.Gain(level).connect(musicBus);
  const thump = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 1.6,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 },
  }).connect(percGain);
  thump.volume.value = -10;
  const tap = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 0.5,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
  }).connect(percGain);
  tap.volume.value = -14;
  return { percGain, thump, tap };
}
