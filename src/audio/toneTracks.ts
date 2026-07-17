/**
 * Composed music for the tower: the fixed note data for the two looping tracks
 * the game actually plays, plus the small deterministic helpers that expand a
 * chord progression into timed note events. This module carries NO Tone.js
 * dependency and no live state: it is pure data + math, so {@link ToneAudioEngine}
 * can turn it into a looping `Tone.Part` and tests can assert the material
 * directly.
 *
 * Both tracks live in a warm D-major world (progressions around I-vi-IV-V:
 * D-Bm-G-A) and share one small palette: a soft triangle bass, a rolling sine
 * arpeggio, and (splash only) a hummable triangle hook. The character was set
 * by an agent party and tuned by the owner over several audition passes:
 *
 * - {@link splashProgram} is the SPLASH / start-screen theme: a short, catchy,
 *   looping hook over a gentle arpeggio (~92 BPM, 4 bars).
 * - {@link gameProgram} is the in-game bed: the same arpeggio texture with NO
 *   hook, drifting through five passages (different chords, arpeggio patterns,
 *   register, tempo) across ~2 minutes before it loops. The top of the arpeggio
 *   is capped so nothing reaches an ear-piercing register.
 */

/** Which voice an event plays through. The engine owns the actual synths. */
export type TrackVoice = "arp" | "bass" | "hook";

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

/** Chord bank. `b` is a soft low root; `t` the three chord tones (D-major
 *  world, so D major and B minor share the same seven notes). */
const CH: Record<string, { b: number; t: [number, number, number] }> = {
  D: { b: 50, t: [62, 66, 69] }, // D  F# A
  A: { b: 45, t: [64, 69, 73] }, // E  A  C#
  Bm: { b: 47, t: [62, 66, 71] }, // D  F# B
  G: { b: 43, t: [62, 67, 71] }, // D  G  B
  Em: { b: 40, t: [64, 67, 71] }, // E  G  B
};

/** The hummable hook (splash only). [midi, startBeat, durBeats] over D-Bm-G-A. */
const HOOK: ReadonlyArray<readonly [number, number, number]> = [
  [69, 0, 1], [74, 1, 1], [78, 2, 1.5], [76, 3.5, 0.5],
  [74, 4, 1], [73, 5, 1], [71, 6, 2],
  [71, 8, 1], [74, 9, 1], [76, 10, 1.5], [74, 11.5, 0.5],
  [73, 12, 1], [69, 13, 1], [66, 14, 1], [69, 15, 1],
];

/** Arpeggio patterns: [toneIndex, beatOffset, durBeats] within a 4-beat bar. */
const PATTERNS: Record<string, ReadonlyArray<readonly [number, number, number]>> = {
  up: [[0, 0, 1.6], [1, 1, 1.6], [2, 2, 1.6], [3, 3, 1.6]],
  updown: [[0, 0, 1.6], [2, 1, 1.6], [3, 2, 1.6], [2, 3, 1.6]],
  roll: [[0, 0, 1.2], [1, 0.75, 1.2], [2, 1.5, 1.2], [3, 2.25, 1.2], [2, 3, 1.4]],
  sparse: [[0, 0, 3.4], [3, 2, 2.4]],
  wide: [[0, 0, 2.6], [2, 1.5, 2.6], [4, 3, 1.8]],
};

/** The in-game bed's five passages: chords, tempo, arpeggio pattern. */
const GAME_SECTIONS: ReadonlyArray<{ chords: string[]; bpm: number; pattern: string }> = [
  { chords: ["D", "Bm", "G", "A"], bpm: 84, pattern: "up" },
  { chords: ["G", "A", "Bm", "D"], bpm: 82, pattern: "roll" },
  { chords: ["Em", "A", "D", "G"], bpm: 78, pattern: "sparse" },
  { chords: ["D", "A", "G", "A"], bpm: 82, pattern: "wide" },
  { chords: ["Bm", "G", "A", "D"], bpm: 84, pattern: "updown" },
];

/** Highest MIDI note the arpeggio may reach; higher notes drop an octave until
 *  under it, so nothing whistles in a piercing register (a headphone-safety
 *  request from the owner). ~F#5. */
const ARP_CAP = 76;

/** Resolve an arpeggio index to a MIDI note: wraps through the three chord
 *  tones, adding an octave each time it wraps. */
function arpNote(tones: readonly number[], k: number): number {
  const octave = Math.floor(k / 3) * 12;
  const idx = ((k % 3) + 3) % 3;
  return tones[idx] + octave;
}

/** Drop a note an octave until it sits at or below {@link ARP_CAP}. */
function capped(midi: number): number {
  let m = midi;
  while (m > ARP_CAP) m -= 12;
  return m;
}

/** SPLASH theme: a looping hook over a gentle arpeggio, ~92 BPM, 4 bars. */
export function splashProgram(): Program {
  const bpm = 92;
  const beat = 60 / bpm;
  const barLen = 4 * beat;
  const chords = ["D", "Bm", "G", "A"];
  const events: TrackEvent[] = [];
  chords.forEach((name, bar) => {
    const c = CH[name];
    const t0 = bar * barLen;
    events.push({ t: t0, midi: c.b, dur: barLen * 0.96, vel: 0.6, voice: "bass" });
    // Rolling arpeggio: the three chord tones plus the middle tone an octave up.
    // Deliberately NOT run through {@link capped}: the splash is a short
    // foreground theme whose bright top note (up to A5 on the A chord) is part
    // of the approved sound. The ear-safety cap applies only to the long in-game
    // bed (see {@link gameProgram}), which you sit under for a whole session.
    const arp = [...c.t, c.t[1] + 12];
    arp.forEach((m, i) => events.push({ t: t0 + i * beat, midi: m, dur: beat * 1.5, vel: 0.5, voice: "arp" }));
  });
  HOOK.forEach(([midi, sb, db]) => events.push({ t: sb * beat, midi, dur: db * beat, vel: 0.7, voice: "hook" }));
  return { events, loopEnd: 16 * beat };
}

/** In-game bed: the arpeggio texture with no hook, drifting through the five
 *  {@link GAME_SECTIONS} (each played twice) before it loops. */
export function gameProgram(): Program {
  const events: TrackEvent[] = [];
  let t = 0;
  for (const sec of GAME_SECTIONS) {
    const beat = 60 / sec.bpm;
    const barLen = 4 * beat;
    const pat = PATTERNS[sec.pattern];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const name of sec.chords) {
        const c = CH[name];
        events.push({ t, midi: c.b, dur: barLen * 0.98, vel: 0.55, voice: "bass" });
        for (const [k, bo, db] of pat) {
          events.push({ t: t + bo * beat, midi: capped(arpNote(c.t, k)), dur: db * beat, vel: 0.5, voice: "arp" });
        }
        t += barLen;
      }
    }
  }
  return { events, loopEnd: t };
}

/** Resolve a program by kind. */
export function programFor(kind: ProgramKind): Program {
  return kind === "splash" ? splashProgram() : gameProgram();
}

/** Exposed for tests: the highest note the arpeggio may reach. */
export const ARP_CAP_MIDI = ARP_CAP;
