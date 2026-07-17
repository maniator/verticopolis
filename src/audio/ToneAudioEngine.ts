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
  type Scene,
  type SfxName,
} from "./toneScenes";
import { playSfx } from "./toneVoices";
import { programFor, type Program, type ProgramKind, type TrackVoice } from "./toneTracks";
import { CrowdLayer } from "./toneCrowd";

/**
 * Music + ambient audio for the tower, built on Tone.js.
 *
 * The music is two hand-composed looping tracks (see `./toneTracks.ts`): a
 * catchy SPLASH theme for the start screen and a calm, drifting in-game bed,
 * played through a small warm palette (triangle bass, rolling sine arpeggio,
 * and, on the splash, a triangle hook) by a looping {@link Tone.Part}. The
 * active track is chosen by {@link setProgram}: `"splash"` while the start
 * screen is up, `"game"` in the tower.
 *
 * Layered under it is the building's ambient life: a per-area "room tone" bed
 * (filtered noise), an outdoor rain layer, and the crowd/venue ambience layer
 * (see `./toneCrowd.ts`): voices, venue detail, and composed venue programs
 * driven by scene, zoom, live occupancy, and the sim clock. The music runs on
 * its own path so it stays warm at any zoom.
 *
 * Feature-detected and gesture-gated: with no AudioContext (tests / unsupported)
 * `start()` is a no-op and the engine stays inert. It carries the whole Tone.js
 * dependency (~230 kB), so the {@link AudioEngine} facade loads it lazily via a
 * dynamic `import()` on the first gesture.
 */

// Re-export the jingle name vocabulary from its new home so existing importers
// (the Audio facade, tests) keep resolving `SfxName` from this module.
export type { SfxName };

export class ToneAudioEngine {
  private master: Tone.Gain | null = null;
  /** Music & ambience level: everything but the action jingles flows here. */
  private musicBus: Tone.Gain | null = null;
  /** Player-set effects level: the one-shot action jingles only. */
  private sfxBus: Tone.Gain | null = null;
  /** Distance lowpass on the AMBIENT bed; opens up as you zoom in. The music
   *  bypasses it (see the music chain) so the composed track stays consistent. */
  private bedFilter: Tone.Filter | null = null;
  private reverb: Tone.Reverb | null = null;

  // Composed-music voices + their own warm signal path.
  private arp: Tone.PolySynth | null = null;
  private bassVoice: Tone.Synth | null = null;
  private hook: Tone.PolySynth | null = null;
  private musicGain: Tone.Gain | null = null;
  /** Warm lowpass + sub high-pass on the music (never bright/harsh, no rumble). */
  private musicTone: Tone.Filter | null = null;
  private musicSub: Tone.Filter | null = null;
  /** The looping player for the active track. Rebuilt on a program change. */
  private musicPart: Tone.Part | null = null;
  /** Target level for the music bed; the crossfade dips to 0 and back to this. */
  private readonly musicLevel = 0.8;
  /** Pending track-swap during a crossfade, so a re-switch can cancel it. */
  private swapTimer: ReturnType<typeof setTimeout> | null = null;

  private sfxSynth: Tone.PolySynth | null = null;
  /** The crowd/venue ambience layer (talkers, venue detail, venue programs). */
  private crowd: CrowdLayer | null = null;

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

  private scene: Scene = "lobby";
  private targetScene: Scene = "lobby";
  /** Hysteresis latch for the zoomed-out overview scene. */
  private overview = false;
  private ambBase = 0.2;
  private detail = 0.4;
  private rainTarget = 0;
  /** Which composed track plays. The app switches this at the splash boundary. */
  private program: ProgramKind = "game";
  muted = false;
  /** Player-set levels 0..1, kept even while the graph isn't built so start()
   *  can apply them; independent of `muted` (the master kill switch). */
  musicVolume = 1;
  sfxVolume = 1;
  started = false;

  /** Lazily create the audio graph. Must be called from a user gesture. */
  start(): void {
    if (this.started) {
      // Already built, but the context may have been suspended since. main.ts
      // calls start() on every gesture: re-attempt the resume (a no-op on a
      // running context, and it recovers a silenced one).
      void Tone.getContext().resume().catch(() => {});
      return;
    }
    const hasWebAudio =
      typeof (globalThis as { AudioContext?: unknown }).AudioContext !== "undefined" ||
      typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined";
    if (!hasWebAudio) return; // no WebAudio (tests / unsupported)
    try {
      // Inside a user gesture, so resuming is allowed. Swallow rejections
      // (autoplay/permission) so a blocked context can't surface as unhandled.
      Tone.start().catch(() => {});

      this.master = new Tone.Gain(this.muted ? 0 : 0.35).toDestination();

      // Player volume buses between content and master: music & ambience on one,
      // action jingles on the other. Master keeps its fixed 0.35 (and the mute
      // ramp); these two only scale within it.
      this.musicBus = new Tone.Gain(this.musicVolume).connect(this.master);
      this.sfxBus = new Tone.Gain(this.sfxVolume).connect(this.master);

      // Shared reverb so the music and ambient life feel like rooms, not dry
      // oscillators.
      this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.musicBus);

      // Ambient bed's distance lowpass: far out = muffled, up close = present.
      this.bedFilter = new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.7 }).connect(
        this.reverb,
      );

      // Composed music path (bypasses the zoom distance filter): voices -> level
      // -> warm lowpass -> sub highpass -> reverb -> music bus. Kept warm and
      // band-limited so the loop never reads bright, harsh, or boomy.
      this.musicSub = new Tone.Filter({ type: "highpass", frequency: 90, Q: 0.7 }).connect(this.reverb);
      this.musicTone = new Tone.Filter({ type: "lowpass", frequency: 2400, Q: 0.7 }).connect(this.musicSub);
      this.musicGain = new Tone.Gain(this.musicLevel).connect(this.musicTone);

      // Rolling sine arpeggio (the bed's main texture): a soft pluck.
      this.arp = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.03, decay: 0.5, sustain: 0.05, release: 0.8 },
      }).connect(this.musicGain);
      this.arp.volume.value = -9;

      // Soft triangle bass root under each bar.
      this.bassVoice = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.6 },
      }).connect(this.musicGain);
      this.bassVoice.volume.value = -8;

      // The hummable hook (splash theme only); silent in the game bed.
      this.hook = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.025, decay: 0.3, sustain: 0.2, release: 0.3 },
      }).connect(this.musicGain);
      this.hook.volume.value = -6;

      // The crowd/venue ambience layer rides the distance-filtered bed so
      // zoom muffles and opens it with everything else. Its two voice seeds
      // fetch lazily and degrade to tone-only ambience if they never arrive.
      const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "./";
      this.crowd = new CrowdLayer(this.bedFilter, base);

      // Ambient room-tone bed: pink noise + a strong roll-off, so a soft "room
      // rush" rather than bright tape hiss.
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

      // Outdoor rain layer (dry, off the distance filter): a 600..3000 Hz band
      // with a slow gust swell so it reads as weather, not flat static.
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

      // Kick off the Transport (the looping music part and the venue programs
      // schedule on it).
      Tone.getTransport().start();
      this.buildMusicPart();

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

  /** Player volume levels, 0..1 each (clamped, ramped). Safe before start().
   *  A non-finite input keeps that channel's level (NaN survives clamp() and
   *  the native AudioParam rejects non-finite ramp targets). */
  setVolumes(music: number, sfx: number): void {
    if (Number.isFinite(music)) this.musicVolume = clamp(music, 0, 1);
    if (Number.isFinite(sfx)) this.sfxVolume = clamp(sfx, 0, 1);
    this.musicBus?.gain.rampTo(this.musicVolume, 0.08);
    this.sfxBus?.gain.rampTo(this.sfxVolume, 0.08);
  }

  /** Choose which composed track plays: `"splash"` on the start screen,
   *  `"game"` in the tower. Safe before start() (stored, applied on build).
   *  Live, it CROSSFADES so the splash theme flows into the in-game bed instead
   *  of cutting. A repeat of the current program is a no-op. */
  setProgram(program: ProgramKind): void {
    if (program === this.program) return;
    this.program = program;
    if (this.started) this.crossfadeProgram();
  }

  /** Dip to silence, swap the looping part at the bottom, swell back up. */
  private crossfadeProgram(): void {
    if (!this.musicGain) return this.buildMusicPart();
    const FADE = 0.8;
    this.musicGain.gain.rampTo(0, FADE);
    if (this.swapTimer !== null) clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => {
      this.swapTimer = null;
      this.buildMusicPart();
      this.musicGain?.gain.rampTo(this.musicLevel, FADE);
    }, FADE * 1000);
  }

  /** Called every frame with the renderer's focus; drives the ambient life
   *  (scene room-tone, zoom detail, rain). The music is program-driven, not
   *  focus-driven, so it is untouched here. */
  update(focus: ViewFocus): void {
    if (!this.started) return;
    // Any Tone error here is swallowed and retried next frame, so an audio
    // hiccup never escapes into the game loop or leaves the graph half-updated.
    try {
      // A backgrounded/power-saving tab can suspend the context; nudge it back
      // on each update so sound returns instead of staying dead.
      const ctx = Tone.getContext();
      if (!this.muted && ctx.state === "suspended") void ctx.resume().catch(() => {});

      // Zoom detail: opens the distance filter and fades ambient detail in/out.
      const detail = detailFor(focus.zoom);
      if (Math.abs(detail - this.detail) > 0.02) this.applyDetail(detail, 0.3);

      // Overview latch with hysteresis so hovering near the zoom threshold can't
      // flip the scene (and re-trigger the ambient bed) frame to frame.
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

      // The crowd/venue ambience follows the resolved scene, the live focus
      // (occupancy, clock), and zoom every update.
      this.crowd?.update(s, focus, this.detail, this.muted);

      // Outdoor rain only when the sky is visible (overview or the street), so
      // it reads as a real weather tell, not a smear behind indoor scenes.
      const wantRain = focus.weather === "rain" && (s === "outside" || s === "overview") ? 0.13 : 0;
      if (wantRain !== this.rainTarget && this.rainGain) {
        this.rainTarget = wantRain;
        this.rainGain.gain.rampTo(wantRain, 1.5);
      }
    } catch {
      /* transient Tone/context error — recover on the next update */
    }
  }

  /** Build (or rebuild) the looping part for the active program, clearing any
   *  prior part first so a switch never stacks two tracks. */
  private buildMusicPart(): void {
    if (!this.arp || !this.bassVoice || !this.hook) return;
    // One guard over the whole rebuild: if construction throws, musicPart stays
    // null (never stacked) and the crossfade still swells the gain back.
    try {
      this.musicPart?.stop();
      this.musicPart?.dispose();
      this.musicPart = null;
      const prog: Program = programFor(this.program);
      const voice = (v: TrackVoice): Tone.PolySynth | Tone.Synth | null =>
        v === "arp" ? this.arp : v === "bass" ? this.bassVoice : this.hook;
      const part = new Tone.Part((time, ev) => {
        try {
          if (this.muted) return; // a stray Tone error must not stop the Transport
          voice(ev.voice)?.triggerAttackRelease(midiToFreq(ev.midi), ev.dur, time, ev.vel);
        } catch {
          /* skip this note */
        }
      }, prog.events.map((e) => [e.t, e] as [number, typeof e]));
      part.loop = true;
      part.loopEnd = prog.loopEnd;
      part.start(0);
      this.musicPart = part;
    } catch {
      /* rebuild failed; leave the part null so a later setProgram can retry */
    }
  }

  private crossfadeTo(s: Scene): void {
    this.scene = s;
    this.applyScene(s, 1.2);
  }

  /** Move the ambient room-tone bed to a scene's character (music is not
   *  scene-driven; only the ambient life follows what you view). */
  private applyScene(s: Scene, time: number): void {
    if (!this.started) return;
    const def = SCENES[s];
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
    // Cap the top end below full-band so zoom-in brightens the mix without
    // unmasking noise as high-frequency static.
    if (this.bedFilter) this.bedFilter.frequency.rampTo(lerp(650, 7500, detail), time);
    this.updateAmbGain(time);
  }

  private updateAmbGain(time: number): void {
    if (!this.ambGain) return;
    // Some room tone is always present; the rest fades in on zoom-in, kept modest
    // so the bed stays background, never foreground hiss.
    this.ambGain.gain.rampTo(this.ambBase * (0.2 + 0.4 * this.detail), time);
  }

  // ---- One-shot action jingles ------------------------------------------

  sfx(name: SfxName): void {
    if (!this.started || !this.sfxSynth || this.muted) return;
    playSfx(this.sfxSynth, name);
  }

  dispose(): void {
    // Stop the global Transport so no scheduled part keeps ticking after
    // teardown, and tear the crowd layer down first (it owns its own timers).
    try {
      Tone.getTransport().stop();
    } catch {
      /* transport already gone */
    }
    this.crowd?.dispose();
    this.crowd = null;
    if (this.swapTimer !== null) clearTimeout(this.swapTimer);
    this.swapTimer = null;
    try {
      this.musicPart?.stop();
    } catch {
      /* already stopped */
    }
    const nodes = [
      this.musicPart,
      this.arp,
      this.bassVoice,
      this.hook,
      this.musicGain,
      this.musicTone,
      this.musicSub,
      this.sfxSynth,
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
    this.musicPart = null;
    this.arp = this.hook = this.sfxSynth = null;
    this.bassVoice = null;
    this.ambNoise = this.rainNoise = null;
    this.ambFilter = this.ambTone = this.rainFilter = this.bedFilter = null;
    this.musicTone = this.musicSub = null;
    this.rainTone = null;
    this.rainLfo = null;
    this.rainSwell = null;
    this.ambGain = this.rainGain = null;
    this.musicGain = null;
    this.reverb = null;
    this.musicBus = this.sfxBus = null;
    this.master = null;
    this.started = false;
  }
}
