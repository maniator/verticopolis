import * as Tone from "tone";
import { midiToFreq } from "./toneScenes";
import {
  PARTY_BPM,
  PARTY_BASS_ROOTS,
  partyHookEvents,
  CINEMA_PLUCKS,
  CINEMA_RISER,
  CINEMA_BOOM_HZ,
  trainEvent,
  TRAIN_INTERVAL_S,
  pseudo,
} from "./toneCrowdData";

/**
 * The composed venue programs of the crowd layer: the party hall's
 * through-the-wall remix of the game's own hook, the cinema's plucked score
 * with riser-booms, and the metro's train arrival/departure event. Each owns
 * its voices and its steep muffle filter, exposes start/stop/dispose, and
 * never throws into the caller (a program glitch mutes that program, nothing
 * else). {@link CrowdLayer} decides when each runs.
 */

interface Program {
  start(): void;
  stop(): void;
  dispose(): void;
}

/** Shared guard: run `fn`, swallowing any Tone error. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* program glitch: skip */
  }
}

/** The party next door: kick, backbeat thud, bouncing bass, stabs, and the
 *  splash hook, all behind a steep 1150 Hz wall filter. */
export class PartyBand implements Program {
  private wall: Tone.Filter;
  private gain: Tone.Gain;
  private kick: Tone.MembraneSynth;
  private thud: Tone.Synth;
  private bass: Tone.Synth;
  private stabs: Tone.PolySynth;
  private hook: Tone.PolySynth;
  private part: Tone.Part | null = null;

  constructor(dest: Tone.InputNode) {
    this.gain = new Tone.Gain(0);
    this.wall = new Tone.Filter({ type: "lowpass", frequency: 1150, rolloff: -48 }).connect(
      this.gain,
    );
    this.gain.connect(dest);
    this.kick = new Tone.MembraneSynth({ octaves: 4, pitchDecay: 0.04 }).connect(this.wall);
    this.kick.volume.value = -6;
    this.thud = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.06, sustain: 0, release: 0.05 },
    }).connect(this.wall);
    this.thud.volume.value = -14;
    this.bass = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.006, decay: 0.1, sustain: 0.2, release: 0.08 },
    }).connect(this.wall);
    this.bass.volume.value = -10;
    this.stabs = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0, release: 0.07 },
    }).connect(this.wall);
    this.stabs.volume.value = -18;
    this.hook = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.1, release: 0.2 },
    }).connect(this.wall);
    this.hook.volume.value = -10;
  }

  /** One 4-bar loop of band events, seconds-based so the global Transport
   *  tempo (owned by the music) never bends the party. */
  private buildEvents(): Array<{ t: number; voice: string; midi: number; dur: number }> {
    const beat = 60 / PARTY_BPM;
    const events: Array<{ t: number; voice: string; midi: number; dur: number }> = [];
    for (let n = 0; n < 16; n++) {
      const t = n * beat;
      const bar = Math.floor(n / 4);
      events.push({ t, voice: "kick", midi: 33, dur: 0.25 });
      if (n % 2 === 1) events.push({ t, voice: "thud", midi: 55, dur: 0.12 });
      const root = PARTY_BASS_ROOTS[bar];
      events.push({ t: t + beat * 0.5, voice: "bass", midi: root + (n % 2 ? 12 : 0), dur: beat * 0.45 });
      if (n % 2 === 0) {
        // A two-note chord stab (root and fifth above), not a lone note.
        events.push({ t: t + beat * 0.5, voice: "stab", midi: root + 26, dur: beat * 0.4 });
        events.push({ t: t + beat * 0.5, voice: "stab", midi: root + 33, dur: beat * 0.4 });
      }
    }
    for (const h of partyHookEvents()) events.push({ t: h.t, voice: "hook", midi: h.midi, dur: h.dur });
    return events;
  }

  start(): void {
    safe(() => {
      this.stop();
      const beat = 60 / PARTY_BPM;
      const part = new Tone.Part((time, ev) => {
        safe(() => {
          if (ev.voice === "kick") this.kick.triggerAttackRelease(midiToFreq(ev.midi), ev.dur, time, 0.9);
          else if (ev.voice === "thud") this.thud.triggerAttackRelease(210, ev.dur, time, 0.6);
          else if (ev.voice === "bass") this.bass.triggerAttackRelease(midiToFreq(ev.midi), ev.dur, time, 0.7);
          else if (ev.voice === "stab") this.stabs.triggerAttackRelease(midiToFreq(ev.midi), ev.dur, time, 0.35);
          else this.hook.triggerAttackRelease(midiToFreq(ev.midi), ev.dur, time, 0.5);
        });
      }, this.buildEvents().map((e) => [e.t, e] as [number, typeof e]));
      part.loop = true;
      part.loopEnd = 16 * beat;
      part.start(0);
      this.part = part;
      this.gain.gain.rampTo(0.6, 1.2);
    });
  }

  stop(): void {
    safe(() => this.gain.gain.rampTo(0, 0.8));
    safe(() => this.part?.stop());
    safe(() => this.part?.dispose());
    this.part = null;
  }

  dispose(): void {
    this.stop();
    for (const n of [this.kick, this.thud, this.bass, this.stabs, this.hook, this.wall, this.gain]) {
      safe(() => n.dispose());
    }
  }
}

/** The film through the door: sparse plucked arpeggio, and every so often a
 *  riser building into a boom with audible mid partials. */
export class CinemaProgram implements Program {
  private gain: Tone.Gain;
  private muffle: Tone.Filter;
  private plucks: Tone.PolySynth;
  private riser: Tone.Synth;
  private boom: Tone.PolySynth;
  private part: Tone.Part | null = null;
  private dramaTimer: ReturnType<typeof setTimeout> | null = null;
  private tick = 1;

  constructor(dest: Tone.InputNode) {
    this.gain = new Tone.Gain(0);
    this.muffle = new Tone.Filter({ type: "lowpass", frequency: 1000, rolloff: -48 }).connect(
      this.gain,
    );
    this.gain.connect(dest);
    this.plucks = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.7, sustain: 0, release: 0.6 },
    }).connect(this.muffle);
    this.plucks.volume.value = -10;
    this.riser = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: CINEMA_RISER.durS, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.muffle);
    this.riser.volume.value = -16;
    this.boom = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 0.4 },
    }).connect(this.muffle);
    this.boom.volume.value = -8;
  }

  start(): void {
    safe(() => {
      this.stop();
      const part = new Tone.Part(
        (time, ev) => safe(() => this.plucks.triggerAttackRelease(midiToFreq(ev.midi), 1.4, time, 0.5)),
        CINEMA_PLUCKS.map(([midi, at]) => [at, { t: at, midi }] as [number, { t: number; midi: number }]),
      );
      part.loop = true;
      part.loopEnd = 16;
      part.start(0);
      this.part = part;
      this.gain.gain.rampTo(0.55, 1.2);
      this.scheduleDrama();
    });
  }

  /** Every 8-14 s: riser sweeping up, then the boom. */
  private scheduleDrama(): void {
    const wait = (8 + 6 * pseudo(this.tick++ * 40503)) * 1000;
    this.dramaTimer = setTimeout(() => {
      safe(() => {
        const now = Tone.now();
        this.riser.frequency.setValueAtTime(CINEMA_RISER.fromHz, now);
        this.riser.frequency.linearRampToValueAtTime(CINEMA_RISER.toHz, now + CINEMA_RISER.durS);
        this.riser.triggerAttackRelease(CINEMA_RISER.fromHz, CINEMA_RISER.durS, now, 0.5);
        const boomAt = now + CINEMA_RISER.durS + 0.05;
        for (const hz of CINEMA_BOOM_HZ) this.boom.triggerAttackRelease(hz, 1.2, boomAt, hz < 100 ? 0.8 : 0.4);
      });
      this.scheduleDrama();
    }, wait);
  }

  stop(): void {
    if (this.dramaTimer !== null) clearTimeout(this.dramaTimer);
    this.dramaTimer = null;
    safe(() => this.gain.gain.rampTo(0, 0.8));
    safe(() => this.part?.stop());
    safe(() => this.part?.dispose());
    this.part = null;
  }

  dispose(): void {
    this.stop();
    for (const n of [this.plucks, this.riser, this.boom, this.muffle, this.gain]) {
      safe(() => n.dispose());
    }
  }
}

/** The train: a scripted arrival/idle/departure event that repeats while the
 *  platform stays in view, over whatever the layer's platform murmur does. */
export class MetroProgram implements Program {
  private gain: Tone.Gain;
  private thumps: Tone.PolySynth;
  private brake: Tone.Synth;
  private rumble: Tone.Noise;
  private rumbleFilter: Tone.Filter;
  private rumbleGain: Tone.Gain;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick = 1;

  constructor(dest: Tone.InputNode) {
    this.gain = new Tone.Gain(0);
    this.gain.connect(dest);
    this.thumps = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.006, decay: 0.06, sustain: 0, release: 0.05 },
    }).connect(this.gain);
    this.thumps.volume.value = -8;
    this.brake = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.5, sustain: 0, release: 0.3 },
    }).connect(this.gain);
    this.brake.volume.value = -18;
    // The rumble is the one broadband source here, and it obeys the noise
    // rule: steep lowpass at 140 Hz, seated low, swelled by its own gain.
    this.rumbleGain = new Tone.Gain(0).connect(this.gain);
    this.rumbleFilter = new Tone.Filter({ type: "lowpass", frequency: 140, rolloff: -48 }).connect(
      this.rumbleGain,
    );
    this.rumble = new Tone.Noise("brown").connect(this.rumbleFilter);
    this.rumble.volume.value = -6;
  }

  start(): void {
    safe(() => {
      this.stop();
      this.gain.gain.rampTo(0.6, 1);
      this.rumble.start();
      this.scheduleTrain(4 + 6 * pseudo(this.tick++ * 22695477));
    });
  }

  private scheduleTrain(delayS: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.runEvent();
      this.scheduleTrain(TRAIN_INTERVAL_S * (0.8 + 0.4 * pseudo(this.tick++ * 19349663)));
    }, delayS * 1000);
    this.timers.add(timer);
  }

  /** Play the whole scripted event via short timers off the event start. */
  private runEvent(): void {
    let doorNum = 0;
    for (const step of trainEvent()) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        safe(() => {
          const now = Tone.now();
          if (step.kind === "daDum") {
            this.thumps.triggerAttackRelease(58, 0.16, now, step.gain);
            this.thumps.triggerAttackRelease(64, 0.14, now + 0.11, step.gain * 0.8);
            this.thumps.triggerAttackRelease(130, 0.07, now + 0.005, step.gain * 0.35);
          } else if (step.kind === "rumbleIn") {
            this.rumbleGain.gain.rampTo(0.5, 4.5);
          } else if (step.kind === "rumbleOut") {
            this.rumbleGain.gain.rampTo(0.4, 1.5);
            const fade = setTimeout(() => {
              this.timers.delete(fade);
              safe(() => this.rumbleGain.gain.rampTo(0, 3.2));
            }, 1800);
            this.timers.add(fade);
          } else if (step.kind === "brake") {
            this.brake.frequency.setValueAtTime(180, now);
            this.brake.frequency.linearRampToValueAtTime(120, now + 1);
            this.brake.triggerAttackRelease(180, 1, now, step.gain);
          } else {
            // The two door thunks land at 95 then 88 Hz, per the spec.
            this.thumps.triggerAttackRelease(doorNum++ % 2 === 0 ? 95 : 88, 0.3, now, step.gain);
          }
        });
      }, step.at * 1000);
      this.timers.add(timer);
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    safe(() => this.gain.gain.rampTo(0, 0.8));
    safe(() => this.rumbleGain.gain.rampTo(0, 0.4));
    safe(() => this.rumble.stop());
  }

  dispose(): void {
    this.stop();
    for (const n of [this.thumps, this.brake, this.rumble, this.rumbleFilter, this.rumbleGain, this.gain]) {
      safe(() => n.dispose());
    }
  }
}
