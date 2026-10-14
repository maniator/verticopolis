/**
 * Every file the audio layer fetches at run time, as paths under the site base.
 *
 * Today's sounds are synthesized by Tone.js inside one lazy chunk (the
 * `ToneAudioEngine` chunk, see Audio.ts), except the crowd's two voice seeds,
 * which are recordings. An installed game must play all of them offline
 * (#985), so each file here has to be in the service worker's precache:
 * scripts/verify-precache.ts fails the build when one is missing from the
 * manifest, and audioAssets.test.ts fails when the source or
 * src/public/audio/ names a file this list lacks.
 *
 * Keep this file ERASABLE (type-only TypeScript syntax, no enums or
 * namespaces; the rule is spelled out in scripts/screenshot-env.ts):
 * verify-precache.ts imports it under plain `node`, which strips types.
 */

/** The crowd's talk seed (the owner's own voice, see ASSETS-LICENSE.md). */
export const VOICE_TALK_SEED = "audio/voice-talk.mp3";
/** The crowd's laugh seed. */
export const VOICE_LAUGHS_SEED = "audio/voice-laughs.mp3";

/** The audio files fetched at run time. Add a new one here in the same change
 *  that loads it. */
export const AUDIO_RUNTIME_FILES: readonly string[] = [VOICE_TALK_SEED, VOICE_LAUGHS_SEED];

/** The built name of the lazy chunk that carries Tone.js and every
 *  synthesized sound (Vite names it after ToneAudioEngine.ts). */
export const AUDIO_ENGINE_CHUNK = /(^|\/)ToneAudioEngine-[^/]+\.js$/;
