import * as Tone from "tone";

/** The room-tone bed's chain, source to level: noise, lowpass, highpass, gain. */
export interface RoomTone {
  readonly ambNoise: Tone.Noise;
  readonly ambFilter: Tone.Filter;
  readonly ambTone: Tone.Filter;
  readonly ambGain: Tone.Gain;
}

/** Build the ambient room-tone bed into `bedFilter` (the distance lowpass) and
 *  start its noise. Its level starts at 0; the engine's scene and zoom set it. */
export function createRoomTone(bedFilter: Tone.Filter): RoomTone {
  // Ambient room-tone bed: pink noise seated LOW behind a steep filter, so
  // it reads as a soft room rush and never bright mid hiss. This applies the
  // audition's no-static rule (steep rolloff -48, warm cutoff, low level)
  // to the bed as well. The steepness and the subsonic-clearing highpass
  // are FIXED here; applyScene re-points the lowpass cutoff and level per
  // scene from SCENES[].amb (all lowpass now, seated warm), and never
  // touches the rolloff, so every scene's bed stays steep. The source also
  // sits a touch quieter than the old bed.
  const ambGain = new Tone.Gain(0).connect(bedFilter);
  // Truly subsonic (35 Hz): it clears speaker-flapping rumble without
  // touching the deep beds of the low-cutoff scenes (metro lowpass 90,
  // cinema 110), whose rush must survive.
  const ambTone = new Tone.Filter({ type: "highpass", frequency: 35, rolloff: -12 }).connect(
    ambGain,
  );
  const ambFilter = new Tone.Filter({ type: "lowpass", frequency: 600, rolloff: -48 }).connect(
    ambTone,
  );
  const ambNoise = new Tone.Noise("pink").connect(ambFilter);
  ambNoise.volume.value = -20;
  ambNoise.start();
  return { ambNoise, ambFilter, ambTone, ambGain };
}
