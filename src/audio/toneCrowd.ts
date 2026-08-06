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
/** Crowd factors below this read as "nobody there": the scene stays silent
 *  (the GDD's occupancy rule). */
const EMPTY_CROWD = 0.05;
/** A scene key must win this many consecutive updates before the layer
 *  switches, so a mixed floor (cinema beside a party hall) cannot churn the
 *  programs while the camera pans. Mute bypasses it. */
const KEY_SETTLE_UPDATES = 2;

interface TalkerSlot {
  gain: Tone.Gain;
  semi: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
}

export class CrowdLayer {
  private master: Tone.Gain | null = null;
  private murmurFilter: Tone.Filter | null = null;
  /** Applies each scene's murmur level (the hotel whispers, the lobby talks). */
  private murmurGain: Tone.Gain | null = null;
  private toneGain: Tone.Gain | null = null;
  private pingSynth: Tone.PolySynth | null = null;
  private thudSynth: Tone.PolySynth | null = null;
  private noiseSynth: Tone.NoiseSynth | null = null;
  private noiseFilter: Tone.Filter | null = null;
  /** The street's 65/98 Hz city hum, breathing on its own slow swell. */
  private humGain: Tone.Gain | null = null;
  private humLow: Tone.Oscillator | null = null;
  private humHigh: Tone.Oscillator | null = null;
  private humLfo: Tone.LFO | null = null;
  private voices: CrowdVoices | null = null;
  private party: PartyBand | null = null;
  private cinema: CinemaProgram | null = null;
  private metro: MetroProgram | null = null;

  private slots: TalkerSlot[] = [];
  private elementTimers = new Set<ReturnType<typeof setTimeout>>();
  private scene: CrowdSceneKey | null = null;
  private pendingKey: CrowdSceneKey | null = null;
  private pendingCount = 0;
  private programOn = false;
  private activity = 0;
  private tick = 1;
  private disposed = false;

  constructor(dest: Tone.InputNode, seedBaseUrl: string) {
    try {
      this.master = new Tone.Gain(0).connect(dest);
      // Every voiced sound passes a steep filter (the audition rule: nothing
      // bright survives; noise never reads as static), then the per-scene
      // murmur level.
      this.murmurGain = new Tone.Gain(0.4).connect(this.master);
      this.murmurFilter = new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -48 }).connect(
        this.murmurGain,
      );
      this.toneGain = new Tone.Gain(0.8).connect(this.master);
      this.pingSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 },
      }).connect(this.toneGain);
      this.pingSynth.volume.value = -10;
      this.pingSynth.maxPolyphony = 8;
      this.thudSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.006, decay: 0.09, sustain: 0, release: 0.08 },
      }).connect(this.toneGain);
      this.thudSynth.volume.value = -8;
      this.thudSynth.maxPolyphony = 8;
      this.noiseFilter = new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -48 }).connect(
        this.toneGain,
      );
      this.noiseSynth = new Tone.NoiseSynth({
        noise: { type: "pink" },
        envelope: { attack: 0.004, decay: 0.1, sustain: 0 },
      }).connect(this.noiseFilter);
      this.noiseSynth.volume.value = -16;
      // The street hum: two well-separated sines breathing on a slow swell.
      this.humGain = new Tone.Gain(0).connect(this.master);
      this.humLfo = new Tone.LFO({ frequency: 0.08, min: 0.55, max: 1 });
      const humSwell = new Tone.Gain(1).connect(this.humGain);
      this.humLfo.connect(humSwell.gain);
      this.humLfo.start();
      this.humLow = new Tone.Oscillator({ frequency: 65, type: "sine", volume: -18 }).connect(humSwell);
      this.humHigh = new Tone.Oscillator({ frequency: 98, type: "sine", volume: -24 }).connect(humSwell);
      this.humLow.start();
      this.humHigh.start();
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
   *  swap generators on a (settled) change, and retune levels every call. */
  update(scene: Scene, focus: ViewFocus, detail: number, muted: boolean): void {
    if (this.disposed || !this.master) return;
    try {
      const rawKey = muted ? null : resolveCrowdScene(scene, focus.dominant);
      // Settle the key across a couple of updates so a mixed floor can't
      // churn programs while panning; mute switches immediately.
      if (rawKey !== this.scene) {
        if (muted || rawKey === null) {
          this.switchScene(rawKey);
        } else if (rawKey === this.pendingKey) {
          if (++this.pendingCount >= KEY_SETTLE_UPDATES) this.switchScene(rawKey);
        } else {
          this.pendingKey = rawKey;
          this.pendingCount = 1;
        }
      } else {
        this.pendingKey = null;
        this.pendingCount = 0;
      }
      const key = this.scene;
      if (!key) {
        this.master.gain.rampTo(0, 0.5);
        this.activity = 0;
        return;
      }
      const spec = CROWD_SCENES[key];
      const hour = Number.isFinite(focus.hour) ? focus.hour : 12;
      const rawCrowd = Number.isFinite(focus.crowd) ? focus.crowd : 0.5;
      let crowd: number;
      if (spec.gate === "attendance") crowd = rawCrowd < EMPTY_CROWD ? 0 : rawCrowd;
      else crowd = Math.max(rawCrowd, spec.crowdFloor ?? 0);
      this.activity = hourActivity(spec.gate, hour) * (crowd < EMPTY_CROWD ? 0 : crowd);
      // Honest loudness: the layer level scales with activity (clock times
      // occupancy) as well as zoom, so a near-empty room is near-silent. The
      // activity term is square-rooted: loudness perception is logarithmic,
      // and a linear scale read as dead below half fill (the owner heard
      // "just a hum" over lightly-visited venues), the same fallacy the
      // perceptual volume sliders fixed. Empty stays exactly zero.
      this.master.gain.rampTo(
        this.activity <= 0
          ? 0
          : LAYER_LEVEL * (0.38 + 0.62 * detail) * Math.sqrt(Math.min(1, this.activity)),
        0.5,
      );
      this.humGain?.gain.rampTo(key === "outside" && this.activity > 0 ? 0.5 : 0, 1.2);
      if (spec.murmur) {
        this.murmurFilter?.frequency.rampTo(spec.murmur.muffleHz, 0.4);
        this.murmurGain?.gain.rampTo(spec.murmur.gain, 0.4);
        // Talkers = round(maxTalkers * crowd), floored at ONE while the room
        // is live: a couple eating in a big restaurant is still a quiet
        // conversation, not silence (rounding 3 talkers * 0.14 fill to zero
        // muted every lightly-visited venue). Empty rooms still fall fully
        // silent through the activity gate above, so the honest-rooms rule
        // holds: no people, no voices.
        const want =
          this.activity <= 0
            ? 0
            : Math.max(1, Math.round(spec.murmur.maxTalkers * Math.min(1, crowd)));
        for (let i = 0; i < this.slots.length; i++) {
          this.setSlotActive(i, this.activity > 0 && i < want, key);
        }
      }
      // Venue programs run only while the venue is actually live (a show or
      // party in progress), not merely while the empty hall is on screen.
      if (spec.program) {
        const shouldRun = this.activity > 0;
        if (shouldRun !== this.programOn) {
          this.programOn = shouldRun;
          const program = this.programFor(spec.program);
          if (shouldRun) program?.start();
          else program?.stop();
        }
      }
    } catch {
      /* transient audio error: recover on the next update */
    }
  }

  /** Tear down the old scene's generators and start the new one's. */
  private switchScene(key: CrowdSceneKey | null): void {
    this.pendingKey = null;
    this.pendingCount = 0;
    for (const t of this.elementTimers) clearTimeout(t);
    this.elementTimers.clear();
    for (let i = 0; i < this.slots.length; i++) this.setSlotActive(i, false, key ?? "lobby");
    const oldProgram = this.scene ? CROWD_SCENES[this.scene].program : undefined;
    if (oldProgram && this.programOn) this.programFor(oldProgram)?.stop();
    this.programOn = false;
    this.scene = key;
    if (!key) return;
    for (const el of CROWD_SCENES[key].elements) this.scheduleElement(key, el);
    if (key === "partyHall") this.schedulePartyVoices(key);
  }

  private programFor(name: "party" | "cinema" | "metro"): PartyBand | CinemaProgram | MetroProgram | null {
    switch (name) {
      case "party":
        return this.party;
      case "cinema":
        return this.cinema;
      default:
        return this.metro;
    }
  }

  /** Start or stop one talker slot's phrase loop. */
  private setSlotActive(i: number, active: boolean, key: CrowdSceneKey): void {
    const slot = this.slots[i];
    if (slot.active === active) {
      // A loop that bailed out (activity dipped to zero mid-phrase) marks
      // itself inactive; nothing to do here unless the timer also died while
      // the flag stayed set, which the bail-out paths prevent.
      return;
    }
    slot.active = active;
    if (!active) {
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      return;
    }
    const spec = CROWD_SCENES[key].murmur;
    slot.semi =
      spec?.semi ??
      PITCH_MAX_SEMI + (PITCH_MIN_SEMI - PITCH_MAX_SEMI) * pseudo(this.tick++ * 40503 + i * 13);
    const loop = (): void => {
      slot.timer = null;
      // Every bail-out clears the active flag so update() can restart the
      // loop cleanly when the scene comes back to life.
      if (this.disposed || !slot.active || this.scene !== key || this.activity <= 0) {
        slot.active = false;
        return;
      }
      const murmur = CROWD_SCENES[key].murmur;
      if (!murmur) {
        slot.active = false;
        return;
      }
      const wall = this.voices?.phrase(slot.gain, slot.semi, this.tick++) ?? null;
      const pause = murmur.pauseMin + murmur.pauseVar * pseudo(this.tick++ * 22695477 + i);
      slot.timer = setTimeout(loop, ((wall ?? 0.8) + pause) * 1000);
    };
    slot.timer = setTimeout(loop, pseudo(this.tick++ * 19349663 + i) * 1500);
  }

  /** Run one element spec's irregular firing loop: typing-style clusters,
   *  paired notes, and gaps stretched by low activity (a 20 percent full
   *  restaurant clinks a fifth as often, per the GDD's linear scaling). */
  private scheduleElement(key: CrowdSceneKey, el: ElementSpec): void {
    let clusterLeft = 0;
    const draw = (min: number, varS: number, salt: number): number =>
      min + varS * pseudo(this.tick++ * 2654435761 + salt);
    const loop = (): void => {
      if (this.disposed || this.scene !== key) return;
      let gap: number;
      if (this.activity > 0) {
        if (el.cluster && clusterLeft <= 0) {
          clusterLeft =
            el.cluster.min +
            Math.floor(pseudo(this.tick++ * 40503) * (el.cluster.max - el.cluster.min + 1));
        }
        this.fireElement(el);
        if (el.cluster) clusterLeft--;
        const inCluster = el.cluster !== undefined && clusterLeft > 0;
        const base = inCluster
          ? draw(el.rateMin, el.rateVar, 1)
          : el.cluster
            ? draw(el.cluster.pauseMin, el.cluster.pauseVar, 3)
            : draw(el.rateMin, el.rateVar, 1);
        gap = base / Math.max(0.2, Math.min(1, this.activity));
      } else {
        // Gated-off scene in view (an office at night): idle slowly instead of
        // polling at keystroke rate, and let any cluster finish later.
        clusterLeft = 0;
        gap = Math.max(2, el.cluster ? draw(el.cluster.pauseMin, el.cluster.pauseVar, 3) : draw(el.rateMin, el.rateVar, 1));
      }
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
      const attack = el.attack ?? 0.004;
      if (el.kind === "burst") {
        // Envelope follows the spec so a page turn is a swish, not a click,
        // and the filter glides (a snap under a live tail crackles).
        this.noiseSynth?.set({ envelope: { attack, decay: Math.max(0.05, el.dur - attack), sustain: 0 } });
        this.noiseFilter?.frequency.rampTo(freq, 0.02);
        this.noiseSynth?.triggerAttackRelease(el.dur, now + 0.02, gain * 4);
        return;
      }
      const synth = el.kind === "ping" ? this.pingSynth : this.thudSynth;
      synth?.set({ envelope: { attack, decay: Math.max(0.06, el.dur - attack), sustain: 0 } });
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
    const nodes = [
      this.pingSynth, this.thudSynth, this.noiseSynth, this.noiseFilter,
      this.humLow, this.humHigh, this.humLfo, this.humGain,
      this.toneGain, this.murmurFilter, this.murmurGain, this.master,
    ];
    for (const n of nodes) {
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
    this.humLow = this.humHigh = null;
    this.humLfo = null;
    this.humGain = null;
    this.toneGain = this.murmurGain = this.master = null;
  }
}
