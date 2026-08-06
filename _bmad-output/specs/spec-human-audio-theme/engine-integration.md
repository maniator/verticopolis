# Engine integration

How the composition data lands in the existing audio engine. Verified against
`src/audio/ToneAudioEngine.ts`, `toneTracks.ts`, `toneVoices.ts`, and the
installed `tone@15.1.22` before this spec was written.

## Voices and routing

- `TrackVoice` union gains `"thump"` and `"tap"` (party refinement: two
  voices, because one membrane tuning cannot voice both). `toneTracks.ts`
  events carry them like any other voice; `buildMusicPart` maps them to the
  percussion voices in `tonePercussion.ts` via the same
  `triggerAttackRelease(freq, dur, time, vel)` call the part callback already
  uses.
- The thump is a `ThumpVoice`: a half-octave `Tone.MembraneSynth` sweep into a
  midi-42 event (~131 down to 92 Hz) plus quiet octave/twelfth partials at
  0.4/0.15 of the hit, matching the owner-tested small-speaker recipe. The tap
  is a short bright `MembraneSynth` knock.
- Routing constraint (load-bearing): the percussion's shared `percGain`
  connects directly to `musicBus`, NOT through
  `musicGain -> musicTone -> musicSub`. The music
  chain's lowpass 2400 Hz dulls the tap click and the highpass 90 Hz guts the
  thump body. On `musicBus` it still follows the music volume slider, the
  shared reverb, and the master mute. It must also follow the crossfade dip:
  ramp a dedicated perc gain alongside `musicGain` in `crossfadeProgram`, or
  hang the perc gain off a node the crossfade already dips.
- The quiet fifth (root+19, vel 0.16-0.18) plays through the existing `arp`
  PolySynth voice; only the note data changes, the synth stays.
- The old splash/game programs, `HOOK`, `PATTERNS`, `GAME_SECTIONS`, `CH`,
  `ARP_CAP` machinery are replaced by the new data tables. Keep `ARP_CAP`
  export only if a test still wants it; the new bed's melody tops out far
  below it either way.

## SFX (supersedes PR #776)

- Adopt PR #776's `SfxVoices` shape (`jingle`, `bloop`, `bell`, `bellPartial`, extended here with `bloop2` and `bloopPartial`)
  and `createSfxVoices` placement in `toneVoices.ts`; keep its `notify` cue and
  `SfxName` addition.
- `build` keeps the 520-to-180 Hz swoop exactly as #776 shipped it.
- `promote` becomes the F4 Terrace Peak bells (C5 D5 B4 A4 per
  `composition-data.md`), replacing the five-note carillon run.
- `sell`, `error`, `click` re-voice onto the bloop per the recipes table;
  `money` stays on the legacy jingle synth, defined but uncalled.
- The bloop needs scheduled frequency ramps (mono `Tone.Synth`); #776's
  cancel-then-ramp pattern after `triggerAttackRelease` is correct, reuse it.
  Two-bloop gestures (sell, error) put their second swoop on a SECOND mono
  voice: a cancel at a time equal to the first ramp's end deletes that ramp
  (Web Audio cancels at >= the cancel point), and a cross-cue retrigger on a
  shared voice would cancel a pending second swoop into a stray note.
- All bloops floor at 160 Hz and the synth adds the 2nd/3rd partials; with a
  plain sine `Tone.Synth` the partials come from two extra quiet synth
  triggers (+12 and +19 st) or a `fatsine`/custom partials oscillator; pick in
  implementation, matching the approved preview by ear.

## Tests

- `toneTracks.test.ts`: splash bound moves under 30 s (S1 loop is 25.0 s);
  the bed bound stays over 90 s (loop is 101.1 s); the no-hook-in-bed rule is
  deleted (the bed melody rides the hook voice by design); the voice allowlist
  gains `"thump"` and `"tap"`; the ARP_CAP assertion applies to whatever arp-voice events
  remain (the quiet fifths, all far below cap) or is retired with the export.
- New data-shape tests: the bed loop's final melody/bass event ends at or
  before `loopEnd`; perc events exist in both programs; splash carries hook
  events; velocities stay in (0, 1].
- `toneVoices` tests follow #776's shape plus the new cue recipes.
- `toneAudioEngineGraph.test.ts` gains a BFS walk over every connect edge
  asserting the percussion path reaches the reverb with NO Filter reachable,
  so the filter-bypass survives refactors and added connections.

## Process

- Implement on `claude/game-theme-m4a-samples-8k4g6x`.
- Draft PR notes it supersedes #776; close #776 after this lands (its bloop,
  notify, and GDD/decision-log provenance carry over; re-stamp provenance
  entries for this package rather than dropping them).
- Version: minor bump via `npm version minor` (player-facing music
  replacement); player notes credit the music, percussion, and sound effects
  as made from the owner's own recordings.
- Mandatory deep review: `/gds-code-review`. Quality gates before push:
  typecheck, lint, test, build.
