import * as Tone from "tone";

/**
 * The owner's recorded percussion, rebuilt as membrane voices: the chest-hit
 * heartbeat under the splash theme and the object-tap groove under the
 * in-game bed (GDD crowd-din-ambience, "Human-recorded audio theme"
 * amendment). Two voices because one tuning cannot voice both: the thump is a
 * low swept body, the tap a short bright knock.
 *
 * Small-speaker rule (owner-tested): the thump body sweeps about 130 down to
 * 92 Hz and is reinforced with quiet octave and twelfth partials, because a
 * bare sine in that band vanishes on phone speakers. Thump events are
 * authored at midi 42 (~92.5 Hz); the membrane's half-octave sweep starts it
 * near 131 Hz.
 *
 * Routing is the load-bearing part: `percGain` feeds the MUSIC BUS directly,
 * bypassing the music chain's warm lowpass (2400 Hz would dull the tap) and
 * sub highpass (90 Hz would gut the thump). It still sits behind the music
 * volume slider, the shared reverb, and the master mute, and the engine ramps
 * `percGain` with `musicGain` during a program crossfade so the heartbeat
 * never thumps on alone.
 */

/** The thump: a membrane body plus its two quiet reinforcement partials, one
 *  trigger for the engine's Part callback, one dispose for teardown. */
export class ThumpVoice {
  private drum: Tone.MembraneSynth;
  private partials: Tone.PolySynth;

  constructor(dest: Tone.ToneAudioNode) {
    this.drum = new Tone.MembraneSynth({
      pitchDecay: 0.045,
      octaves: 0.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 },
    }).connect(dest);
    this.drum.volume.value = -10;
    try {
      this.partials = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.03 },
      }).connect(dest);
    } catch (err) {
      // The factory's reap list only learns about this voice as a whole, so a
      // second-constructor throw must not strand the already-connected drum.
      this.drum.dispose();
      throw err;
    }
    this.partials.volume.value = -10;
    this.partials.maxPolyphony = 8;
  }

  triggerAttackRelease(freq: number, dur: number, time: number, vel: number): void {
    this.drum.triggerAttackRelease(freq, dur, time, vel);
    this.partials.triggerAttackRelease(freq * 2, dur, time, vel * 0.4);
    this.partials.triggerAttackRelease(freq * 3, dur, time, vel * 0.15);
  }

  dispose(): void {
    this.drum.dispose();
    this.partials.dispose();
  }
}

export interface PercVoices {
  /** Level node into the music bus; the engine ramps it with musicGain. */
  percGain: Tone.Gain;
  /** The chest-hit heartbeat: swept membrane body plus soft partials. */
  thump: ThumpVoice;
  /** The object tap: short bright membrane knock. */
  tap: Tone.MembraneSynth;
}

/** Build the percussion voices on the given music bus at the given level.
 *  ToneAudioEngine owns the lifecycle (it disposes everything returned). If a
 *  constructor throws mid-build, everything already connected is disposed
 *  before the error escapes, so a failed start() cannot strand live nodes on
 *  the bus (the engine's catch never sees these locals). */
export function createPercussion(musicBus: Tone.ToneAudioNode, level: number): PercVoices {
  const built: Array<{ dispose(): void }> = [];
  try {
    const percGain = new Tone.Gain(level).connect(musicBus);
    built.push(percGain);
    const thump = new ThumpVoice(percGain);
    built.push(thump);
    const tap = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 0.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
    }).connect(percGain);
    tap.volume.value = -14;
    return { percGain, thump, tap };
  } catch (err) {
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
