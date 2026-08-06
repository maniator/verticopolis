import type { FacilityKind } from "../engine/types";
import type { Scene } from "./toneScenes";
import { splashProgram } from "./toneTracks";

/**
 * Pure data and math for the crowd/venue ambience layer: the per-scene sound
 * specs approved in the 2026-07-17 audition rounds (see the crowd-din GDD),
 * the calm mask that keeps talkers off squeals and sibilance in the voice
 * seed, the clock activity curves, and the party remix's note derivation from
 * the game's own splash hook. No Tone.js dependency and no live state, so
 * {@link CrowdLayer} builds on it and tests assert it directly.
 *
 * Two hard rules from the auditions bind everything here: human texture comes
 * from voices and pitched tones, never bright noise; and every noise element
 * names a steep-filter cutoff at or below 1800 Hz (the layer applies it with
 * rolloff -48) at low gain.
 */

/** The ambience scenes. Finer than the music {@link Scene} vocabulary: the
 *  food and cinema scenes split on the dominant facility kind. */
export type CrowdSceneKey =
  | "lobby"
  | "office"
  | "condo"
  | "hotel"
  | "restaurant"
  | "fastFood"
  | "shop"
  | "cinema"
  | "partyHall"
  | "metro"
  | "outside";

/** Voiced background talk: how many people, how chatty, how muffled. */
export interface MurmurSpec {
  /** Talker count at full occupancy; live count scales with the crowd factor. */
  maxTalkers: number;
  /** Pause between a talker's phrases: min plus a 0..1 draw times var, seconds. */
  pauseMin: number;
  pauseVar: number;
  /** Steep lowpass cutoff on the murmur bus (through-the-room warmth). */
  muffleHz: number;
  /** Murmur bus gain at full activity. */
  gain: number;
  /** Fixed talker pitch shift, semitones (single-voice scenes: the office
   *  phone call, the condo TV, the cinema dialogue). Omitted: each talker
   *  draws its own voice from the down-only range. */
  semi?: number;
}

/** A scheduled non-voiced detail sound. `ping` and `thud` are pitched tones;
 *  `burst` is a short noise hit through the steep noise filter at `cutoffHz`. */
export interface ElementSpec {
  kind: "ping" | "thud" | "burst";
  /** Tone frequency range (ping/thud) or noise filter cutoff (burst), Hz. */
  freqMin: number;
  freqMax: number;
  /** Sound length, seconds. */
  dur: number;
  /** Peak gain range within the layer. */
  gainMin: number;
  gainMax: number;
  /** Gap to the next firing: min plus a 0..1 draw times var, seconds. */
  rateMin: number;
  rateVar: number;
  /** Envelope attack, seconds (default 0.004: a tick; longer = a swish). */
  attack?: number;
  /** Fire in clusters (typing): `min..max` hits at the rate gap, then a
   *  thinking pause of `pauseMin` plus a draw times `pauseVar` seconds. */
  cluster?: { min: number; max: number; pauseMin: number; pauseVar: number };
  /** A companion note (bird second chirp, horn dual tone): frequency times
   *  `ratio`, `delayS` later, at `gainScale` of the first. */
  pair?: { ratio: number; delayS: number; gainScale: number };
}

/** When a scene makes sound at all. `attendance` gates on the live crowd
 *  factor (venues sound only while people are actually inside). */
export type CrowdGate = "always" | "workday" | "condoDay" | "attendance";

export interface CrowdSceneSpec {
  murmur?: MurmurSpec;
  elements: ElementSpec[];
  gate: CrowdGate;
  /** Deliberate exception for the CITY'S OWN spaces (the street, the metro
   *  platform): they have people and traffic no matter what the tower tracks,
   *  so they never fall fully silent. The tower's indoor scenes never set
   *  this (honest rooms: empty means silent). */
  crowdFloor?: number;
  /** Scene runs a composed program (party band, cinema score, metro train)
   *  built by the programs module rather than murmur alone. */
  program?: "party" | "cinema" | "metro";
}

/** The approved kit. Cutoffs are steep-filter values; gains sit inside the
 *  layer, whose master stays below the composed music bed. */
export const CROWD_SCENES: Record<CrowdSceneKey, CrowdSceneSpec> = {
  lobby: {
    murmur: { maxTalkers: 6, pauseMin: 0.3, pauseVar: 1.4, muffleHz: 950, gain: 0.5 },
    elements: [],
    gate: "always",
  },
  office: {
    murmur: { maxTalkers: 1, pauseMin: 1.6, pauseVar: 2.6, muffleHz: 850, gain: 0.33, semi: -3.5 },
    elements: [
      // Two typists: dark 12 ms ticks in bursts at the spec's 900 Hz seat; the
      // rate is the per-keystroke gap and the cluster adds thinking pauses.
      { kind: "burst", freqMin: 750, freqMax: 900, dur: 0.012, gainMin: 0.02, gainMax: 0.04, rateMin: 0.08, rateVar: 0.1, cluster: { min: 4, max: 12, pauseMin: 1.2, pauseVar: 3.0 } },
      { kind: "burst", freqMin: 750, freqMax: 900, dur: 0.012, gainMin: 0.02, gainMax: 0.04, rateMin: 0.09, rateVar: 0.09, cluster: { min: 4, max: 12, pauseMin: 1.8, pauseVar: 3.4 } },
      // Page turns: soft dark swishes, not ticks.
      { kind: "burst", freqMin: 650, freqMax: 750, dur: 0.35, gainMin: 0.03, gainMax: 0.05, rateMin: 4, rateVar: 4, attack: 0.08 },
    ],
    gate: "workday",
  },
  condo: {
    murmur: { maxTalkers: 3, pauseMin: 0.9, pauseVar: 1.8, muffleHz: 480, gain: 0.3, semi: -2.5 },
    elements: [
      // Domestic one-shots: a dish clink and a cupboard thud, both rare.
      { kind: "ping", freqMin: 1150, freqMax: 1350, dur: 0.18, gainMin: 0.05, gainMax: 0.08, rateMin: 5, rateVar: 6 },
      { kind: "thud", freqMin: 90, freqMax: 100, dur: 0.3, gainMin: 0.1, gainMax: 0.16, rateMin: 8, rateVar: 8 },
    ],
    gate: "condoDay",
  },
  hotel: {
    murmur: { maxTalkers: 1, pauseMin: 2.2, pauseVar: 3.0, muffleHz: 420, gain: 0.24, semi: -4 },
    elements: [
      // Cart wheel bumps rolling by in a cluster, then a long quiet hall.
      { kind: "thud", freqMin: 64, freqMax: 76, dur: 0.12, gainMin: 0.05, gainMax: 0.09, rateMin: 0.35, rateVar: 0.25, cluster: { min: 5, max: 9, pauseMin: 9, pauseVar: 10 } },
      // A door thud down the hall (110 Hz body with its 70 Hz floor). 0.636 is
      // the 70/110 interval.
      { kind: "thud", freqMin: 105, freqMax: 115, dur: 0.35, gainMin: 0.14, gainMax: 0.2, rateMin: 9, rateVar: 9, pair: { ratio: 0.636, delayS: 0.02, gainScale: 0.8 } },
    ],
    gate: "always",
  },
  restaurant: {
    murmur: { maxTalkers: 3, pauseMin: 1.5, pauseVar: 3.5, muffleHz: 800, gain: 0.34 },
    // Three distinct one-shot characters on their own irregular cadences so no
    // stretch repeats: a wide-pitch glass tinkle (a two-note pair, the second
    // note kept in the warm band by capping the fundamental), a soft low plate
    // set-down, and an occasional chair scrape. Only the chair scrape uses the
    // shared mono noise voice, so nothing fights over it.
    elements: [
      { kind: "ping", freqMin: 850, freqMax: 1250, dur: 0.2, gainMin: 0.05, gainMax: 0.13, rateMin: 0.9, rateVar: 2.4, pair: { ratio: 1.5, delayS: 0.06, gainScale: 0.7 } },
      { kind: "thud", freqMin: 150, freqMax: 210, dur: 0.18, gainMin: 0.06, gainMax: 0.1, rateMin: 4, rateVar: 4, attack: 0.006 },
      { kind: "burst", freqMin: 360, freqMax: 420, dur: 0.4, gainMin: 0.06, gainMax: 0.1, rateMin: 6, rateVar: 5, attack: 0.12 },
    ],
    gate: "attendance",
  },
  fastFood: {
    murmur: { maxTalkers: 5, pauseMin: 0.4, pauseVar: 1.0, muffleHz: 1050, gain: 0.46 },
    // Varied counter life on distinct cadences: tray clatter in short clusters
    // (not a steady tick), a two-note register tone at varied pitch, and a low
    // counter thud. Only the tray clatter uses the shared mono noise voice; the
    // register and thud are pitched, so a long noise texture can't be chopped
    // by the frequent tray hits.
    elements: [
      { kind: "burst", freqMin: 1300, freqMax: 1800, dur: 0.06, gainMin: 0.05, gainMax: 0.1, rateMin: 0.09, rateVar: 0.09, cluster: { min: 2, max: 4, pauseMin: 0.7, pauseVar: 1.6 }, attack: 0.012 },
      { kind: "ping", freqMin: 900, freqMax: 1400, dur: 0.15, gainMin: 0.05, gainMax: 0.08, rateMin: 1.3, rateVar: 1.8, pair: { ratio: 1.33, delayS: 0.11, gainScale: 0.7 } },
      { kind: "thud", freqMin: 120, freqMax: 170, dur: 0.2, gainMin: 0.05, gainMax: 0.08, rateMin: 3, rateVar: 4, attack: 0.006 },
    ],
    gate: "attendance",
  },
  shop: {
    murmur: { maxTalkers: 2, pauseMin: 1.2, pauseVar: 2.4, muffleHz: 950, gain: 0.3 },
    elements: [
      // Occasional soft browse rustle.
      { kind: "burst", freqMin: 1050, freqMax: 1150, dur: 0.42, gainMin: 0.04, gainMax: 0.07, rateMin: 2.2, rateVar: 2.8, attack: 0.1 },
    ],
    gate: "attendance",
  },
  cinema: {
    murmur: { maxTalkers: 1, pauseMin: 1.0, pauseVar: 2.2, muffleHz: 650, gain: 0.3, semi: -5.5 },
    elements: [],
    gate: "attendance",
    program: "cinema",
  },
  partyHall: {
    murmur: { maxTalkers: 2, pauseMin: 1.8, pauseVar: 3.0, muffleHz: 900, gain: 0.3 },
    elements: [],
    gate: "attendance",
    program: "party",
  },
  metro: {
    murmur: { maxTalkers: 4, pauseMin: 0.6, pauseVar: 1.6, muffleHz: 900, gain: 0.42 },
    elements: [],
    gate: "always",
    // The platform belongs to the city, like the street: trains run and a few
    // riders pass through whether or not the tower's drawn crowd is in view,
    // so the station (and its train events) never falls fully silent.
    crowdFloor: 0.3,
    program: "metro",
  },
  outside: {
    murmur: { maxTalkers: 2, pauseMin: 1.6, pauseVar: 2.8, muffleHz: 520, gain: 0.3 },
    elements: [
      // Warm two-note bird chirps.
      { kind: "ping", freqMin: 1300, freqMax: 1550, dur: 0.09, gainMin: 0.05, gainMax: 0.07, rateMin: 3, rateVar: 4.5, pair: { ratio: 1.25, delayS: 0.11, gainScale: 0.7 } },
      // A distant car horn, rare (a warm dual tone).
      { kind: "ping", freqMin: 365, freqMax: 375, dur: 0.35, gainMin: 0.07, gainMax: 0.09, rateMin: 14, rateVar: 12, pair: { ratio: 1.26, delayS: 0, gainScale: 0.8 } },
    ],
    gate: "always",
    crowdFloor: 0.35,
  },
};

/** Resolve the ambience scene for a music scene and the dominant kind. The
 *  overview, quiet, and service scenes carry no crowd layer by design. */
export function resolveCrowdScene(
  scene: Scene,
  dominant: FacilityKind | "outside" | "lobby" | "empty",
): CrowdSceneKey | null {
  switch (scene) {
    case "lobby":
      return "lobby";
    case "office":
      return "office";
    case "residential":
      return "condo";
    case "hotel":
      return "hotel";
    case "food":
      return dominant === "fastFood" ? "fastFood" : "restaurant";
    case "retail":
      return "shop";
    case "cinema":
      // Weddings are parties (the same attendance-venue family).
      return dominant === "partyHall" || dominant === "weddingHall" ? "partyHall" : "cinema";
    case "metro":
      return "metro";
    case "outside":
      return "outside";
    default:
      return null; // overview / quiet / service: music and room tone only
  }
}

/** Clock activity 0..1 for a scene's gate at a sim hour (float, [0, 24)). */
export function hourActivity(gate: CrowdGate, hour: number): number {
  const ramp = (from: number, to: number): number => clamp01((hour - from) / (to - from));
  switch (gate) {
    case "workday":
      // Offices ramp in 8-9, hold 9-17, ramp out 17-19, silent overnight.
      if (hour < 8 || hour >= 19) return 0;
      if (hour < 9) return ramp(8, 9);
      if (hour < 17) return 1;
      return 1 - ramp(17, 19);
    case "condoDay":
      // Homes: departure bustle 7-9, midday hush 9-15 (a fifth of full, the
      // one-parent-home texture), ramp back 15-17, evening 17-21, ramp down
      // 21-23, silent overnight.
      if (hour < 7 || hour >= 23) return 0;
      if (hour < 9) return 1;
      if (hour < 15) return 0.2;
      if (hour < 17) return 0.2 + 0.8 * ramp(15, 17);
      if (hour < 21) return 1;
      return 1 - ramp(21, 23);
    default:
      return 1; // "always" and "attendance" (the crowd factor is the gate)
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Deterministic 0..1 hash (same shape as the music's) so ambience timing
 *  varies without Math.random. */
export function pseudo(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}

// ---- Voice seed math ------------------------------------------------------

/** Calm-mask window length, seconds. */
export const CALM_WINDOW_S = 0.1;
/** Windows whose zero-crossing rate reads above this (Hz) are squeal or
 *  sibilance territory and never sampled. */
const CALM_MAX_ZCR_HZ = 1500;
/** Windows louder than this RMS are shouts; never sampled either. */
const CALM_MAX_RMS = 0.32;
/** A phrase segment must be at least this fraction calm windows. */
const CALM_SEGMENT_FRACTION = 0.85;

/** Mark each 100 ms window of the talk seed calm (1) or not (0). */
export function computeCalmMask(samples: Float32Array, sampleRate: number): Uint8Array {
  const win = Math.max(1, Math.floor(CALM_WINDOW_S * sampleRate));
  const mask = new Uint8Array(Math.ceil(samples.length / win));
  for (let w = 0; w < mask.length; w++) {
    let crossings = 0;
    let energy = 0;
    let count = 0;
    for (let i = w * win + 1; i < Math.min((w + 1) * win, samples.length); i++) {
      if (samples[i] >= 0 !== samples[i - 1] >= 0) crossings++;
      energy += samples[i] * samples[i];
      count++;
    }
    if (count === 0) {
      mask[w] = 1;
      continue;
    }
    const zcrHz = (crossings / count) * (sampleRate / 2);
    const rms = Math.sqrt(energy / count);
    mask[w] = zcrHz < CALM_MAX_ZCR_HZ && rms < CALM_MAX_RMS ? 1 : 0;
  }
  return mask;
}

/** True when the segment starting at `startS` for `lenS` seconds is at least
 *  85 percent calm windows. */
export function segmentIsCalm(
  mask: Uint8Array,
  sampleRate: number,
  startS: number,
  lenS: number,
): boolean {
  const win = Math.max(1, Math.floor(CALM_WINDOW_S * sampleRate));
  const w0 = Math.floor((startS * sampleRate) / win);
  const w1 = Math.floor(((startS + lenS) * sampleRate) / win);
  let calm = 0;
  let total = 0;
  for (let w = w0; w <= Math.min(w1, mask.length - 1); w++) {
    total++;
    if (mask[w]) calm++;
  }
  return total > 0 && calm / total >= CALM_SEGMENT_FRACTION;
}

/** Talker phrase and pitch constants (owner-approved: down only, long natural
 *  phrases with trapezoid ramps). */
export const PHRASE_MIN_S = 0.9;
export const PHRASE_VAR_S = 0.9;
export const PHRASE_RAMP_S = 0.12;
export const PITCH_MIN_SEMI = -6;
export const PITCH_MAX_SEMI = -1.5;

/** A whoop bends a calm chunk upward: playback rate 0.9 accelerating to 1.9
 *  across the chunk (rate at progress p in 0..1). */
export function whoopRate(p: number): number {
  return 0.9 + 1.0 * p * p;
}

/** Laugh seed regions, seconds (outtake A then B with a 0.15 s gap). */
export const LAUGH_REGIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.8],
  [0.95, 2.55],
];

// ---- Party remix ----------------------------------------------------------

export const PARTY_BPM = 124;
/** Hook tempo the splash theme is authored at (see toneTracks). */
const HOOK_BPM = 96;
/** The party's loop is 16 beats; the full Terrace tune runs 36, so the remix
 *  quotes its first phrase (the rise and fall) and loops that. Authored beats. */
const HOOK_QUOTE_BEATS = 16;

/** The party plays the game's own splash hook, re-timed to the party tempo.
 *  Derived from {@link splashProgram} so the tune stays canonical. */
export function partyHookEvents(): Array<{ t: number; midi: number; dur: number }> {
  const scale = HOOK_BPM / PARTY_BPM;
  const cutoff = HOOK_QUOTE_BEATS * (60 / HOOK_BPM);
  return splashProgram()
    .events.filter((e) => e.voice === "hook" && e.t < cutoff)
    .map((e) => ({
      t: e.t * scale,
      midi: e.midi,
      // Clip the quote's tail at the cutoff so the last note never rings
      // across the party Part's loop restart onto the next pass's downbeat.
      // The floor guards future data: a note authored right at the cutoff
      // must clip to a tiny blip, never a zero or negative duration.
      dur: Math.max(0.01, Math.min(e.dur, cutoff - e.t)) * scale,
    }));
}

/** Party band bar: root MIDI notes per 4-beat bar (D, A, Bm, G world). */
export const PARTY_BASS_ROOTS = [38, 33, 35, 31];

// ---- Cinema program -------------------------------------------------------

/** Sparse plucked minor arpeggio: [midi, startBeat] over a slow 16-beat loop.
 *  Decaying plucks only; sustained low swells are banned (they drone). */
export const CINEMA_PLUCKS: ReadonlyArray<readonly [number, number]> = [
  [62, 0.8],
  [65, 2.1],
  [69, 3.3],
  [74, 4.4],
  [69, 6.0],
  [65, 7.2],
  [62, 8.3],
  [65, 11.6],
  [69, 12.8],
  [62, 14.2],
];
/** Riser into a boom: sweep range and the boom partials (mid partials keep
 *  the hit audible on small speakers). */
export const CINEMA_RISER = { fromHz: 180, toHz: 420, durS: 1.0 };
export const CINEMA_BOOM_HZ = [57, 110, 225];

// ---- Metro train event ----------------------------------------------------

/** The train event script, seconds from the event start. Wheel da-dum pairs
 *  roll in over a dark rumble, brakes ease, doors thunk, the pairs speed away. */
export interface TrainStep {
  at: number;
  kind: "daDum" | "rumbleIn" | "rumbleOut" | "brake" | "door";
  gain: number;
}

export function trainEvent(): TrainStep[] {
  const steps: TrainStep[] = [{ at: 0.8, kind: "rumbleIn", gain: 1 }];
  for (let t = 0.8; t < 5.8; t += 0.6) {
    steps.push({ at: t, kind: "daDum", gain: 0.12 + 0.5 * (t / 5.8) });
  }
  steps.push({ at: 6.2, kind: "brake", gain: 0.12 });
  steps.push({ at: 7.6, kind: "door", gain: 0.25 });
  steps.push({ at: 9.2, kind: "door", gain: 0.22 });
  steps.push({ at: 10.2, kind: "rumbleOut", gain: 1 });
  let gap = 0.7;
  let gain = 0.55;
  for (let t = 10.2; t < 15.4; t += gap) {
    steps.push({ at: t, kind: "daDum", gain });
    gap = Math.max(0.32, gap * 0.88);
    gain *= 0.87;
  }
  return steps;
}

/** Seconds between train events while the metro stays in view. */
export const TRAIN_INTERVAL_S = 55;
