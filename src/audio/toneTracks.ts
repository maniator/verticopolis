/**
 * Composed music for the tower: the fixed note data for the two looping tracks
 * the game plays, plus the deterministic builders that expand it into timed
 * note events. This module carries NO Tone.js dependency and no live state, so
 * {@link ToneAudioEngine} can turn a program into a looping `Tone.Part` and
 * tests can assert the material directly.
 *
 * Every melody, rhythm, and percussion figure here is transcribed from the
 * owner's own recordings (hums, chest hits, object taps); the accompaniment is
 * one bass root per bar plus a quiet held fifth, nothing more. The design
 * record is the "Human-recorded audio theme" GDD amendment and
 * `_bmad-output/specs/spec-human-audio-theme/`.
 *
 * - {@link splashProgram} is "Terrace + Heartbeat": the owner's hummed tune as
 *   the hook an octave up, their chest-hit pulse underneath (96 BPM, 10 bars).
 * - {@link gameProgram} is "Two Chapters": their long wandering hum verbatim,
 *   then the same tune as the splash but slow and low, one shared 76 BPM pulse
 *   throughout, their object-tap groove on one continuous grid (~101 s loop).
 */

/** Which voice an event plays through. The engine owns the actual synths;
 *  `thump` is the low chest-hit membrane, `tap` the bright object-tap one. */
export type TrackVoice = "arp" | "bass" | "hook" | "thump" | "tap";

/** One scheduled note. `t` and `dur` are seconds from the loop start; `vel` is
 *  a 0..1 velocity (the overall mix level is the engine's music bus). */
export interface TrackEvent {
  t: number;
  midi: number;
  dur: number;
  vel: number;
  voice: TrackVoice;
}

/** A looping track: its events and the loop length in seconds. */
export interface Program {
  events: TrackEvent[];
  loopEnd: number;
}

/** Which track to play. Splash screen vs. in-game. */
export type ProgramKind = "splash" | "game";

// ---- The owner's recorded material, quantized -----------------------------
// Melody rows are [beatFromStart, durBeats, midi, recordedVel]. The velocities
// are the recording's own dynamics; the builders lift or trim them per track.

/** The Hummm tune (splash hook; also chapter two of the bed). D dorian. */
const TERRACE_TUNE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 1.0, 50, 0.45],
  [1.0, 0.5, 52, 0.4],
  [1.5, 0.5, 50, 0.4],
  [2.0, 0.5, 52, 0.45],
  [2.5, 1.0, 53, 0.5],
  [3.5, 1.5, 55, 0.55],
  [5.0, 0.5, 55, 0.5],
  [5.5, 1.0, 53, 0.5],
  [6.5, 0.5, 52, 0.4],
  [7.0, 1.0, 50, 0.45],
  [9.0, 0.5, 59, 0.5],
  [9.5, 2.5, 57, 0.5],
  [12.0, 0.5, 60, 0.65],
  [12.5, 0.5, 62, 0.6],
  [13.0, 2.0, 59, 0.6],
  [15.0, 1.5, 57, 0.45],
  [18.0, 0.5, 48, 0.35],
  [18.5, 1.5, 50, 0.45],
  [20.0, 0.5, 52, 0.45],
  [20.5, 1.5, 53, 0.5],
  [22.0, 1.0, 55, 0.5],
  [23.0, 1.0, 53, 0.45],
  [25.0, 0.5, 57, 0.5],
  [25.5, 1.5, 57, 0.5],
  [27.0, 1.0, 59, 0.55],
  [28.0, 2.0, 60, 0.65],
  [30.0, 0.5, 59, 0.55],
  [30.5, 1.0, 57, 0.45],
  [32.0, 1.0, 53, 0.5],
  [33.0, 0.5, 52, 0.4],
  [33.5, 0.5, 50, 0.45],
  [34.0, 2.0, 50, 0.4],
];

/** The Hummm tune as the bed hears it: the same song auto-quantized straight
 *  from the recording (chapter two keeps the take's own phrasing, which
 *  differs in small ways from the hand-cleaned splash table above). */
const TERRACE_TUNE_SUNG: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 1.0, 50, 0.22],
  [1.0, 0.5, 52, 0.23],
  [1.5, 0.5, 50, 0.29],
  [2.0, 0.5, 52, 0.38],
  [2.5, 1.0, 53, 0.34],
  [3.5, 0.5, 55, 0.4],
  [5.0, 0.5, 55, 0.45],
  [5.5, 1.0, 53, 0.4],
  [6.5, 0.5, 52, 0.27],
  [7.0, 0.5, 50, 0.31],
  [9.0, 0.5, 59, 0.46],
  [9.5, 2.5, 57, 0.35],
  [12.0, 0.5, 60, 0.75],
  [12.5, 0.5, 62, 0.49],
  [13.0, 2.0, 59, 0.56],
  [15.0, 2.0, 57, 0.26],
  [18.0, 0.5, 50, 0.25],
  [18.5, 0.5, 48, 0.33],
  [20.0, 0.5, 52, 0.32],
  [20.5, 1.5, 53, 0.4],
  [22.0, 1.0, 55, 0.34],
  [23.0, 1.0, 53, 0.27],
  [25.0, 0.5, 57, 0.37],
  [25.5, 1.5, 57, 0.37],
  [27.0, 1.0, 59, 0.49],
  [28.0, 2.0, 60, 0.57],
  [30.0, 0.5, 59, 0.51],
  [30.5, 1.0, 57, 0.26],
  [32.0, 0.5, 52, 0.41],
  [33.0, 0.5, 50, 0.44],
  [34.0, 2.5, 50, 0.21],
];

/** The New_humm hum, verbatim: chapter one of the bed. G minor territory. */
const WANDER_HUM: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 1.0, 51, 0.33],
  [1.0, 1.5, 55, 0.34],
  [2.5, 1.0, 58, 0.4],
  [3.5, 1.0, 50, 0.23],
  [4.5, 0.5, 51, 0.17],
  [5.0, 0.5, 53, 0.18],
  [5.5, 0.5, 60, 0.33],
  [6.0, 0.5, 60, 0.47],
  [7.0, 2.0, 55, 0.2],
  [9.0, 1.0, 55, 0.23],
  [10.0, 0.5, 58, 0.13],
  [12.0, 0.5, 60, 0.31],
  [12.5, 0.5, 56, 0.21],
  [13.0, 0.5, 53, 0.2],
  [13.5, 0.5, 56, 0.28],
  [14.0, 0.5, 56, 0.26],
  [14.5, 0.5, 50, 0.23],
  [15.0, 1.0, 55, 0.22],
  [16.0, 0.5, 50, 0.18],
  [16.5, 0.5, 53, 0.2],
  [17.0, 0.5, 53, 0.14],
  [17.5, 0.5, 50, 0.19],
  [18.0, 0.5, 56, 0.25],
  [18.5, 0.5, 60, 0.29],
  [19.0, 0.5, 58, 0.21],
  [19.5, 1.0, 58, 0.27],
  [20.5, 0.5, 55, 0.16],
  [21.0, 0.5, 55, 0.18],
  [21.5, 0.5, 55, 0.1],
  [23.0, 0.5, 60, 0.39],
  [23.5, 1.0, 60, 0.36],
  [24.5, 0.5, 55, 0.21],
  [25.0, 0.5, 55, 0.2],
  [25.5, 0.5, 55, 0.16],
  [26.0, 0.5, 50, 0.17],
  [26.5, 0.5, 50, 0.17],
  [27.0, 0.5, 50, 0.16],
  [27.5, 0.5, 53, 0.17],
  [28.0, 0.5, 55, 0.15],
  [28.5, 0.5, 60, 0.34],
  [29.5, 1.0, 63, 0.51],
  [30.5, 0.5, 62, 0.56],
  [31.0, 0.5, 60, 0.57],
  [31.5, 0.5, 58, 0.36],
  [32.0, 1.0, 56, 0.2],
  [33.0, 0.5, 55, 0.28],
  [35.0, 0.5, 58, 0.9],
  [35.5, 0.5, 58, 0.57],
  [36.0, 0.5, 55, 0.35],
  [36.5, 0.5, 58, 0.34],
  [37.0, 0.5, 58, 0.35],
  [37.5, 0.5, 62, 0.45],
  [38.5, 0.5, 60, 0.39],
  [39.0, 1.0, 58, 0.48],
  [40.0, 0.5, 55, 0.3],
  [42.0, 0.5, 55, 0.31],
  [42.5, 0.5, 56, 0.33],
  [43.0, 0.5, 53, 0.28],
  [43.5, 0.5, 55, 0.22],
  [44.0, 0.5, 60, 0.32],
  [44.5, 0.5, 58, 0.36],
  [45.0, 0.5, 55, 0.3],
  [45.5, 0.5, 55, 0.29],
  [46.0, 0.5, 55, 0.26],
  [46.5, 0.5, 55, 0.2],
  [47.0, 0.5, 51, 0.14],
  [49.0, 0.5, 48, 0.25],
  [50.0, 0.5, 62, 0.29],
  [50.5, 0.5, 60, 0.24],
  [52.0, 0.5, 50, 0.17],
  [52.5, 0.5, 53, 0.17],
  [53.0, 0.5, 50, 0.16],
  [53.5, 0.5, 58, 0.24],
  [54.0, 0.5, 60, 0.18],
  [55.5, 0.5, 62, 0.4],
  [56.0, 0.5, 60, 0.3],
  [56.5, 0.5, 58, 0.2],
  [57.0, 0.5, 55, 0.18],
  [57.5, 0.5, 55, 0.18],
  [58.0, 0.5, 55, 0.12],
  [58.5, 0.5, 55, 0.13],
  [59.0, 0.5, 53, 0.07],
  [59.5, 1.0, 63, 0.19],
  [61.0, 0.5, 48, 0.12],
  [61.5, 0.5, 53, 0.14],
  [62.0, 0.5, 53, 0.11],
  [62.5, 0.5, 60, 0.21],
  [63.0, 0.5, 58, 0.18],
  [64.5, 1.0, 51, 0.14],
  [66.0, 0.5, 60, 0.15],
  [66.5, 0.5, 58, 0.1],
  [68.0, 0.5, 58, 0.15],
  [68.5, 0.5, 60, 0.21],
  [69.0, 0.5, 62, 0.23],
  [69.5, 0.5, 63, 0.17],
  [71.0, 0.5, 51, 0.19],
  [72.0, 0.5, 55, 0.15],
  [72.5, 0.5, 56, 0.1],
  [74.0, 0.5, 60, 0.36],
  [74.5, 0.5, 60, 0.1],
  [75.5, 0.5, 56, 0.17],
  [76.0, 0.5, 55, 0.16],
  [76.5, 0.5, 50, 0.14],
  [77.0, 0.5, 48, 0.14],
  [77.5, 0.5, 48, 0.12],
];

/** The owner's object-tap groove: one 16-beat cycle of [beatPos, velocity],
 *  distilled from the taps at the end of the New_humm recording. */
const TAP_CYCLE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.5],
  [1.0, 0.3],
  [1.5, 0.35],
  [4.0, 0.45],
  [4.5, 0.4],
  [6.5, 0.3],
  [9.0, 0.6],
  [9.5, 0.3],
  [10.5, 0.4],
  [12.0, 0.45],
  [12.5, 0.4],
  [14.0, 0.3],
  [15.5, 0.25],
];

/** Chord bank: bar root (low midi). The quiet pad plays a fifth (+19 st)
 *  above whichever root is active; there is no arpeggio voice in this music. */
const ROOTS: Record<string, number> = {
  Dm: 50, C: 48, G: 43, F: 53, Am: 45, DmLow: 38,
  Gm: 43, Eb: 51, Bb: 46, Cm: 48,
  Fpiv: 41, BbPiv: 46,
};

/** Splash chords, one per bar. */
const SPLASH_CHORDS = ["Dm", "C", "G", "F", "Dm", "C", "Am", "F", "Dm", "DmLow"] as const;

/** Bed chapter one chords (per-bar roots fitted to the hum; the first bar is
 *  pinned to Gm so chapter two's D-minor ending resolves v-i at the loop wrap). */
const BED_CH1_CHORDS = [
  "Gm", "Cm", "Gm", "Cm", "Bb", "Cm", "Gm", "Cm", "Gm", "Gm",
  "Gm", "Eb", "Cm", "Bb", "Cm", "F", "Cm", "Cm", "Cm", "Cm",
] as const;

/** Bed chapter two chords. */
const BED_CH2_CHORDS = ["Dm", "Dm", "Dm", "G", "C", "Dm", "Dm", "F", "Dm", "Dm"] as const;

const SPLASH_BPM = 96;
const BED_BPM = 76;

/** Support for one bar: the bass root and the quiet held fifth (pad rides the
 *  `arp` synth; only the note data changed when the arpeggios were retired). */
function barSupport(t0: number, root: number, barLen: number, bassVel: number, padVel: number): TrackEvent[] {
  return [
    { t: t0, midi: root, dur: barLen * 0.96, vel: bassVel, voice: "bass" },
    { t: t0, midi: root + 19, dur: barLen * 0.96, vel: padVel, voice: "arp" },
  ];
}

/** Expand a melody table into hook events. */
function melody(
  table: ReadonlyArray<readonly [number, number, number, number]>,
  beat: number,
  t0: number,
  opts: { transpose: number; lift: number; cap: number; scale?: number },
): TrackEvent[] {
  return table.map(([b, db, m, v]) => ({
    t: t0 + b * beat,
    midi: m + opts.transpose,
    dur: db * beat,
    vel: Math.min(opts.cap, v + opts.lift) * (opts.scale ?? 1),
    voice: "hook" as const,
  }));
}

/** SPLASH: "Terrace + Heartbeat". The tune an octave up over bar roots and
 *  fifths, with the chest-hit pulse on every eighth (strong on the beat). */
export function splashProgram(): Program {
  const beat = 60 / SPLASH_BPM;
  const barLen = 4 * beat;
  const events: TrackEvent[] = [];
  SPLASH_CHORDS.forEach((name, bar) => {
    events.push(...barSupport(bar * barLen, ROOTS[name], barLen, 0.6, 0.18));
  });
  events.push(...melody(TERRACE_TUNE, beat, 0, { transpose: 12, lift: 0.25, cap: 0.85 }));
  const loopEnd = SPLASH_CHORDS.length * barLen;
  for (let i = 0; i * (beat / 2) < loopEnd - 0.05; i++) {
    events.push({
      t: i * (beat / 2),
      midi: 33,
      dur: 0.16,
      vel: i % 2 === 0 ? 1 : 0.55,
      voice: "thump",
    });
  }
  return { events, loopEnd };
}

/** Tap level across the bed: quieter in chapter two, breathing down to 30%
 *  within two bars of each seam (and of the loop wrap) instead of stopping. */
function bedTapLevel(t: number, seams: readonly number[], ch2Start: number): number {
  const base = t >= ch2Start ? 0.3 : 0.4;
  const breathe = 2 * 4 * (60 / BED_BPM);
  let g = 1;
  for (const s of seams) {
    const d = Math.abs(t - s);
    if (d < breathe) g = Math.min(g, Math.max(0.3, d / breathe));
  }
  return base * g;
}

/** IN-GAME BED: "Two Chapters" on one shared 76 BPM pulse. Chapter one is the
 *  wandering hum verbatim; a breathing F bar walks into chapter two (the
 *  splash tune, slow and in its sung register); a rising F-to-Bb bar walks
 *  back out so the wrap resolves Dm into Gm. The tap groove never changes
 *  grid. Melody sits 20% under the audition mix because in-game it plays
 *  beneath crowd din and jingles (party refinement, 2026-08-06). */
export function gameProgram(): Program {
  const beat = 60 / BED_BPM;
  const barLen = 4 * beat;
  const events: TrackEvent[] = [];
  const bedMel = { transpose: 0, lift: 0.12, cap: 0.7, scale: 0.8 };

  BED_CH1_CHORDS.forEach((name, bar) => {
    events.push(...barSupport(bar * barLen, ROOTS[name], barLen, 0.5, 0.16));
  });
  events.push(...melody(WANDER_HUM, beat, 0, bedMel));
  const seam1 = BED_CH1_CHORDS.length * barLen;

  // Seam one: a breathing bar on F, a low C held then stepping up to D.
  events.push(...barSupport(seam1, ROOTS.Fpiv, barLen, 0.45, 0.13));
  events.push({ t: seam1 + 0.5 * beat, midi: 48, dur: 2 * beat, vel: 0.3, voice: "hook" });
  events.push({ t: seam1 + 3 * beat, midi: 50, dur: beat, vel: 0.26, voice: "hook" });

  const ch2Start = seam1 + barLen;
  BED_CH2_CHORDS.forEach((name, bar) => {
    events.push(...barSupport(ch2Start + bar * barLen, ROOTS[name], barLen, 0.5, 0.16));
  });
  events.push(...melody(TERRACE_TUNE_SUNG, beat, ch2Start, bedMel));
  const seam2 = ch2Start + BED_CH2_CHORDS.length * barLen;

  // Seam two: bass walks F up to Bb, the hook climbs C to D, and the wrap
  // lands on chapter one's Gm as a v-i cadence.
  events.push({ t: seam2, midi: ROOTS.Fpiv, dur: 2 * beat * 0.95, vel: 0.45, voice: "bass" });
  events.push({ t: seam2 + 2 * beat, midi: ROOTS.BbPiv, dur: 2 * beat * 0.95, vel: 0.45, voice: "bass" });
  events.push({ t: seam2, midi: ROOTS.Fpiv + 19, dur: barLen * 0.95, vel: 0.12, voice: "arp" });
  events.push({ t: seam2 + beat, midi: 48, dur: 1.5 * beat, vel: 0.26, voice: "hook" });
  events.push({ t: seam2 + 3 * beat, midi: 50, dur: beat, vel: 0.3, voice: "hook" });
  const loopEnd = seam2 + barLen;

  // The owner's tap groove: one continuous 16-beat cycle for the whole loop.
  const seams = [seam1, seam2, loopEnd];
  for (let cycle = 0; cycle * 16 * beat < loopEnd - 0.05; cycle++) {
    for (const [pos, vel] of TAP_CYCLE) {
      const t = cycle * 16 * beat + pos * beat;
      if (t >= loopEnd - 0.05) break;
      events.push({ t, midi: 93, dur: 0.07, vel: vel * bedTapLevel(t, seams, ch2Start), voice: "tap" });
    }
  }
  return { events, loopEnd };
}

/** Resolve a program by kind. */
export function programFor(kind: ProgramKind): Program {
  return kind === "splash" ? splashProgram() : gameProgram();
}
