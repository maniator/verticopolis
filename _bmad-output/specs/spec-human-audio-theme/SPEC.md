---
id: SPEC-human-audio-theme
companions:
  - composition-data.md
  - engine-integration.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Human-recorded audio theme

## Why

A vision to realize: the owner wants the game to sound like them, not like an
agent's composition. They recorded hums, chest hits, object taps, a bloop, and
a ping; over five audition rounds those recordings were transcribed, arranged,
and ear-approved into a full replacement for the composed splash theme, the
in-game bed, the milestone fanfare, and the action jingles. Draft PR #776
already re-voiced three cues from the same recordings and explicitly deferred
the rest "until the recorded main theme lands"; this package is that landing,
and it supersedes #776. The exact approved note data lives in
`composition-data.md`; engine fit and process live in `engine-integration.md`.

## Capabilities

- **CAP-1**
  - **intent:** The splash screen plays "Terrace + Heartbeat": the owner's
    Hummm melody as the hook over per-bar roots and quiet fifths, with their
    chest-hit pulse as percussion and no arpeggio accompaniment.
  - **success:** The splash program matches the CAP-1 tables in
    `composition-data.md` (10 bars, 96 BPM, 25.0 s loop, hook + bass + pad +
    perc events only) and audibly matches the approved preview in-game.
- **CAP-2**
  - **intent:** The in-game bed plays "Two Chapters": the owner's New_humm hum
    verbatim, then their Hummm tune slow and low, on one shared 76 BPM pulse
    with their object-tap groove running on one continuous grid.
  - **success:** The bed program matches the CAP-2 tables (101.1 s loop, no
    arpeggio events, taps never change grid or stop dead, seam bars and the
    forced Gm opening present) and the loop wrap plays without a tempo or key
    lurch.
- **CAP-3**
  - **intent:** Milestone promotions play "Terrace Peak": the splash song's
    peak turn struck on the ping bell voice, bells only.
  - **success:** The promote cue plays C5 D5 B4 A4 on the bell + partial
    voices per the CAP-3 table, with no bloop or thump events in the cue.
- **CAP-4**
  - **intent:** The action jingles speak the owner's bloop and ping: build,
    notify, click, sell, and error all derive from the two recorded sounds.
  - **success:** Cue recipes match the CAP-4 table (build unchanged from
    #776, error a slow double bloop, every bloop flooring at or above 160 Hz
    with the specified partials), and each cue is audible on a phone speaker.
- **CAP-5**
  - **intent:** Percussion (heartbeat, taps) plays as ordinary track data
    through dedicated voices that keep their body and click at any music
    volume.
  - **success:** `"thump"` and `"tap"` events flow through `Tone.Part` like
    other voices (two membrane voices; one tuning cannot voice both, party
    refinement 2026-08-06), their shared gain connects directly to `musicBus`
    (bypassing the 2400 Hz lowpass and 90 Hz highpass), and a graph test pins
    the bypass itself, not mere connection.

## Constraints

- Pure Tone.js synthesis; no audio asset files ship with this package.
- Deep bloops floor at 160 Hz and thumps carry 2nd/3rd partials: the owner
  could not hear lower floors on phone and laptop speakers across two
  audition rounds. Depth may not be reintroduced as the error cue's signal;
  the error reads by its double-bloop gesture.
- The bed runs one tempo (76 BPM) end to end; per-section tempo changes are
  ruled out (the owner rejected the two-tempo seam).
- Fanfares contain bells only; bloops and thumps are ruled out of them.
- The music-path filters stay as they are; percussion routes around them, not
  through loosened filter settings.
- Existing tests are updated to the new musical rules, never deleted without a
  replacement assertion (see `engine-integration.md` for the exact deltas).
- Minor version bump with lockfile in lockstep; player notes credit the
  owner's recordings.
- Deep review is `/gds-code-review`; quality gates green before push; work
  lands on `claude/game-theme-m4a-samples-8k4g6x` as a draft PR that
  supersedes #776.

## Non-goals

- No sampled-audio playback of the recordings themselves (the sampled-voice
  splash variant was auditioned and not chosen).
- No change to the `money` cue (defined, uncalled, legacy recipe).
- No changes to the crowd/venue ambience layer, room tone, or rain beds,
  except the party remix's splash-hook derivation, which must follow the new
  tune (its authoring tempo and a first-phrase quote cut for the 16-beat party
  loop); everything else in the layer stays untouched.
- No simulation, engine, or gameplay behavior changes; Classic parity is
  untouched.
- No continuation of PR #776's branch; its recipes carry over, its branch is
  superseded.

## Success signal

Start the game: the splash hums the owner's tune over their heartbeat; the
tower drifts through their two-chapter hum with their taps; a star promotion
rings their four bells; building, selling, and erring all bloop in their
voice. All four quality gates green, and the owner recognizes every sound as
theirs.

## Assumptions

- F4 replaces the promote/star fanfare melody; PR #776's five-note carillon
  run is retired with it, rather than F4 landing as a seventh cue.
- The `money` cue keeps its legacy jingle recipe until a later pass.

## Open Questions

- None.
