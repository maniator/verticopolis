import type { FacilityKind } from "../engine/types";
import type { ViewFocus } from "../render/excalibur/TowerEngine";

/**
 * Scene tuning data and the pure scene/zoom/pitch math for the procedural audio
 * engine. This module carries no Tone.js dependency and no live state: it is the
 * fixed vocabulary each tower area sounds like (the {@link SCENES} table), the
 * zoom thresholds, and the small deterministic helpers ({@link sceneFor},
 * {@link detailFor}, {@link midiToFreq}, and friends) that {@link ToneAudioEngine}
 * and the synthesis routines in `./toneVoices.ts` build on.
 */

/** Action jingles the game can fire on demand. Shared with the facade. */
export type SfxName = "build" | "sell" | "error" | "promote" | "money" | "click";

export type Scene =
  | "overview"
  | "outside"
  | "lobby"
  | "office"
  | "residential"
  | "hotel"
  | "food"
  | "retail"
  | "cinema"
  | "service"
  | "metro"
  | "quiet";

/** The four basic oscillator timbres our scenes use (never "custom"). */
export type BasicWave = "sine" | "square" | "sawtooth" | "triangle";

export interface SceneDef {
  /** Semitone offsets of the scale, relative to root. */
  scale: number[];
  /** Root MIDI note. */
  root: number;
  /** Beats per minute. */
  bpm: number;
  /** Oscillator timbre for the melody. */
  wave: BasicWave;
  /** Chord (semitone offsets) for the sustained pad. */
  pad: number[];
  /** 0..1 melody activity. */
  density: number;
  /** Overall loudness 0..1. */
  gain: number;
  /** Low bass voice presence 0..1 (0 = silent). */
  bass: number;
  /** Ambient room-tone bed, shaped by a bandpass/lowpass on looping noise. */
  amb: { type: BiquadFilterType; freq: number; q: number; gain: number };
}

export const SCENES: Record<Scene, SceneDef> = {
  // A warm, slow, wide "whole tower" theme heard when fully zoomed out.
  overview: {
    scale: [0, 2, 4, 7, 9],
    root: 48,
    bpm: 58,
    wave: "triangle",
    pad: [0, 7, 12, 16, 19],
    density: 0.3,
    gain: 0.6,
    bass: 0.5,
    amb: { type: "lowpass", freq: 240, q: 0.7, gain: 0.22 },
  },
  outside: {
    scale: [0, 2, 4, 7, 9],
    root: 64,
    bpm: 70,
    wave: "sine",
    pad: [0, 7, 16],
    density: 0.35,
    gain: 0.5,
    bass: 0.3,
    amb: { type: "bandpass", freq: 320, q: 0.5, gain: 0.26 },
  },
  lobby: {
    scale: [0, 2, 4, 5, 7, 9, 11],
    root: 60,
    bpm: 96,
    wave: "triangle",
    pad: [0, 4, 7, 11],
    density: 0.55,
    gain: 0.6,
    bass: 0.35,
    amb: { type: "bandpass", freq: 520, q: 0.8, gain: 0.24 },
  },
  office: {
    scale: [0, 2, 3, 5, 7, 9, 10],
    root: 57,
    bpm: 116,
    wave: "square",
    pad: [0, 3, 7],
    density: 0.7,
    gain: 0.45,
    bass: 0.4,
    amb: { type: "bandpass", freq: 220, q: 1.2, gain: 0.2 },
  },
  residential: {
    scale: [0, 2, 4, 7, 9],
    root: 62,
    bpm: 80,
    wave: "triangle",
    pad: [0, 4, 7],
    density: 0.4,
    gain: 0.55,
    bass: 0.3,
    amb: { type: "bandpass", freq: 360, q: 0.7, gain: 0.14 },
  },
  hotel: {
    scale: [0, 2, 3, 5, 7, 8, 10],
    root: 55,
    bpm: 60,
    wave: "sine",
    pad: [0, 3, 7, 10],
    density: 0.3,
    gain: 0.5,
    bass: 0.35,
    amb: { type: "bandpass", freq: 260, q: 0.9, gain: 0.12 },
  },
  food: {
    scale: [0, 2, 4, 5, 7, 9, 11],
    root: 65,
    bpm: 124,
    wave: "triangle",
    pad: [0, 4, 7, 9],
    density: 0.8,
    gain: 0.55,
    bass: 0.4,
    amb: { type: "bandpass", freq: 900, q: 0.6, gain: 0.26 },
  },
  retail: {
    scale: [0, 2, 4, 7, 9, 11],
    root: 67,
    bpm: 110,
    wave: "triangle",
    pad: [0, 4, 7],
    density: 0.65,
    gain: 0.55,
    bass: 0.35,
    amb: { type: "bandpass", freq: 700, q: 0.7, gain: 0.24 },
  },
  cinema: {
    scale: [0, 2, 3, 5, 7, 8, 11],
    root: 53,
    bpm: 88,
    wave: "sawtooth",
    pad: [0, 3, 7, 10, 14],
    density: 0.5,
    gain: 0.5,
    bass: 0.5,
    amb: { type: "lowpass", freq: 110, q: 0.8, gain: 0.28 },
  },
  service: {
    scale: [0, 2, 4, 5, 7],
    root: 58,
    bpm: 90,
    wave: "sine",
    pad: [0, 5, 7],
    density: 0.3,
    gain: 0.4,
    bass: 0.3,
    amb: { type: "bandpass", freq: 180, q: 1.5, gain: 0.18 },
  },
  metro: {
    scale: [0, 3, 5, 7, 10],
    root: 43,
    bpm: 76,
    wave: "sawtooth",
    pad: [0, 7, 12],
    density: 0.35,
    gain: 0.5,
    bass: 0.55,
    amb: { type: "lowpass", freq: 90, q: 0.8, gain: 0.32 },
  },
  quiet: {
    scale: [0, 4, 7],
    root: 60,
    bpm: 64,
    wave: "sine",
    pad: [0, 7],
    density: 0.2,
    gain: 0.35,
    bass: 0.2,
    amb: { type: "bandpass", freq: 400, q: 0.6, gain: 0.09 },
  },
};

/** Below this zoom the whole tower is in frame, so we play the overview theme. */
export const OVERVIEW_ZOOM = 0.55;
/** Zoom at which area detail is fully faded in. */
export const DETAIL_ZOOM = 1.7;
/** Hysteresis band around OVERVIEW_ZOOM so the overview scene doesn't flicker. */
export const OVERVIEW_EXIT = OVERVIEW_ZOOM + 0.08;

export function sceneFor(focus: ViewFocus, overview: boolean): Scene {
  // Zoomed all the way out: you're looking at the whole building, so play the
  // wide overview theme regardless of what happens to be centered. The caller
  // resolves `overview` with hysteresis so hovering near the zoom threshold
  // doesn't flip scenes (and churn the pad) frame to frame.
  if (overview) return "overview";
  if (focus.dominant === "outside") return "outside";
  if (focus.centerFloor <= -1) return "metro";
  const k = focus.dominant as FacilityKind;
  switch (k) {
    case "lobby":
      return "lobby";
    case "office":
      return "office";
    case "condo":
      return "residential";
    case "hotelSingle":
    case "hotelDouble":
    case "hotelSuite":
      return "hotel";
    case "fastFood":
    case "restaurant":
      return "food";
    case "shop":
      return "retail";
    case "cinema":
    case "partyHall":
    case "weddingHall":
      return "cinema";
    case "security":
    case "medical":
    case "housekeeping":
    case "recycling":
      return "service";
    case "metro":
      return "metro";
    default:
      return focus.centerFloor <= 1 ? "lobby" : "quiet";
  }
}

/** Map camera zoom to a 0..1 "how close are we" detail factor. */
export function detailFor(zoom: number): number {
  return clamp((zoom - OVERVIEW_ZOOM) / (DETAIL_ZOOM - OVERVIEW_ZOOM), 0, 1);
}

export function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sameNotes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
