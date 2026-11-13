import * as Tone from "tone";
import { planNote, type EnvelopeShape, type ParamEvent } from "./lightEnvelope";

/**
 * Light voices: drop-in stand-ins for Tone.Synth, Tone.PolySynth(Tone.Synth)
 * and Tone.MembraneSynth that build each note from two native Web Audio nodes
 * (an oscillator and its envelope gain) which stop and are released when the
 * note ends. They play through Tone's context, clock and graph, and their
 * envelopes are Tone's own curves (`./lightEnvelope.ts`), so they sound the
 * same as the voices they replace.
 *
 * Why they exist: the audio crackled. A Tone instrument keeps its whole node
 * graph alive and rendering all the time (every Synth holds around 35 nodes,
 * every PolySynth adds a spare voice, and each sounding voice another set),
 * so the ~25 instruments the music, jingles and venue ambience need cost the
 * audio thread about a sixth of a fast desktop core even in silence. A slower
 * phone or laptop missed its render deadlines, and every missed deadline is a
 * crackle in whatever is playing. A light voice costs nothing while silent.
 *
 * Mono voices keep Tone's one-note-at-a-time feel: a new note fades the
 * sounding one out over a few milliseconds instead of stacking on it.
 */

/** Oscillator shapes the voices use (Tone plays these as the native types). */
export type LightOscType = "sine" | "triangle" | "square" | "sawtooth";

export interface LightVoiceOptions {
  oscillator?: { type?: LightOscType };
  envelope?: Partial<EnvelopeShape>;
  /** Output level in decibels (Tone's `volume`). */
  volume?: number;
}

export interface LightPolyOptions extends LightVoiceOptions {
  /** Most notes sounding at once; a note past it is dropped, as in Tone. */
  maxPolyphony?: number;
}

export interface LightMembraneOptions extends LightVoiceOptions {
  /** How far above the note the strike starts, as a frequency multiple
   *  (Tone's `octaves`: the sweep starts at `freq * octaves`). */
  octaves?: number;
  /** Seconds the strike takes to glide onto the note. */
  pitchDecay?: number;
}

interface VoiceDefaults {
  envelope: EnvelopeShape;
  oscillator: LightOscType;
}
/** Tone.Synth's defaults (the synth and poly voices start from these). */
const SYNTH_DEFAULTS: VoiceDefaults = {
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 1, attackCurve: "linear" },
  oscillator: "triangle",
};
/** Tone.MembraneSynth's defaults. */
const MEMBRANE_DEFAULTS: VoiceDefaults = {
  envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4, attackCurve: "exponential" },
  oscillator: "sine",
};
const MEMBRANE_OCTAVES = 10;
const MEMBRANE_PITCH_DECAY = 0.05;
/** Tone.PolySynth's default voice limit. */
const POLY_MAX = 32;
/** How long a mono voice takes to fade a note a new one replaces. */
const MONO_HANDOFF_S = 0.005;
/** A note this long past its stop is reaped even if `onended` never fired
 *  (a suspended context never fires it). */
const REAP_GRACE_S = 0.5;

/** One sounding note: its nodes, and when its oscillator stops. */
interface LiveNote {
  osc: OscillatorNode;
  env: GainNode;
  /** Mono voices only: a level the next note fades to hand over. */
  handoff: GainNode | null;
  start: number;
  stopAt: number;
}

function applyEvents(param: AudioParam, events: readonly ParamEvent[]): void {
  for (const ev of events) {
    if (ev.kind === "set") param.setValueAtTime(ev.value, ev.time);
    else if (ev.kind === "linear") param.linearRampToValueAtTime(ev.value, ev.time);
    else param.setTargetAtTime(ev.value, ev.time, ev.timeConstant);
  }
}

function seconds(t: Tone.Unit.Time): number {
  return typeof t === "number" ? t : Tone.Time(t).toSeconds();
}

/** Shared note engine: builds, tracks and reaps light notes. */
abstract class LightVoiceBase {
  /** The voice's output; `volume` is its level in decibels. */
  readonly output: Tone.Volume;
  readonly volume: Tone.Param<"decibels">;
  /** The envelope the next note uses (mutable, read at each note's start). */
  readonly envelope: EnvelopeShape;
  protected type: LightOscType;
  protected live: LiveNote[] = [];
  private disposed = false;

  protected constructor(defaults: VoiceDefaults, opts: LightVoiceOptions) {
    this.output = new Tone.Volume(opts.volume ?? 0);
    this.volume = this.output.volume;
    this.envelope = { ...defaults.envelope, ...opts.envelope };
    this.type = opts.oscillator?.type ?? defaults.oscillator;
  }

  connect(dest: Tone.InputNode): this {
    this.output.connect(dest);
    return this;
  }

  /** Change the envelope for later notes (Tone's `set({ envelope })`). */
  set(opts: { envelope?: Partial<EnvelopeShape> }): this {
    if (opts.envelope) Object.assign(this.envelope, opts.envelope);
    return this;
  }

  /** Play one note: `freq` Hz for `duration`, starting at `time` (Tone's
   *  clock; defaults to now), peaking at `velocity`. */
  triggerAttackRelease(freq: number, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity = 1): this {
    if (this.disposed) return this;
    const ctx = Tone.getContext();
    const start = time === undefined ? Tone.now() : seconds(time);
    this.reap(ctx.currentTime);
    if (!this.admit(start)) return this;
    const plan = planNote(this.envelope, start, seconds(duration), velocity, 1 / ctx.sampleRate);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const handoff = this.mono ? ctx.createGain() : null;
    osc.type = this.type;
    this.pitch(osc.frequency, freq, start);
    env.gain.value = 0;
    applyEvents(env.gain, plan.events);
    osc.connect(env);
    if (handoff) {
      env.connect(handoff);
      Tone.connect(handoff, this.output);
    } else {
      Tone.connect(env, this.output);
    }
    const note: LiveNote = { osc, env, handoff, start, stopAt: plan.stopAt };
    osc.onended = () => this.release(note);
    osc.start(start);
    osc.stop(plan.stopAt);
    this.live.push(note);
    return this;
  }

  /** Whether a note starting at `start` may sound; mono voices hand over. */
  protected abstract admit(start: number): boolean;
  /** True for one-note-at-a-time voices. */
  protected abstract readonly mono: boolean;

  /** Schedule the oscillator pitch for a note (a plain note holds it). The
   *  param's resting value is set too: a fresh oscillator otherwise renders
   *  its first samples at the 440 Hz default (Chrome reads the value before
   *  an event placed at the start), a stray blip at the head of every note. */
  protected pitch(freq: AudioParam, hz: number, start: number): void {
    freq.value = hz;
    freq.setValueAtTime(hz, start);
  }

  /** Fade every note still sounding at `at` out over the handoff time. */
  protected handOver(at: number): void {
    for (const n of this.live) {
      if (n.stopAt <= at || n.start >= at || !n.handoff) continue;
      n.handoff.gain.setValueAtTime(1, at);
      n.handoff.gain.linearRampToValueAtTime(0, at + MONO_HANDOFF_S);
      n.stopAt = at + MONO_HANDOFF_S;
      n.osc.stop(n.stopAt);
    }
  }

  /** Drop notes long finished whose `onended` never arrived. */
  private reap(now: number): void {
    for (const n of this.live.slice()) if (n.stopAt + REAP_GRACE_S < now) this.release(n);
  }

  private release(note: LiveNote): void {
    const i = this.live.indexOf(note);
    if (i >= 0) this.live.splice(i, 1);
    note.osc.onended = null;
    for (const node of [note.osc, note.env, note.handoff]) {
      try {
        node?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  dispose(): this {
    this.disposed = true;
    for (const n of this.live.slice()) {
      try {
        n.osc.stop();
      } catch {
        /* never started or already stopped */
      }
      this.release(n);
    }
    this.output.dispose();
    return this;
  }
}

/** Many notes at once (Tone.PolySynth of Tone.Synth). */
export class LightPolySynth extends LightVoiceBase {
  maxPolyphony: number;
  protected readonly mono = false;

  constructor(opts: LightPolyOptions = {}) {
    super(SYNTH_DEFAULTS, opts);
    this.maxPolyphony = opts.maxPolyphony ?? POLY_MAX;
  }

  protected admit(start: number): boolean {
    let sounding = 0;
    for (const n of this.live) if (n.stopAt > start) sounding++;
    return sounding < this.maxPolyphony;
  }
}

/** The pitch of a mono voice's current note, for glides scheduled after the
 *  trigger (the bloop's swoop, the tick's knock, the riser): each call lands
 *  on the oscillator of the note most recently triggered. */
export interface GlideControl {
  cancelScheduledValues(time: number): GlideControl;
  setValueAtTime(value: number, time: number): GlideControl;
  linearRampToValueAtTime(value: number, time: number): GlideControl;
  exponentialRampToValueAtTime(value: number, time: number): GlideControl;
}

/** One note at a time (Tone.Synth). */
export class LightMonoSynth extends LightVoiceBase {
  protected readonly mono = true;
  readonly frequency: GlideControl;

  constructor(opts: LightVoiceOptions = {}, defaults: VoiceDefaults = SYNTH_DEFAULTS) {
    super(defaults, opts);
    const current = (): AudioParam | null => this.live[this.live.length - 1]?.osc.frequency ?? null;
    const glide: GlideControl = {
      cancelScheduledValues: (t) => (current()?.cancelScheduledValues(t), glide),
      setValueAtTime: (v, t) => (current()?.setValueAtTime(v, t), glide),
      linearRampToValueAtTime: (v, t) => (current()?.linearRampToValueAtTime(v, t), glide),
      exponentialRampToValueAtTime: (v, t) => (current()?.exponentialRampToValueAtTime(v, t), glide),
    };
    this.frequency = glide;
  }

  protected admit(start: number): boolean {
    this.handOver(start);
    return true;
  }
}

/** A struck membrane (Tone.MembraneSynth): a mono note whose pitch glides
 *  from `freq * octaves` onto the note over `pitchDecay` seconds. */
export class LightMembraneSynth extends LightMonoSynth {
  private readonly octaves: number;
  private readonly pitchDecay: number;

  constructor(opts: LightMembraneOptions = {}) {
    super(opts, MEMBRANE_DEFAULTS);
    this.octaves = opts.octaves ?? MEMBRANE_OCTAVES;
    this.pitchDecay = opts.pitchDecay ?? MEMBRANE_PITCH_DECAY;
  }

  protected pitch(freq: AudioParam, hz: number, start: number): void {
    freq.value = hz * this.octaves;
    freq.setValueAtTime(hz * this.octaves, start);
    freq.exponentialRampToValueAtTime(hz, start + this.pitchDecay);
  }
}
