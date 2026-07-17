import * as Tone from "tone";
import {
  computeCalmMask,
  segmentIsCalm,
  pseudo,
  whoopRate,
  LAUGH_REGIONS,
  PHRASE_MIN_S,
  PHRASE_VAR_S,
  PHRASE_RAMP_S,
} from "./toneCrowdData";

/**
 * The voice half of the crowd layer: the two seed recordings (talk and
 * laughs, the owner's own voice, see ASSETS-LICENSE.md) and the play-one-now
 * primitives built on them. A "talker" phrase is a calm segment of the talk
 * seed played through a down-only pitch shift with trapezoid fades; a laugh
 * is one of the two seed regions; a whoop is a calm chunk with its playback
 * rate bent upward. {@link CrowdLayer} owns all scheduling and pre-wires the
 * gain nodes it hands in; this module only emits one sound into them.
 *
 * Loading is lazy and failure is silent: until (or unless) the seeds decode,
 * every voiced method is a quiet no-op and the tone-built ambience carries
 * the scene alone.
 */

export class CrowdVoices {
  private talk: Tone.ToneAudioBuffer | null = null;
  private laughs: Tone.ToneAudioBuffer | null = null;
  private talkMask: Uint8Array | null = null;
  private talkRate = 44100;
  private talkLen = 0;
  /** Live sources, tracked so dispose can cut tails. */
  private live = new Set<Tone.ToneBufferSource>();
  private disposed = false;

  /** Begin fetching both seeds. Safe to call once, any time after the audio
   *  context exists; a failed fetch or decode leaves the layer tone-only. */
  load(baseUrl: string): void {
    try {
      this.talk = new Tone.ToneAudioBuffer(`${baseUrl}audio/voice-talk.mp3`, () => {
        try {
          const buf = this.talk?.get();
          if (!buf || this.disposed) return;
          this.talkRate = buf.sampleRate;
          this.talkLen = buf.duration;
          this.talkMask = computeCalmMask(buf.getChannelData(0), buf.sampleRate);
        } catch {
          this.talkMask = null; // undecodable seed: stay tone-only
        }
      });
      this.laughs = new Tone.ToneAudioBuffer(`${baseUrl}audio/voice-laughs.mp3`, () => {});
    } catch {
      this.talk = this.laughs = null;
    }
  }

  /** True once the talk seed is decoded and masked (voiced murmur can play). */
  get ready(): boolean {
    return this.talkMask !== null && this.talk !== null && this.talk.loaded;
  }

  /** Play one talker phrase into `gainNode`. `tick` seeds all randomness. Returns
   *  the phrase's wall-clock seconds, or null when not ready or no calm
   *  segment fits (callers just wait a beat and try again). */
  phrase(gainNode: Tone.Gain, semi: number, tick: number): number | null {
    if (!this.ready || !this.talk || !this.talkMask) return null;
    const wallLen = PHRASE_MIN_S + PHRASE_VAR_S * pseudo(tick * 40503 + 7);
    const rate = Math.pow(2, semi / 12);
    const srcLen = wallLen * rate;
    let start = -1;
    for (let attempt = 0; attempt < 25; attempt++) {
      const s = pseudo(tick * 2654435761 + attempt * 97) * Math.max(0.01, this.talkLen - srcLen - 0.1);
      if (segmentIsCalm(this.talkMask, this.talkRate, s, srcLen)) {
        start = s;
        break;
      }
    }
    if (start < 0) return null;
    this.emit(this.talk, gainNode, { rate, offset: start, srcDur: srcLen, fade: PHRASE_RAMP_S });
    return wallLen;
  }

  /** Play one of the two seed laughs, muffled by the destination chain. */
  laugh(gainNode: Tone.Gain, tick: number): void {
    if (!this.laughs || !this.laughs.loaded) return;
    const [a, b] = LAUGH_REGIONS[Math.floor(pseudo(tick * 19349663) * LAUGH_REGIONS.length)];
    this.emit(this.laughs, gainNode, { rate: 1, offset: a, srcDur: b - a, fade: 0.03 });
  }

  /** A whoop: a calm talk chunk whose playback rate accelerates upward. */
  whoop(gainNode: Tone.Gain, tick: number): void {
    if (!this.ready || !this.talk || !this.talkMask) return;
    const wallLen = 0.4 + 0.15 * pseudo(tick * 22695477 + 3);
    let start = -1;
    for (let attempt = 0; attempt < 25; attempt++) {
      const s = pseudo(tick * 2246822519 + attempt * 131) * Math.max(0.01, this.talkLen - 1.5);
      if (segmentIsCalm(this.talkMask, this.talkRate, s, 0.8)) {
        start = s;
        break;
      }
    }
    if (start < 0) return;
    try {
      const src = new Tone.ToneBufferSource({
        url: this.talk,
        fadeIn: 0.02,
        fadeOut: 0.05,
        playbackRate: whoopRate(0),
      });
      src.connect(gainNode);
      const now = Tone.now();
      // Two-segment linear ramp approximates the approved accelerating bend.
      src.playbackRate.setValueAtTime(whoopRate(0), now);
      src.playbackRate.linearRampToValueAtTime(whoopRate(0.5), now + wallLen * 0.5);
      src.playbackRate.linearRampToValueAtTime(whoopRate(1), now + wallLen);
      this.track(src);
      src.start(now, start, wallLen * 1.6);
      src.stop(now + wallLen);
    } catch {
      /* voice glitch: skip this whoop */
    }
  }

  /** Create, connect, fire, and track one buffer source. */
  private emit(
    buffer: Tone.ToneAudioBuffer,
    gainNode: Tone.Gain,
    opts: { rate: number; offset: number; srcDur: number; fade: number },
  ): void {
    try {
      const src = new Tone.ToneBufferSource({
        url: buffer,
        playbackRate: opts.rate,
        fadeIn: opts.fade,
        fadeOut: opts.fade,
      });
      src.connect(gainNode);
      this.track(src);
      src.start(Tone.now(), opts.offset, opts.srcDur);
    } catch {
      /* voice glitch: skip this phrase */
    }
  }

  private track(src: Tone.ToneBufferSource): void {
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      try {
        src.dispose();
      } catch {
        /* already gone */
      }
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const src of this.live) {
      try {
        src.stop();
        src.dispose();
      } catch {
        /* already gone */
      }
    }
    this.live.clear();
    try {
      this.talk?.dispose();
      this.laughs?.dispose();
    } catch {
      /* already gone */
    }
    this.talk = this.laughs = null;
    this.talkMask = null;
  }
}
