import * as Tone from "tone";

/**
 * The outdoor rain layer: a 600..3000 Hz pink-noise band with a slow gust
 * swell (an LFO breathing the level) so it reads as weather, not flat static.
 * It rides the engine's DRY ambience bus on purpose: rain through the shared
 * reverb smears into hiss. The engine drives only `rainGain` (fade in when
 * the sky is visible and the sim says rain, out otherwise); everything else
 * here is fixed, audition-approved character.
 */

export interface RainVoices {
  /** The level node the engine ramps; 0 = no rain. */
  rainGain: Tone.Gain;
  noise: Tone.Noise;
  bandHp: Tone.Filter;
  /** Caps the band's top end so it reads as rainfall rather than hiss. */
  bandLp: Tone.Filter;
  swell: Tone.Gain;
  lfo: Tone.LFO;
}

/** Build and start the rain bed into the given (dry) ambience bus. The engine
 *  owns the lifecycle and disposes everything returned. On a mid-build throw,
 *  already-connected nodes are disposed before the error escapes. */
export function createRain(dryBus: Tone.ToneAudioNode): RainVoices {
  const built: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(n: T): T => {
    built.push(n);
    return n;
  };
  try {
    const rainGain = track(new Tone.Gain(0).connect(dryBus));
    const swell = track(new Tone.Gain(1).connect(rainGain));
    const lfo = track(new Tone.LFO({ frequency: 0.3, min: 0.7, max: 1 }));
    lfo.connect(swell.gain);
    lfo.start();
    const bandLp = track(
      new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.5 }).connect(swell),
    );
    const bandHp = track(
      new Tone.Filter({ type: "highpass", frequency: 600, Q: 0.5 }).connect(bandLp),
    );
    const noise = track(new Tone.Noise({ type: "pink", playbackRate: 1.3 }).connect(bandHp));
    noise.volume.value = -12;
    noise.start();
    return { rainGain, noise, bandHp, bandLp, swell, lfo };
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
