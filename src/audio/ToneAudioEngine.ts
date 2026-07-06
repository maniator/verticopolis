import * as Tone from "tone";
import type { FacilityKind } from "../engine/types";
import type { ViewFocus } from "../render/excalibur/TowerEngine";

/**
 * Procedural ambient audio, built on Tone.js. SimTower famously played
 * different background music depending on which part of the tower you were
 * viewing. This engine keeps that idea and does everything procedurally (no
 * audio files to ship), but the
 * synthesis, scheduling and effects are expressed through Tone.js primitives
 * (Transport, PolySynth, Filter, Reverb, Noise) instead of hand-wired
 * WebAudio nodes.
 *
 * Each area of the tower has its own looping theme plus an ambient "room tone"
 * bed (crowd murmur, kitchen bustle, tunnel rumble, HVAC hum). The mix is
 * *zoom-reactive*: pulled all the way out you hear a warm, distant "whole
 * tower" overview theme through a muffled distance filter; as you zoom into a
 * floor the filter opens and area-specific detail accents fade in — elevator
 * dings, dish clatter, keystrokes, a train whoosh, a cinema boom, register
 * beeps. Rainy days add an outdoor rain layer. Action jingles (build, sell,
 * promotion, error) fire on demand.
 *
 * Everything is feature-detected and gesture-gated: with no AudioContext
 * (tests / unsupported) `start()` is a no-op and the whole engine stays inert.
 *
 * This module carries the whole Tone.js dependency (~230 kB), so it is loaded
 * lazily via a dynamic `import()` from the {@link AudioEngine} facade in
 * `./Audio.ts` on the first user gesture — keeping Tone out of the initial
 * bundle. Do not statically import this module from the app boot path.
 */

/** Action jingles the game can fire on demand. Shared with the facade. */
export type SfxName = "build" | "sell" | "error" | "promote" | "money" | "click";

type Scene =
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
type BasicWave = "sine" | "square" | "sawtooth" | "triangle";

/** Close-up flavor scheduled only when the camera is zoomed in on a scene. */
type Accent =
  | "none"
  | "ding"
  | "clatter"
  | "keys"
  | "rumble"
  | "boom"
  | "register"
  | "chatter";

interface SceneDef {
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
  /** Detail sound heard up close (see {@link Accent}). */
  accent: Accent;
}

const SCENES: Record<Scene, SceneDef> = {
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
    accent: "none",
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
    accent: "none",
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
    accent: "ding",
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
    accent: "keys",
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
    accent: "chatter",
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
    accent: "ding",
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
    accent: "clatter",
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
    accent: "register",
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
    accent: "boom",
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
    accent: "none",
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
    accent: "rumble",
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
    accent: "none",
  },
};

/** Below this zoom the whole tower is in frame, so we play the overview theme. */
const OVERVIEW_ZOOM = 0.55;
/** Zoom at which area detail is fully faded in. */
const DETAIL_ZOOM = 1.7;
/** Hysteresis band around OVERVIEW_ZOOM so the overview scene doesn't flicker. */
const OVERVIEW_EXIT = OVERVIEW_ZOOM + 0.08;

function sceneFor(focus: ViewFocus, overview: boolean): Scene {
  // Zoomed all the way out — you're looking at the whole building, so play the
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
function detailFor(zoom: number): number {
  return clamp((zoom - OVERVIEW_ZOOM) / (DETAIL_ZOOM - OVERVIEW_ZOOM), 0, 1);
}

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sameNotes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class ToneAudioEngine {
  // Master + shared effect chain.
  private master: Tone.Gain | null = null;
  /** Distance lowpass on the musical/ambient bed; opens up as you zoom in. */
  private bedFilter: Tone.Filter | null = null;
  private reverb: Tone.Reverb | null = null;

  // Sustained voices.
  private pad: Tone.PolySynth | null = null;
  private padGain: Tone.Gain | null = null;
  private bass: Tone.Synth | null = null;
  private bassGain: Tone.Gain | null = null;

  // Melody + one-shots.
  private lead: Tone.PolySynth | null = null;
  private musicGain: Tone.Gain | null = null;
  private sfxSynth: Tone.PolySynth | null = null;
  private accentSynth: Tone.PolySynth | null = null;
  private membrane: Tone.MembraneSynth | null = null;
  private noiseAccent: Tone.NoiseSynth | null = null;
  private accentFilter: Tone.Filter | null = null;
  private accentGain: Tone.Gain | null = null;

  // Ambient beds.
  private ambNoise: Tone.Noise | null = null;
  private ambFilter: Tone.Filter | null = null;
  /** Fixed roll-off on the ambient bed so it never turns into bright hiss. */
  private ambTone: Tone.Filter | null = null;
  private ambGain: Tone.Gain | null = null;
  private rainNoise: Tone.Noise | null = null;
  private rainFilter: Tone.Filter | null = null;
  private rainGain: Tone.Gain | null = null;

  private repeatId: number | null = null;
  /** Position within the 16-step bar — drives strong/weak beat placement. */
  private step = 0;
  /** Free-running step counter (never wraps) so the melody and ambient accents
   * evolve across bars instead of repeating a fixed 16-step pattern. */
  private tick = 0;
  private scene: Scene = "lobby";
  private targetScene: Scene = "lobby";
  /** Hysteresis latch for the zoomed-out overview scene. */
  private overview = false;
  private padNotes: number[] = [];
  private ambBase = 0.2;
  private detail = 0.4;
  private rainTarget = 0;
  muted = false;
  started = false;

  /** Lazily create the audio graph. Must be called from a user gesture. */
  start(): void {
    if (this.started) return;
    const hasWebAudio =
      typeof (globalThis as { AudioContext?: unknown }).AudioContext !== "undefined" ||
      typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined";
    if (!hasWebAudio) return; // no WebAudio (tests / unsupported)
    try {
      // Resume Tone's context — we're inside a user gesture, so this is allowed.
      // Swallow rejections (autoplay/permission failures) so a blocked context
      // can't surface an unhandled promise rejection.
      Tone.start().catch(() => {});

      this.master = new Tone.Gain(this.muted ? 0 : 0.35).toDestination();

      // Musical + ambient content flows through a lowpass whose cutoff tracks
      // zoom (far out = muffled, up close = present), then a gentle reverb so
      // scenes feel like rooms rather than oscillators.
      this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.master);
      this.bedFilter = new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.7 }).connect(
        this.reverb,
      );

      // Sustained chord pad. A hair of detune warms it, but keep the spread
      // small: heavy detuning of low notes beats into a throbbing hum that gets
      // fatiguing over a long session. Held well back in the mix for the same
      // reason — it's a bed under the melody, not a drone.
      this.padGain = new Tone.Gain(0).connect(this.bedFilter);
      this.pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsine", spread: 8, count: 2 },
        envelope: { attack: 1.5, decay: 0.3, sustain: 0.7, release: 1.4 },
      }).connect(this.padGain);
      this.pad.volume.value = -14;

      // Low bass voice.
      this.bassGain = new Tone.Gain(0).connect(this.bedFilter);
      this.bass = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 1, decay: 0.3, sustain: 1, release: 2 },
      }).connect(this.bassGain);

      // Melody voice.
      this.musicGain = new Tone.Gain(0).connect(this.bedFilter);
      this.lead = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.2 },
      }).connect(this.musicGain);

      // Close-up accents (kept crisp — routed dry to master, not distance-filtered).
      // Held well below the music so they read as distant background detail, not
      // sharp foreground blips.
      this.accentGain = new Tone.Gain(0.3).connect(this.master);
      this.accentSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.4 },
      }).connect(this.accentGain);
      this.membrane = new Tone.MembraneSynth({ octaves: 4 }).connect(this.accentGain);
      this.accentFilter = new Tone.Filter({ type: "bandpass", frequency: 1000, Q: 1 }).connect(
        this.accentGain,
      );
      this.noiseAccent = new Tone.NoiseSynth({
        noise: { type: "pink" },
        // A gentler decay so bursts fade instead of clicking off abruptly.
        envelope: { attack: 0.004, decay: 0.14, sustain: 0 },
      }).connect(this.accentFilter);
      this.noiseAccent.volume.value = -14;

      // Ambient room-tone bed (filtered looping noise). Pink noise + a strong
      // roll-off keeps it a soft "room rush" rather than bright tape hiss, and
      // the source sits far below unity so it never becomes static up close.
      this.ambGain = new Tone.Gain(0).connect(this.bedFilter);
      this.ambTone = new Tone.Filter({ type: "lowpass", frequency: 2200, Q: 0.5 }).connect(
        this.ambGain,
      );
      this.ambFilter = new Tone.Filter({ type: "bandpass", frequency: 500, Q: 0.7 }).connect(
        this.ambTone,
      );
      this.ambNoise = new Tone.Noise("pink").connect(this.ambFilter);
      this.ambNoise.volume.value = -18;
      this.ambNoise.start();

      // Outdoor rain layer (kept dry to master).
      this.rainGain = new Tone.Gain(0).connect(this.master);
      this.rainFilter = new Tone.Filter({ type: "highpass", frequency: 600, Q: 0.5 }).connect(
        this.rainGain,
      );
      this.rainNoise = new Tone.Noise({ type: "pink", playbackRate: 1.3 }).connect(this.rainFilter);
      this.rainNoise.volume.value = -12;
      this.rainNoise.start();

      // One-shot action jingles.
      this.sfxSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.12 },
      }).connect(this.master);

      // Kick off the transport-driven sequencer.
      const transport = Tone.getTransport();
      transport.bpm.value = SCENES[this.scene].bpm;
      this.repeatId = transport.scheduleRepeat((time) => this.onStep(time), "8n");
      transport.start();

      // Hold the pad + bass so the scene has a bed the moment it applies.
      this.pad.triggerAttack(this.padNotesFor(this.scene));
      this.padNotes = this.padNotesFor(this.scene);
      this.bass.triggerAttack(midiToFreq(SCENES[this.scene].root - 12));

      this.started = true;
      this.applyScene(this.scene, 0.01);
      this.applyDetail(this.detail, 0.01);
    } catch {
      this.dispose();
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.rampTo(m ? 0 : 0.35, 0.1);
    // resume() is async and can reject (e.g. called outside a gesture); catch so
    // unmuting never trips a global unhandled-rejection handler.
    if (!m) Tone.getContext().resume().catch(() => {});
  }

  /** Called every frame with the renderer's focus; switches scenes smoothly. */
  update(focus: ViewFocus): void {
    if (!this.started) return;
    // Never let an audio hiccup escape into the game loop, and never leave the
    // graph half-updated: any Tone error here is swallowed and retried next frame.
    try {
      // The browser can suspend the AudioContext (tab backgrounded, power
      // saving), which silences everything until it's resumed. Nudge it back on
      // each update so sound reliably returns instead of staying dead.
      const ctx = Tone.getContext();
      if (!this.muted && ctx.state === "suspended") void ctx.resume().catch(() => {});

      // Zoom detail: opens the distance filter and fades ambient detail in/out.
      const detail = detailFor(focus.zoom);
      if (Math.abs(detail - this.detail) > 0.02) this.applyDetail(detail, 0.3);

      // Resolve the overview latch with hysteresis so hovering near the zoom
      // threshold can't flip the scene (and re-trigger the pad) every frame.
      if (this.overview) {
        if (focus.zoom > OVERVIEW_EXIT) this.overview = false;
      } else if (focus.zoom < OVERVIEW_ZOOM) {
        this.overview = true;
      }

      const s = sceneFor(focus, this.overview);
      if (s !== this.targetScene) {
        this.targetScene = s;
        this.crossfadeTo(s);
      }

      // Outdoor rain layer — only when you can actually see the sky (zoomed out
      // to the overview or looking at the street), so it reads as a real "tell"
      // for the weather rather than an inaudible smear behind indoor scenes.
      const wantRain = focus.weather === "rain" && (s === "outside" || s === "overview") ? 0.13 : 0;
      if (wantRain !== this.rainTarget && this.rainGain) {
        this.rainTarget = wantRain;
        this.rainGain.gain.rampTo(wantRain, 1.5);
      }
    } catch {
      /* transient Tone/context error — recover on the next update */
    }
  }

  private padNotesFor(s: Scene): number[] {
    const def = SCENES[s];
    return def.pad.map((semi) => midiToFreq(def.root + semi - 12));
  }

  private crossfadeTo(s: Scene): void {
    this.scene = s;
    this.applyScene(s, 1.2);
  }

  private applyScene(s: Scene, time: number): void {
    if (!this.started || !this.padGain || !this.musicGain || !this.bassGain) return;
    const def = SCENES[s];
    // Pad and bass sit low in the mix so the sustained bed stays a gentle
    // presence rather than a constant hum; the melody carries each scene.
    this.padGain.gain.rampTo(def.gain * 0.09, time);
    this.musicGain.gain.rampTo(def.gain * 0.2, time);
    this.bassGain.gain.rampTo(def.bass * 0.08, time);
    if (this.lead) this.lead.set({ oscillator: { type: def.wave } });

    // Move the pad to the new chord — but only actually re-voice it when the
    // chord changes. Retriggering on every scene flip stacks held voices (the
    // release tail is seconds long) and can exhaust the PolySynth, which shows
    // up as glitchy static and, eventually, a stuck/silent pad.
    if (this.pad) {
      const notes = this.padNotesFor(s);
      if (!sameNotes(notes, this.padNotes)) {
        this.pad.releaseAll();
        this.pad.triggerAttack(notes);
        this.padNotes = notes;
      }
    }
    if (this.bass) this.bass.frequency.rampTo(midiToFreq(def.root - 12), time);

    // Retune the transport tempo and the ambient bed to this scene's character.
    Tone.getTransport().bpm.rampTo(def.bpm, Math.min(time, 1));
    if (this.ambFilter) {
      this.ambFilter.type = def.amb.type;
      this.ambFilter.frequency.rampTo(def.amb.freq, time);
      this.ambFilter.Q.rampTo(def.amb.q, time);
    }
    this.ambBase = def.amb.gain;
    this.updateAmbGain(time);
  }

  /** React to zoom: open the distance filter and scale ambient detail. */
  private applyDetail(detail: number, time: number): void {
    if (!this.started) return;
    this.detail = detail;
    // Cap the top end well below full-band so opening the filter on zoom-in
    // brightens the mix without unmasking noise as high-frequency static.
    if (this.bedFilter) this.bedFilter.frequency.rampTo(lerp(650, 7500, detail), time);
    this.updateAmbGain(time);
  }

  private updateAmbGain(time: number): void {
    if (!this.ambGain) return;
    // Some room tone is always present; the rest fades in as you zoom in — but
    // kept modest so the bed stays a background presence, never foreground hiss.
    this.ambGain.gain.rampTo(this.ambBase * (0.2 + 0.4 * this.detail), time);
  }

  /** Transport tick (eighth notes): schedule a melody note + close-up accents. */
  private onStep(time: number): void {
    if (this.muted) return;
    // Guard the scheduled callback: a stray Tone error must not tear down the
    // Transport (which would silence the whole engine).
    try {
      const def = SCENES[this.scene];
      this.scheduleStep(def, time);
      if (this.detail > 0.5) this.maybeAccent(def, time);
    } catch {
      /* skip this step */
    }
    this.step = (this.step + 1) % 16;
    this.tick++;
  }

  private scheduleStep(def: SceneDef, time: number): void {
    if (!this.lead) return;
    // Seeded-but-varied note choice; seed off the free-running tick so the line
    // evolves bar to bar rather than looping a fixed 16-note pattern.
    const r = pseudo(this.tick * 2654435761);
    if (r > def.density) return;
    // Land on chord tones on strong beats so the melody feels grounded.
    const onBeat = this.step % 4 === 0;
    let note: number;
    if (onBeat && def.pad.length) {
      const pi = Math.floor(pseudo(this.tick * 22695477 + 3) * def.pad.length);
      note = def.root + def.pad[pi];
    } else {
      const degree = Math.floor(pseudo(this.tick * 40503 + 7) * def.scale.length);
      const octave = pseudo(this.tick * 19349663) > 0.7 ? 12 : 0;
      note = def.root + def.scale[degree] + octave;
    }
    // Soften the harsher timbres so square/saw leads don't fatigue the ear.
    const vel = def.wave === "square" || def.wave === "sawtooth" ? 0.35 : 0.5;
    this.lead.triggerAttackRelease(midiToFreq(note), "8n", time, vel);
    // A high sparkle on off-beats — but only once you've zoomed in enough to
    // "hear the detail", giving close-ups their own extra shimmer.
    if (this.step % 4 === 2 && def.density > 0.5 && this.detail > 0.45) {
      this.lead.triggerAttackRelease(midiToFreq(note + 12), "16n", time + 0.04, 0.18);
    }
  }

  /** Occasionally fire a scene-specific close-up accent. */
  private maybeAccent(def: SceneDef, time: number): void {
    if (def.accent === "none") return;
    // Fire sparingly (and only well zoomed in) so accents feel like occasional
    // life in the room, not a stream of random noises.
    const g = pseudo(this.tick * 2246822519 + 101);
    if (g > 0.05 * this.detail) return;
    this.accentHit(def.accent, time);
  }

  private accentHit(accent: Accent, time: number): void {
    if (!this.accentSynth || !this.membrane || !this.noiseAccent || !this.accentFilter) return;
    switch (accent) {
      case "ding": // elevator arrival chime
        this.accentSynth.triggerAttackRelease(midiToFreq(84), "4n", time, 0.5);
        this.accentSynth.triggerAttackRelease(midiToFreq(79), "4n", time + 0.13, 0.4);
        break;
      case "clatter": // dishes / cutlery
        this.accentFilter.type = "bandpass";
        this.accentFilter.frequency.value = 2600;
        this.accentFilter.Q.value = 6;
        this.noiseAccent.triggerAttackRelease("32n", time, 0.6);
        this.accentSynth.triggerAttackRelease(midiToFreq(96), "32n", time + 0.02, 0.2);
        break;
      case "keys": // keyboard typing
        this.accentFilter.type = "highpass";
        this.accentFilter.frequency.value = 3200;
        this.accentFilter.Q.value = 0.7;
        this.noiseAccent.triggerAttackRelease("64n", time, 0.4);
        this.noiseAccent.triggerAttackRelease("64n", time + 0.09, 0.35);
        break;
      case "rumble": // a train passing through the metro
        this.membrane.triggerAttackRelease(midiToFreq(41), "2n", time, 0.9);
        break;
      case "boom": // a deep cinema hit
        this.membrane.triggerAttackRelease(midiToFreq(33), "2n", time, 0.9);
        break;
      case "register": // shop register beep
        this.accentSynth.triggerAttackRelease(midiToFreq(88), "16n", time, 0.4);
        this.accentSynth.triggerAttackRelease(midiToFreq(83), "16n", time + 0.08, 0.4);
        break;
      case "chatter": // muffled conversation
        this.accentFilter.type = "bandpass";
        this.accentFilter.frequency.value = 700;
        this.accentFilter.Q.value = 2;
        this.noiseAccent.triggerAttackRelease("8n", time, 0.3);
        break;
    }
  }

  // ---- One-shot action jingles ------------------------------------------

  sfx(name: SfxName): void {
    if (!this.started || !this.sfxSynth || this.muted) return;
    const s = this.sfxSynth;
    const t = Tone.now();
    const play = (midi: number, dur: Tone.Unit.Time, offset: number, vel = 0.5) =>
      s.triggerAttackRelease(midiToFreq(midi), dur, t + offset, vel);
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

  dispose(): void {
    // Clear our scheduled repeat and stop Tone's global Transport so no
    // background timer keeps ticking after teardown.
    try {
      const transport = Tone.getTransport();
      if (this.repeatId !== null) transport.clear(this.repeatId);
      transport.stop();
    } catch {
      /* transport already gone */
    }
    this.repeatId = null;
    const nodes = [
      this.pad,
      this.bass,
      this.lead,
      this.sfxSynth,
      this.accentSynth,
      this.membrane,
      this.noiseAccent,
      this.accentFilter,
      this.accentGain,
      this.ambNoise,
      this.ambFilter,
      this.ambTone,
      this.ambGain,
      this.rainNoise,
      this.rainFilter,
      this.rainGain,
      this.padGain,
      this.bassGain,
      this.musicGain,
      this.bedFilter,
      this.reverb,
      this.master,
    ];
    for (const n of nodes) {
      try {
        n?.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.pad = this.bass = null;
    this.lead = this.sfxSynth = this.accentSynth = null;
    this.membrane = null;
    this.noiseAccent = this.ambNoise = this.rainNoise = null;
    this.accentFilter = this.ambFilter = this.ambTone = this.rainFilter = this.bedFilter = null;
    this.accentGain = this.ambGain = this.rainGain = null;
    this.padGain = this.bassGain = this.musicGain = null;
    this.reverb = null;
    this.master = null;
    this.started = false;
  }
}

/** Deterministic 0..1 hash so the melody varies without Math.random. */
function pseudo(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}
