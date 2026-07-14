import * as Tone from "tone";
import type { ViewFocus } from "../render/excalibur/TowerEngine";
import {
  SCENES,
  OVERVIEW_ZOOM,
  OVERVIEW_EXIT,
  sceneFor,
  detailFor,
  midiToFreq,
  clamp,
  lerp,
  sameNotes,
  type Scene,
  type SfxName,
} from "./toneScenes";
import { scheduleStep, maybeAccent, playSfx, type AccentNodes } from "./toneVoices";

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
 *
 * The scene tuning data and pure scene/zoom/pitch math live in `./toneScenes.ts`;
 * the melody, accent, and jingle synthesis routines live in `./toneVoices.ts`.
 * This class owns the live Tone graph, the lifecycle (start/dispose), and the
 * per-frame scene state.
 */

// Re-export the jingle name vocabulary from its new home so existing importers
// (the Audio facade, tests) keep resolving `SfxName` from this module.
export type { SfxName };

export class ToneAudioEngine {
  // Master + shared effect chain.
  private master: Tone.Gain | null = null;
  /** Player-set music & ambience level: everything except the action jingles
   *  (the whole reverb bed plus accents and rain) flows through this bus. */
  private musicBus: Tone.Gain | null = null;
  /** Player-set effects level: the one-shot action jingles only. */
  private sfxBus: Tone.Gain | null = null;
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
  /** Caps the rain band's top end so it reads as rainfall rather than hiss. */
  private rainTone: Tone.Filter | null = null;
  /** Slow gust swell on the rain bed (an LFO breathes the level). */
  private rainSwell: Tone.Gain | null = null;
  private rainLfo: Tone.LFO | null = null;
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
  /** Player-set levels 0..1, kept even while the graph isn't built so start()
   *  can apply them; independent of `muted` (the master kill switch). */
  musicVolume = 1;
  sfxVolume = 1;
  started = false;

  /** Lazily create the audio graph. Must be called from a user gesture. */
  start(): void {
    if (this.started) {
      // Already built — but the context may have been suspended since (an
      // autoplay unlock that landed outside the gesture stack, or a backgrounded
      // tab). main.ts calls start() on every gesture, so re-attempt the resume
      // here: it's a no-op on a running context and recovers a silent one.
      void Tone.getContext().resume().catch(() => {});
      return;
    }
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

      // Player volume buses sit between the content and the master: music &
      // ambience on one, the action jingles on the other. The master keeps its
      // fixed 0.35 level (and the mute ramp); these two only scale within it.
      this.musicBus = new Tone.Gain(this.musicVolume).connect(this.master);
      this.sfxBus = new Tone.Gain(this.sfxVolume).connect(this.master);

      // Musical + ambient content flows through a lowpass whose cutoff tracks
      // zoom (far out = muffled, up close = present), then a gentle reverb so
      // scenes feel like rooms rather than oscillators.
      this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.musicBus);
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

      // Close-up accents (kept crisp: routed dry, not distance-filtered).
      // Held well below the music so they read as distant background detail, not
      // sharp foreground blips.
      this.accentGain = new Tone.Gain(0.3).connect(this.musicBus);
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

      // Outdoor rain layer (kept dry, off the distance filter). Shaped as a
      // 600..3000 Hz band with a slow gust swell: on a small phone speaker
      // the zoomed-out mix lives below what the speaker can reproduce, so an
      // unshaped highpassed noise bed was the only audible thing and read as
      // flat static rather than weather.
      this.rainGain = new Tone.Gain(0).connect(this.musicBus);
      this.rainSwell = new Tone.Gain(1).connect(this.rainGain);
      this.rainLfo = new Tone.LFO({ frequency: 0.3, min: 0.7, max: 1 });
      this.rainLfo.connect(this.rainSwell.gain);
      this.rainLfo.start();
      this.rainTone = new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.5 }).connect(
        this.rainSwell,
      );
      this.rainFilter = new Tone.Filter({ type: "highpass", frequency: 600, Q: 0.5 }).connect(
        this.rainTone,
      );
      this.rainNoise = new Tone.Noise({ type: "pink", playbackRate: 1.3 }).connect(this.rainFilter);
      this.rainNoise.volume.value = -12;
      this.rainNoise.start();

      // One-shot action jingles.
      this.sfxSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.12 },
      }).connect(this.sfxBus);

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

  /** Player volume levels, 0..1 each (clamped). Ramped so a live drag never
   *  clicks; safe before start() (stored, applied when the graph builds).
   *  A non-finite input keeps that channel's current level: NaN would survive
   *  clamp() and the native AudioParam rejects non-finite ramp targets. */
  setVolumes(music: number, sfx: number): void {
    if (Number.isFinite(music)) this.musicVolume = clamp(music, 0, 1);
    if (Number.isFinite(sfx)) this.sfxVolume = clamp(sfx, 0, 1);
    this.musicBus?.gain.rampTo(this.musicVolume, 0.08);
    this.sfxBus?.gain.rampTo(this.sfxVolume, 0.08);
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
      if (this.lead) {
        scheduleStep(this.lead, def, this.scene, this.step, this.tick, this.detail, time);
      }
      // Skip the accent path entirely for scenes with no accent, so a zoomed-in
      // quiet/service scene doesn't resolve (and discard) the voice nodes every
      // step; maybeAccent re-checks "none" defensively for direct callers.
      if (this.detail > 0.5 && def.accent !== "none") {
        const nodes = this.accentNodes();
        if (nodes) maybeAccent(nodes, def, this.tick, this.detail, time);
      }
    } catch {
      /* skip this step */
    }
    this.step = (this.step + 1) % 16;
    this.tick++;
  }

  /** Resolve the close-up accent voices, or null if the graph isn't built. */
  private accentNodes(): AccentNodes | null {
    if (!this.accentSynth || !this.membrane || !this.noiseAccent || !this.accentFilter) return null;
    return {
      accentSynth: this.accentSynth,
      membrane: this.membrane,
      noiseAccent: this.noiseAccent,
      accentFilter: this.accentFilter,
    };
  }

  // ---- One-shot action jingles ------------------------------------------

  sfx(name: SfxName): void {
    if (!this.started || !this.sfxSynth || this.muted) return;
    playSfx(this.sfxSynth, name);
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
      this.rainTone,
      this.rainLfo,
      this.rainSwell,
      this.rainGain,
      this.padGain,
      this.bassGain,
      this.musicGain,
      this.bedFilter,
      this.reverb,
      this.musicBus,
      this.sfxBus,
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
    this.rainTone = null;
    this.rainLfo = null;
    this.rainSwell = null;
    this.accentGain = this.ambGain = this.rainGain = null;
    this.padGain = this.bassGain = this.musicGain = null;
    this.reverb = null;
    this.musicBus = this.sfxBus = null;
    this.master = null;
    this.started = false;
  }
}
