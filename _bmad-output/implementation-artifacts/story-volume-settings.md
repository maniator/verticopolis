---
baseline_commit: 3afeb401aed443cb655a0d26f11d2acd2a985863
---

# Story: Persisted volume settings

Status: review

Grounds: direct owner request (2026-07-12): save the users' volume options, and
allow the user to set volume levels. No epic; this is a standalone
quality-of-life story specced through the BMGD flow.

## Story

As **a returning Verticopolis player**,
I want **my mute choice and my volume levels to survive a reload, and sliders
to set how loud the music and the sound effects are**,
so that **I never have to re-mute or re-balance the game every session, and I
can keep the ambient score low while still hearing build/error feedback (or the
other way around)**.

## Context (read before coding)

- Audio is procedural, two layers: `src/audio/Audio.ts` is the synchronous
  `AudioEngine` facade the app boots with; it lazy-loads
  `src/audio/ToneAudioEngine.ts` (the whole Tone.js graph, ~230 kB) on the
  first user gesture. Synchronously readable state (`muted`, `started`) lives
  on the facade and is forwarded to the real engine when the chunk lands
  (`impl.setMuted(this.muted)` inside `start()`'s `.then`). Volume must follow
  the exact same pattern: facade fields forwarded on load, no Tone import in
  the facade.
- Inside `ToneAudioEngine.start()` everything routes to one
  `master = new Tone.Gain(muted ? 0 : 0.35).toDestination()`. Today four
  things connect to master: the reverb (which carries the whole
  bed: pad, bass, lead melody, ambient noise via `bedFilter`), `accentGain`
  (close-up detail hits), `rainGain` (weather layer), and `sfxSynth` (the
  one-shot action jingles). `setMuted` ramps master between 0 and 0.35.
- Per-device preferences persist in `src/storage/Prefs.ts` under localStorage
  key `vc.prefs`, deliberately separate from saves so they never travel with
  an exported tower. The loader validates field-by-field and drops anything
  malformed. Mute is currently NOT in prefs; it resets on reload. There is no
  volume control at all.
- The mute toggle is the `#audio-toggle` button (top bar, `src/index.html`),
  wired in `UI.wireControls` via the `onToggleAudio()` callback, which returns
  the new muted state; `main.ts` implements it as `audio.start();
  audio.setMuted(!audio.muted)`. The button's initial glyph is hardcoded 🔊 in
  the HTML.
- The "How to play" modal (`UI.showHelp`, `src/ui/UI.ts` around line 1020)
  already hosts the Reduced motion and Steady clock preference toggles in its
  `modal-actions` row, each backed by an `onToggle*` callback in `UICallbacks`
  plus a read-only getter where the UI needs initial state (`isSteadyClock`).
  Volume sliders belong in this modal, as a labeled block above that row.
- Design system: `docs/design-system.md` + `src/styles.css`. One generation of
  CSS, tokens only, no skin on IDs. There is no existing `input[type=range]`
  rule; add one modest token-based rule (accent-color from the palette) rather
  than a custom-painted slider.

## Player-facing behavior (the contract)

Two sliders, not one: **Music** (scene themes, ambient room tone, close-up
accents, rain) and **Effects** (the build/sell/error/money/promote/click
jingles). One master volume would not let a player keep feedback sounds while
quieting the score, which is the actual request behind "volume levels."
The mute button stays the master kill switch and is independent of the
sliders: muting does not move the sliders, and setting a slider does not
unmute.

## Acceptance Criteria

1. **Prefs schema.** `Prefs` gains `muted?: boolean`, `musicVolume?: number`,
   `sfxVolume?: number`. `loadPrefs` accepts only finite numbers in [0, 1]
   for the volumes (out-of-range finite values are clamped, non-numbers and
   non-finite values are dropped) and only booleans for `muted`. Absent fields
   mean the defaults: unmuted, both volumes 1.
2. **Mute persists.** Toggling the top-bar audio button saves `muted` through
   `savePrefs`; on the next boot the facade is muted before any `start()` and
   the button shows 🔇 without a click. The button glyph is initialized from
   game state, not hardcoded markup.
3. **Volumes persist.** Moving either slider saves through `savePrefs`; on the
   next boot the facade carries the saved values and forwards them to the Tone
   engine when it loads, including when the engine loads later (facade
   `setVolumes` before load must land on the engine after load, exactly like
   `muted` does today).
4. **Engine buses.** `ToneAudioEngine` routes all music/ambience (reverb bed,
   `accentGain`, `rainGain`) through a new music bus gain and the jingle
   synth through a new effects bus gain, both feeding `master`. `setVolumes`
   clamps to [0, 1], stores, and ramps the bus gains (short ramp, no click);
   values set before `start()` are applied when the graph is built. The master
   gain's 0.35 level and mute ramp are unchanged.
5. **Live and audible.** Slider input applies immediately to a running engine
   (audible while the modal is open). The slider gesture also calls
   `audio.start()` so a player whose first interaction is the slider hears the
   result. Mute stays independent: sliders keep their positions while muted,
   and volume 0 on both sliders does not flip the mute button.
6. **UI block.** `showHelp` renders a "Sound" section with two labeled range
   inputs (0-100) reflecting the current volumes, each with a live percent
   readout, keyboard operable with visible focus, and proper label/`aria`
   wiring. Styling uses design-system tokens (one new `input[type=range]`
   rule plus a small layout rule; no ID skinning).
7. **Callbacks stay typed.** New `UICallbacks` members follow the existing
   idiom: `onSetVolume(kind: "music" | "sfx", value: number): void`,
   `getVolumes(): { music: number; sfx: number }`, `isMuted(): boolean`.
   `main.ts` implements them against the facade + prefs (in-memory prefs
   object stays the single source of truth, mirroring `isSteadyClock`).
8. **No save/engine contamination.** No changes to `SaveGame`, `SerializedGame`,
   or anything in `src/engine/`. Prefs never enter a tower export.
9. **Tests.**
   - `prefs.test.ts`: round-trip of the three new fields; clamping of
     out-of-range volumes; rejection of `NaN`/string/`Infinity` values.
   - `audioFacade.test.ts`: pre-load `setVolumes` forwarded to the engine on
     load (stub engine grows `setVolumes`); post-load calls forwarded live.
   - `toneAudioEngineGraph.test.ts`: `setVolumes` before and after `start()`
     does not throw and the engine reports the clamped stored values;
     mute/unmute behavior unchanged.
   - UI dialog test (`uiDialogs.test.ts` pattern): help modal shows both
     sliders at the values from `getVolumes`, slider input fires
     `onSetVolume` with a 0..1 value, and the percent readout updates.
10. **Version bump.** New player-facing capability: `package.json` minor bump
    (1.18.1 to 1.19.0).
11. **Quality gates.** `npm run typecheck`, `npm run lint`, `npm test`,
    `npm run build` all green.

## Tasks / Subtasks

- [x] `src/storage/Prefs.ts` (UPDATE): add the three fields + validation
      (clamp helper for volumes). (AC: 1)
- [x] `src/audio/ToneAudioEngine.ts` (UPDATE): `musicBus`/`sfxBus` gains,
      rerouting, `setVolumes(music, sfx)`, apply-at-start, dispose the new
      nodes in `dispose()`. (AC: 4)
- [x] `src/audio/Audio.ts` (UPDATE): facade `musicVolume`/`sfxVolume` fields,
      `setVolumes`, forward on load next to the existing `setMuted` forward;
      widen the structural `AudioEngineImpl` interface. (AC: 3)
- [x] `src/main.ts` (UPDATE): apply persisted mute + volumes to the facade at
      boot (before the first possible gesture); persist in `onToggleAudio`;
      implement `onSetVolume`/`getVolumes`/`isMuted`. (AC: 2, 3, 5, 7)
- [x] `src/ui/UI.ts` (UPDATE): initialize the audio button glyph from
      `isMuted()` in `wireControls`; add the Sound block + slider wiring in
      `showHelp`. (AC: 2, 5, 6, 7)
- [x] `src/index.html` (UPDATE) only if the button needs a neutral initial
      state; otherwise leave it. (AC: 2)
- [x] `src/styles.css` (UPDATE): `input[type=range]` accent rule + slider row
      layout. (AC: 6)
- [x] Tests per AC 9 in the four named files. (AC: 9)
- [x] `package.json` (UPDATE): 1.18.1 to 1.19.0. (AC: 10)
- [ ] Regenerate `docs/screenshots/02-help.png` (the Help modal shot from
      `scripts/screenshot-scenes.ts`) via an `[update-screenshots]` marker push
      or the pinned Playwright container; never a host browser. (AC: 6)
- [x] Quality gates, then `/gds-code-review` AND `/bmad-code-review` in the
      same session (engine buses are gds; the Prefs/UI persistence surface is
      bmad). (AC: 11)

## Dev Notes

- **Copy the muted forwarding pattern exactly.** The facade's load `.then`
  already does `impl.setMuted(this.muted)` before `impl.start()`; volumes go
  in the same spot. Do not make the facade async or import Tone.
- **Do not touch the scene gain tables.** `SCENES[*].gain`, the per-scene
  `applyScene` ramps, and `applyDetail` are the game's mix; the buses multiply
  on top of them. No retuning.
- **Ramp, don't set.** Bus gain changes use `rampTo(v, ~0.05-0.1)`; a raw
  `.value =` assignment while audio plays produces a click.
- **Boot order matters for AC 2.** `main.ts` constructs `audio` and `prefs` as
  field initializers; apply prefs to the facade in the constructor before UI
  wiring so a gesture that races ahead still starts muted. The first `kick`
  listener calls `audio.start()` on any interaction.
- **Slider events:** wire `input` (not `change`) for live feedback.
  (Amended per review, 2026-07-12: volumes apply live on every `input` tick
  but persist through a 200ms trailing debounce with a `pagehide` flush;
  single-shot toggles like mute still call `savePrefs` directly. The
  original "persist on every input is fine" guidance was revised by the
  gds review's write-storm finding.)
- **Keep the modal accessible:** real `<label>` elements tied to the inputs
  (or `aria-label`), `aria-valuetext` percent is free on native range inputs;
  the percent readout can be `aria-hidden` text updated on input.
- **No em-dashes in any new prose** (labels, comments, story edits). American
  English. Plain copy: "Music", "Effects", "Sound".
- **Engine purity:** nothing here touches `src/engine/`; keep it that way.
- **Sliders while unstarted:** `setVolumes` on the facade before any gesture
  must be safe (store only); the graph test's mocked Tone proxy makes
  engine-side calls no-ops, so assert stored state, not node internals.
- **Footer guard test:** the Sound block must live OUTSIDE `.modal-actions`;
  `uiDialogs.test.ts` pins that row's exact `[data-act]` contents
  (reduce-motion, steady-clock, replay-onboard, close) and must keep passing
  unmodified.
- **Typed stub:** extend `makeUI` in `uiDialogs.test.ts` with the three new
  members (`isMuted: vi.fn(() => false)`, `getVolumes: vi.fn(() => ({ music:
  1, sfx: 1 }))`, `onSetVolume: vi.fn()`) so the existing showHelp and
  audio-toggle tests keep passing.

## Change Log

- 2026-07-12: story created (gds-create-story) from owner request; grounded in
  a code read of Audio.ts, ToneAudioEngine.ts, Prefs.ts, UI.ts, main.ts.
- 2026-07-12: fresh-context validation pass folded in: help-modal screenshot
  regeneration task, dual review skills (gds + bmad), footer guard-test note,
  makeUI stub note.
- 2026-07-12: implemented (gds-dev-story), test-first: RED 10 failures on
  unchanged code, GREEN 1107/1107, all four gates green.
- 2026-07-12: gds-code-review patches applied (non-finite volume guard at
  facade + engine, debounced pref writes, em-dash sweep); bmad-code-review
  patches applied (pagehide flush for the pending debounced save, this
  deviation note). Deviation from the original Dev Note: slider persistence
  is a 200ms trailing debounce + pagehide flush, not a write per input tick.

## Review Findings

`/gds-code-review` 2026-07-12, three adversarial layers (Blind Hunter, Edge
Case Hunter, Acceptance Auditor). All 11 ACs confirmed satisfied. Triage: 3
patched, 1 dismissed.

- [x] `[Review][Patch]` Non-finite setVolumes input survived the min/max
      clamp and could poison session volume state; now keeps that channel's
      current level at both layers, with tests [`src/audio/Audio.ts`,
      `src/audio/ToneAudioEngine.ts`]
- [x] `[Review][Patch]` savePrefs + audio.start() ran per slider input tick
      during a drag; volumes still apply live per tick, persistence is a
      200ms trailing debounce and start() is gated on `!started`
      [`src/main.ts`]
- [x] `[Review][Patch]` Em-dash sweep across all new comments and the new
      test describe title [multiple files]
- Dismissed: amb room-tone routing question (verified `ambGain -> bedFilter
  -> reverb -> musicBus`, so the Music slider does govern room tone).

`/bmad-code-review` 2026-07-12, same three layers over the
storage/persistence + UI-plumbing surface. Audited ACs (1-3, 5-10) all
satisfied. Triage: 2 patched, 1 deferred, 2 dismissed.

- [x] `[Review][Patch]` Pending debounced pref save had no flush path (lost
      on tab close or the app's own update/recovery reloads within 200ms);
      added `flushPrefsSave()` wired to `pagehide` [`src/main.ts`]
- [x] `[Review][Patch]` Story file did not record the debounce deviation
      from its own Dev Note; recorded (this section + amended Dev Note)
- [x] `[Review][Defer]` Cross-tab whole-object prefs clobber (last-writer
      wins, pre-existing pattern for all prefs fields) recorded in
      `_bmad-output/implementation-artifacts/backlog.md`
- Dismissed: cross-instance debounce-timer race (GameApp is constructed
  exactly once per page load, `src/main.ts` boot path); "retry after failed
  load" comment claim (the facade's load `.catch` releases the guard and the
  retry is covered by an existing test).

## Dev Agent Record

### Debug Log

- RED phase: 10 new tests failed against unchanged code (5 files), 117
  existing passed. GREEN phase: all 127 in the touched files, then the full
  suite 1107 (1108 after review patches added a facade NaN test).
- Fresh-context story validation ran before implementation; its four
  findings (screenshot task, dual review skills, footer guard test, makeUI
  stub defaults) were folded into this story before coding.

### Completion Notes

- Mute and two volume levels persist in `vc.prefs`, restored onto the facade
  in the GameApp constructor before any gesture listener exists. The Tone
  engine gained music/effects buses between content and the fixed 0.35
  master; the facade forwards levels on lazy load exactly like mute.
- Help modal gained the Sound section (Music + Effects sliders, live, with
  percent readouts); the top-bar speaker glyph initializes from saved state.
- Screenshot `docs/screenshots/02-help.png` regeneration rides the
  `[update-screenshots]` marker push (pinned Playwright container workflow).

## File List

- `src/storage/Prefs.ts` (M): muted/musicVolume/sfxVolume + volumeOrNull.
- `src/audio/ToneAudioEngine.ts` (M): musicBus/sfxBus, setVolumes, dispose.
- `src/audio/Audio.ts` (M): facade volume fields, setVolumes, load forward.
- `src/main.ts` (M): boot restore, persistence, debounce + pagehide flush,
  isMuted/onSetVolume/getVolumes callbacks.
- `src/ui/UI.ts` (M): UICallbacks additions, glyph init, Sound section.
- `src/styles.css` (M): .vol-row + range accent rules.
- `src/index.html` (unchanged; glyph init happens in wireControls).
- `src/tests/prefs.test.ts`, `src/tests/audioFacade.test.ts`,
  `src/tests/toneAudioEngine.test.ts`,
  `src/tests/toneAudioEngineGraph.test.ts`,
  `src/tests/uiDialogs.test.ts` (M): coverage per AC 9 + review patches.
- `package.json` / `package-lock.json` (M): 1.18.1 to 1.19.0.
- `_bmad-output/implementation-artifacts/story-volume-settings.md` (A).
- `_bmad-output/implementation-artifacts/backlog.md` (M): cross-tab prefs
  deferral.
