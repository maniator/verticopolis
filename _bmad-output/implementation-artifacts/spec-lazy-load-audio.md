---
title: 'Lazy-load the Tone.js audio stack out of the initial bundle'
type: 'refactor'
created: '2026-07-06'
status: 'draft'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `main` chunk is ~351 kB, ~232 kB of which is the audio stack (Tone.js + standardized-audio-context) pulled in eagerly because `src/audio/Audio.ts` does a top-level `import * as Tone from "tone"` and `main.ts` constructs `new AudioEngine()` at boot. None of that is audible until the player's first gesture (browser autoplay policy), so it needlessly bloats first load and parse.

**Approach:** Split `AudioEngine` into a tiny synchronous **facade** (no Tone import, keeps the same public API and file path so callers are unchanged) and the heavy Tone implementation in a new module. The facade dynamically `import()`s the implementation on the first `start()` call — which is already user-gesture gated — so Tone lands in its own async chunk instead of `main`.

## Boundaries & Constraints

**Always:**
- Preserve every existing audio behavior: music, zoom-reactive scenes, rain, and `sfx` jingles all still play after the first gesture, exactly as today.
- Keep the public surface of `AudioEngine` in `src/audio/Audio.ts` identical: zero-arg construction, fields `muted`/`started`, methods `start()`/`setMuted()`/`update(focus)`/`sfx(name)`/`dispose()`. `main.ts` and the three `import type` consumers (`game/buildActions.ts`, `game/keyboardPlay.ts`, `game/editorActions.ts`) must need NO changes.
- `muted` stays synchronously readable/writable on the facade (main.ts:227-229 reads it immediately after `start()`).
- Feature-detect WebAudio in the facade BEFORE importing Tone, so tests/SSR/unsupported environments stay fully inert and never fetch the audio chunk (matches today's `start()` no-op).
- Keep `src/engine/` free of DOM/rendering. Keep the existing `vendor-excalibur` manualChunks split in `vite.config.ts`.
- The new async audio chunk must remain precached by Workbox (offline audio preserved) and must NOT match the `**/excalibur*` globIgnore.

**Ask First:**
- If the facade cannot preserve the exact `Pick<AudioEngine, "sfx">` shape the `game/*` deps rely on without touching those files.

**Never:**
- Do not remove audio from the PWA precache or make first-session audio require a network round-trip.
- Do not change gameplay, the synthesis code, or the scene/sfx semantics.
- Do not add a version bump — this is an internal build optimization with no player-facing behavior change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First gesture, WebAudio present | `start()` called | Dynamically imports impl, constructs it, forwards current `muted`, starts audio | import rejection → stay silent, allow retry |
| No AudioContext (tests/unsupported) | `start()` called | No-op; Tone chunk is never fetched | N/A |
| `sfx`/`update` before impl loaded | called pre-gesture or mid-load | Silent no-op (delegates only if impl present) | N/A |
| Toggle mute before audio loaded | `setMuted(true)` then later `start()` | Facade tracks `muted`; forwarded to impl on load so it starts muted | N/A |
| `start()` called repeatedly | multiple gestures / toggle | Idempotent — one import, no duplicate impls | N/A |

</frozen-after-approval>

## Code Map

- `src/audio/Audio.ts` -- becomes the lightweight `AudioEngine` facade (no `tone` import; `import type` only). Owns `muted`/`started`, lazy-loads and delegates.
- `src/audio/ToneAudioEngine.ts` -- NEW. The current Tone-based implementation, moved verbatim and renamed `class ToneAudioEngine`; keeps `import * as Tone from "tone"`. Export a `SfxName` type for the facade to reuse.
- `src/main.ts` -- unchanged (imports/constructs `AudioEngine` from `./audio/Audio` as before).
- `src/game/{buildActions,keyboardPlay,editorActions}.ts` -- unchanged (`import type`, `Pick<AudioEngine,"sfx">`).
- `vite.config.ts` -- unchanged for audio (dynamic import auto-creates the chunk; keep `vendor-excalibur`).

## Tasks & Acceptance

**Execution:**
- [ ] `src/audio/ToneAudioEngine.ts` -- move the existing `AudioEngine` class here verbatim, rename to `ToneAudioEngine`, and export `type SfxName = "build"|"sell"|"error"|"promote"|"money"|"click"` used by its `sfx` signature. Keep the top-level Tone import here.
- [ ] `src/audio/Audio.ts` -- replace with a facade `class AudioEngine` (no `tone` import): fields `muted=false`/`started=false`, a private `impl` and `loading` guard, and a cached `lastFocus`. `start()` feature-detects WebAudio, then `await import("./ToneAudioEngine")`, constructs the impl, forwards `muted`, calls `impl.start()`, replays `lastFocus`; idempotent. `setMuted`/`update`/`sfx`/`dispose` update local state and delegate to `impl` when present. Re-export `ToneAudioEngine`'s types as needed.
- [ ] Verify no other module value-imports `tone` or the moved class.

**Acceptance Criteria:**
- Given a production build, when it completes, then `tone`/`standardized-audio-context` appear in a dynamically-loaded chunk (not `main`), and `main`'s size drops by roughly the audio payload (~230 kB raw).
- Given the built app in a browser, when the player first taps/keys and later toggles mute, then music and `sfx` play and mute/unmute behaves exactly as before.
- Given the test suite (jsdom, no AudioContext), when it runs, then audio stays inert and no test regresses.
- Given the generated service worker, when inspected, then the audio chunk is listed in the precache manifest and no `excalibur*` tooling chunk is precached.

## Design Notes

Facade `start()` shape (delegation is the whole trick):

```ts
start(): void {
  if (this.impl) { this.impl.start(); this.started = this.impl.started; return; }
  if (this.loading) return;
  const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  if (typeof g.AudioContext === "undefined" && typeof g.webkitAudioContext === "undefined") return;
  this.loading = true;
  void import("./ToneAudioEngine")
    .then(({ ToneAudioEngine }) => {
      this.loading = false;
      const impl = new ToneAudioEngine();
      impl.setMuted(this.muted);
      impl.start();
      this.impl = impl;
      this.started = impl.started;
      if (this.lastFocus) impl.update(this.lastFocus);
    })
    .catch(() => { this.loading = false; });
}
```

`update(f)` stores `this.lastFocus = f` then `this.impl?.update(f)`; `setMuted(m)` sets `this.muted = m` then `this.impl?.setMuted(m)`; `sfx(n)` is `this.impl?.sfx(n)`; `dispose()` disposes impl and clears it. Auto chunk naming (`ToneAudioEngine-*.js`) sidesteps the `**/excalibur*` globIgnore and is matched by the `**/*.js` precache glob.

## Verification

**Commands:**
- `npm run build` -- expected: no chunk >500 kB warning; a `tone`-containing async chunk exists; `main` shrinks by ~the audio payload.
- `node` sourcemap attribution (as used in planning) -- expected: `node_modules/tone` no longer attributed to `main-*.js`.
- `grep -o '"[^"]*\.js"' dist/sw.js` -- expected: the audio chunk present in precache; no `excalibur-*` tooling chunk present.
- `npm run typecheck` / `npm run lint` / `npm test` -- expected: all green, no test changes needed.

**Manual checks:**
- Serve the build, tap to start audio, confirm music + a build/error `sfx` play and the mute toggle works.
