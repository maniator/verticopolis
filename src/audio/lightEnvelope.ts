/**
 * The amplitude envelope of one light note, planned as Web Audio automation
 * events (see `./lightSynth.ts`). Every curve here is the one Tone.js's own
 * Envelope schedules for a fresh note, so a light voice sounds the same as
 * the Tone.Synth it replaced:
 *
 * - attack: a linear ramp from silence to the velocity (or, for the membrane
 *   voices, Tone's "exponential" attack: an exponential approach that turns
 *   into a short linear ramp for its last tenth);
 * - decay: an exponential approach to `velocity * sustain` whose last tenth is
 *   a linear ramp, so it lands exactly;
 * - release: the same approach-then-ramp shape down to zero, starting from
 *   wherever the envelope is when the note is let go.
 *
 * Planning the whole note up front (instead of cancelling and re-scheduling
 * at the release, as Tone does) is what lets a note own two native nodes and
 * nothing else. The plan is pure data so it can be checked without audio.
 */

/** The envelope curve of a light voice, read when a note starts. */
export interface EnvelopeShape {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Tone's attack curve: linear for the synths, exponential for membranes. */
  attackCurve: "linear" | "exponential";
}

/** One automation call on an AudioParam, in the order it is made. */
export type ParamEvent =
  | { kind: "set"; value: number; time: number }
  | { kind: "linear"; value: number; time: number }
  | { kind: "target"; value: number; time: number; timeConstant: number };

/** A planned note: the gain automation and when its oscillator stops. */
export interface NotePlan {
  events: ParamEvent[];
  stopAt: number;
}

/** The level a ramp starts from instead of true zero (Tone's minimum output). */
const SILENT_FLOOR = 1e-7;
/** The share of an approach spent on the exponential curve before Tone hands
 *  over to a linear ramp that lands exactly on the target. */
const APPROACH_SHARE = 0.9;

/** Tone's time constant for an exponential approach lasting `rampTime` s. */
export function approachTimeConstant(rampTime: number): number {
  return Math.log(rampTime + 1) / Math.log(200);
}

/** Append Tone's exponential approach toward `target`, starting at `time`
 *  from the value the events reach there. */
function approach(events: ParamEvent[], target: number, time: number, rampTime: number): void {
  const timeConstant = approachTimeConstant(rampTime);
  events.push({ kind: "target", value: target, time, timeConstant });
  const handover = time + rampTime * APPROACH_SHARE;
  events.push({ kind: "set", value: valueAt(events, handover), time: handover });
  events.push({ kind: "linear", value: target, time: time + rampTime });
}

/** The value a list of events (made by this module) holds at `time`, with
 *  Web Audio's rules: a set holds, a linear ramp interpolates from the event
 *  before it, and a target decays from the value at its start. */
export function valueAt(events: readonly ParamEvent[], time: number): number {
  let value = 0;
  let from = 0;
  let fromTime = -Infinity;
  let target: { value: number; time: number; timeConstant: number; start: number } | null = null;
  for (const ev of events) {
    if (ev.time > time) {
      if (ev.kind === "linear") {
        const start = target ? targetValue(target, fromTime) : from;
        const span = ev.time - fromTime;
        return span > 0 ? start + ((ev.value - start) * (time - fromTime)) / span : ev.value;
      }
      break;
    }
    const before: number = target ? targetValue(target, ev.time) : value;
    if (ev.kind === "target") {
      target = { value: ev.value, time: ev.time, timeConstant: ev.timeConstant, start: before };
      value = before;
    } else {
      target = null;
      value = ev.value;
    }
    from = value;
    fromTime = ev.time;
  }
  return target ? targetValue(target, time) : value;
}

function targetValue(t: { value: number; time: number; timeConstant: number; start: number }, at: number): number {
  return t.value + (t.start - t.value) * Math.exp(-(at - t.time) / t.timeConstant);
}

/** The attack and decay of a note started at `start`, before any release. */
function attackAndDecay(env: EnvelopeShape, start: number, velocity: number, sampleTime: number): ParamEvent[] {
  const events: ParamEvent[] = [];
  if (env.attack < sampleTime) {
    events.push({ kind: "set", value: velocity, time: start });
  } else {
    events.push({ kind: "set", value: SILENT_FLOOR, time: start });
    if (env.attackCurve === "linear") events.push({ kind: "linear", value: velocity, time: start + env.attack });
    else approach(events, velocity, start, env.attack);
  }
  if (env.decay > 0 && env.sustain < 1) approach(events, velocity * env.sustain, start + env.attack, env.decay);
  return events;
}

/**
 * Plan one note: its gain automation from `start` and the time its
 * oscillator stops. The release begins at `start + duration` from the
 * envelope's level there.
 *
 * The stop time follows Tone's (a voice with no sustain stops when its decay
 * ends) with one deliberate difference: a note let go before its decay ended
 * stops when its release ends. Tone stopped it at the decay's end even when
 * the release tail was still sounding, a small cut that can click.
 */
export function planNote(
  env: EnvelopeShape,
  start: number,
  duration: number,
  velocity: number,
  sampleTime: number,
): NotePlan {
  const full = attackAndDecay(env, start, velocity, sampleTime);
  const releaseAt = start + Math.max(0, duration);
  const level = valueAt(full, releaseAt);
  // Keep what happens before the release; a ramp the release interrupts ends
  // where the envelope is at that moment, so the curve stays continuous.
  const events = full.filter((ev) => ev.time <= releaseAt);
  const cut = full.find((ev) => ev.time > releaseAt);
  if (cut?.kind === "linear") events.push({ kind: "linear", value: level, time: releaseAt });
  if (level <= 0) {
    // Nothing left to let go: the decay already reached silence (or the note
    // never had any level), so the oscillator stops where the sound ended.
    const decayEnd = start + env.attack + env.decay;
    return { events, stopAt: env.sustain === 0 ? Math.min(decayEnd, releaseAt) : releaseAt };
  }
  events.push({ kind: "set", value: level, time: releaseAt });
  if (env.release < sampleTime) {
    events.push({ kind: "set", value: 0, time: releaseAt });
    return { events, stopAt: releaseAt };
  }
  approach(events, 0, releaseAt, env.release);
  return { events, stopAt: releaseAt + env.release };
}
