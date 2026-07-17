import * as Tone from "tone";
import type { ViewFocus } from "../render/excalibur/TowerEngine";
import type { Scene } from "./toneScenes";
import {
  CROWD_SCENES,
  resolveCrowdScene,
  hourActivity,
  pseudo,
  PITCH_MIN_SEMI,
  PITCH_MAX_SEMI,
  type CrowdSceneKey,
  type ElementSpec,
} from "./toneCrowdData";
import { CrowdVoices } from "./toneCrowdVoices";
import { PartyBand, CinemaProgram, MetroProgram } from "./toneCrowdPrograms";

/**
 * The crowd/venue ambience layer: talkers murmuring from the voice seeds,
 * per-scene one-shot details, and the composed venue programs, all mixed into
 * the engine's distance-filtered bed so camera zoom muffles and opens it
 * naturally. {@link ToneAudioEngine} feeds it the resolved scene and focus at
 * its update cadence; everything else (which sounds, how many, how often, how
 * loud) follows the specs in `./toneCrowdData.ts` scaled by live occupancy,
 * the sim clock, and zoom. Scheduling runs on short timers seeded by the
 * deterministic hash, so no Math.random and no fixed loops.
 */

/** How often a party crowd laughs and whoops, seconds (min plus a draw). */
const LAUGH_GAP_S = { min: 18, varS: 22 };
const WHOOP_GAP_S = { min: 22, varS: 24 };
/** Layer master at full detail; the whole layer sits under the music bed. */
const LAYER_LEVEL = 0.5;
/** Crowd factors below this read as "nobody there": the scene stays silent. */
const EMPTY_CROWD = 0.03;

interface TalkerSlot {
  gain: Tone.Gain;
  semi: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
}

export class CrowdLayer {
  private master: Tone.Gain | null = null;
  private murmurFilter: Tone.Filter | null = null;
  private toneGain: Tone.Gain | null = null;
  private pingSynth: Tone.PolySynth | null = null;
  private thudSynth: Tone.PolySynth | null = null;
  private noiseSynth: Tone.NoiseSynth | null = null;
  private noiseFilter: Tone.Filter | null = null;
  private voices: CrowdVoices | null = null;
  private party: PartyBand | null = null;
  private cinema: CinemaProgram | null = null;
  private metro: MetroProgram | null = null;

  private slots: TalkerSlot[] = [];
  private elementTimers = new Set<ReturnType<typeof setTimeout>>();
  private scene: CrowdSceneKey | null = null;
  private activity = 0;
  private tick = 1;
  private disposed = false;

  constructor(dest: Tone.InputNode, seedBaseUrl: string) {
    try {
      this.master = new Tone.Gain(0).connect(dest);
      // Every voiced and one-shot sound passes a steep filter (the audition
      // rule: nothing bright survives; noise never reads as static).
      this.murmurFilter = new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -48 }).connect(
        this.master,
      );
      this.toneGain = new Tone.Gain(0.8).connect(this.master);
      this.pingSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 },
      }).connect(this.toneGain);
      this.pingSynth.volume.value = -10;
      this.thudSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.006, decay: 0.09, sustain: 0, release: 0.08 },
      }).connect(this.toneGain);
      this.thudSynth.volume.value = -8;
      this.noiseFilter = new Tone.Filter({ type: "lowpass", frequency: 1400, rolloff: -48 }).connect(
        this.toneGain,
      );
      this.noiseSynth = new Tone.NoiseSynth({
        noise: { type: "pink" },
        envelope: { attack: 0.004, decay: 0.1, sustain: 0 },
      }).connect(this.noiseFilter);
      this.noiseSynth.volume.value = -16;
      for (let i = 0; i < 6; i++) {
        const gain = new Tone.Gain(0.5).connect(this.murmurFilter);
        this.slots.push({ gain, semi: PITCH_MAX_SEMI, timer: null, active: false });
      }
      this.voices = new CrowdVoices();
      this.voices.load(seedBaseUrl);
      this.party = new PartyBand(this.master);
      this.cinema = new CinemaProgram(this.master);
      this.metro = new MetroProgram(this.master);
    } catch {
      this.dispose();
    }
  }

  /** Drive the layer from the engine's update: resolve the ambience scene,
   *  swap generators on a change, and retune levels every call. */
  update(scene: Scene, focus: ViewFocus, detail: number, muted: boolean): void {
    if (this.disposed || !this.master) return;
    try {
      const key = muted ? null : resolveCrowdScene(scene, focus.dominant);
      if (key !== this.scene) this.switchScene(key);
      if (!key) {
        this.master.gain.rampTo(0, 0.5);
        this.activity = 0;
        return;
      }
      const spec = CROWD_SCENES[key];
      const hour = Number.isFinite(focus.hour) ? focus.hour : 12;
      const rawCrowd = Number.isFinite(focus.crowd) ? focus.crowd : 0.5;
      const crowd =
        spec.gate === "attendance"
          ? rawCrowd < EMPTY_CROWD
            ? 0
            : rawCrowd
          : Math.max(rawCrowd, spec.crowdFloor ?? 0);
      this.activity = hourActivity(spec.gate, hour) * (crowd < EMPTY_CROWD ? 0 : crowd);
      this.master.gain.rampTo(
        this.activity <= 0 ? 0 : LAYER_LEVEL * (0.38 + 0.62 * detail),
        0.5,
      );
      if (spec.murmur) {
        this.murmurFilter?.frequency.rampTo(spec.murmur.muffleHz, 0.4);
        const want = this.activity <= 0 ? 0 : Math.max(1, Math.round(spec.murmur.maxTalkers * Math.min(1, this.activity)));
        for (let i = 0; i < this.slots.length; i++) this.setSlotActive(i, this.activity > 0 && i < want, key);
      }
    } catch {
      /* transient audio error: recover on the next update */
    }
  }

  /** Tear down the old scene's generators and start the new one's. */
  private switchScene(key: CrowdSceneKey | null): void {
    for (const t of this.elementTimers) clearTimeout(t);
    this.elementTimers.clear();
    for (let i = 0; i < this.slots.length; i++) this.setSlotActive(i, false, key ?? "lobby");
    const oldProgram = this.scene ? CROWD_SCENES[this.scene].program : undefined;
    const newProgram = key ? CROWD_SCENES[key].program : undefined;
    if (oldProgram && oldProgram !== newProgram) this.programFor(oldProgram)?.stop();
    this.scene = key;
    if (!key) return;
    if (newProgram && newProgram !== oldProgram) this.programFor(newProgram)?.start();
    for (const el of CROWD_SCENES[key].elements) this.scheduleElement(key, el);
    if (key === "partyHall") this.schedulePartyVoices(key);
  }

  private programFor(name: "party" | "cinema" | "metro"): PartyBand | CinemaProgram | MetroProgram | null {
    return name === "party" ? this.party : name === "cinema" ? this.cinema : this.metro;
  }

  /** Start or stop one talker slot's phrase loop. */
  private setSlotActive(i: number, active: boolean, key: CrowdSceneKey): void {
    const slot = this.slots[i];
    if (slot.active === active) return;
    slot.active = active;
    if (!active) {
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      return;
    }
    slot.semi =
      PITCH_MAX_SEMI + (PITCH_MIN_SEMI - PITCH_MAX_SEMI) * pseudo(this.tick++ * 40503 + i * 13);
    const loop = (): void => {
      slot.timer = null;
      if (this.disposed || !slot.active || this.scene !== key || this.activity <= 0) return;
      const spec = CROWD_SCENES[key].murmur;
      if (!spec) return;
      const wall = this.voices?.phrase(slot.gain, slot.semi, this.tick++) ?? null;
      const pause = spec.pauseMin + spec.pauseVar * pseudo(this.tick++ * 22695477 + i);
      slot.timer = setTimeout(loop, ((wall ?? 0.8) + pause) * 1000);
    };
    slot.timer = setTimeout(loop, pseudo(this.tick++ * 19349663 + i) * 1500);
  }

  /** Run one element spec's irregular firing loop (with typing clusters and
   *  paired notes where the spec asks). */
  private scheduleElement(key: CrowdSceneKey, el: ElementSpec): void {
    let clusterLeft = 0;
    const loop = (): void => {
      if (this.disposed || this.scene !== key) return;
      if (this.activity > 0) {
        this.fireElement(el);
        if (el.cluster) {
          clusterLeft = clusterLeft > 0 ? clusterLeft - 1 : el.cluster.min + Math.floor(pseudo(this.tick++ * 40503) * (el.cluster.max - el.cluster.min));
        }
      }
      const inCluster = el.cluster && clusterLeft > 0;
      const gap = inCluster
        ? el.rateMin + el.rateVar * pseudo(this.tick++ * 2654435761)
        : el.cluster
          ? el.cluster.pauseMin + el.cluster.pauseVar * pseudo(this.tick++ * 2246822519)
          : el.rateMin + el.rateVar * pseudo(this.tick++ * 2654435761);
      const timer = setTimeout(() => {
        this.elementTimers.delete(timer);
        loop();
      }, gap * 1000);
      this.elementTimers.add(timer);
    };
    const first = setTimeout(() => {
      this.elementTimers.delete(first);
      loop();
    }, pseudo(this.tick++ * 19349663) * 2000);
    this.elementTimers.add(first);
  }

  private fireElement(el: ElementSpec): void {
    try {
      const freq = el.freqMin + (el.freqMax - el.freqMin) * pseudo(this.tick++ * 40503 + 5);
      const gain = el.gainMin + (el.gainMax - el.gainMin) * pseudo(this.tick++ * 22695477 + 9);
      const now = Tone.now();
      if (el.kind === "burst") {
        if (this.noiseFilter) this.noiseFilter.frequency.value = freq;
        this.noiseSynth?.triggerAttackRelease(el.dur, now, gain * 4);
        return;
      }
      const synth = el.kind === "ping" ? this.pingSynth : this.thudSynth;
      synth?.triggerAttackRelease(freq, el.dur, now, gain * 3);
      if (el.pair) {
        synth?.triggerAttackRelease(freq * el.pair.ratio, el.dur, now + el.pair.delayS, gain * 3 * el.pair.gainScale);
      }
    } catch {
      /* skip this detail */
    }
  }

  /** While the party runs: the owner's laughs and voice-bent whoops, spaced
   *  far apart so they land as moments, not a loop. */
  private schedulePartyVoices(key: CrowdSceneKey): void {
    const slotGain = this.slots[0]?.gain;
    if (!slotGain) return;
    const arm = (gap: { min: number; varS: number }, fire: () => void): void => {
      const timer = setTimeout(
        () => {
          this.elementTimers.delete(timer);
          if (this.disposed || this.scene !== key) return;
          if (this.activity > 0) fire();
          arm(gap, fire);
        },
        (gap.min + gap.varS * pseudo(this.tick++ * 2654435761)) * 1000,
      );
      this.elementTimers.add(timer);
    };
    arm(LAUGH_GAP_S, () => this.voices?.laugh(slotGain, this.tick++));
    arm(WHOOP_GAP_S, () => this.voices?.whoop(slotGain, this.tick++));
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.elementTimers) clearTimeout(t);
    this.elementTimers.clear();
    for (const slot of this.slots) {
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      try {
        slot.gain.dispose();
      } catch {
        /* already gone */
      }
    }
    this.slots = [];
    this.voices?.dispose();
    this.party?.dispose();
    this.cinema?.dispose();
    this.metro?.dispose();
    for (const n of [this.pingSynth, this.thudSynth, this.noiseSynth, this.noiseFilter, this.toneGain, this.murmurFilter, this.master]) {
      try {
        n?.dispose();
      } catch {
        /* already gone */
      }
    }
    this.voices = null;
    this.party = null;
    this.cinema = null;
    this.metro = null;
    this.pingSynth = this.thudSynth = null;
    this.noiseSynth = null;
    this.noiseFilter = this.murmurFilter = null;
    this.toneGain = this.master = null;
  }
}
